// Issue #8 Wave 1B — `.pviz` bundle importer.
//
// Takes a parsed bundle (from pviz-reader) and materializes it as a brand
// new workspace owned by `ownerHash`. Every diagram, annotation, and tile
// gets a fresh ID; the bundle's original IDs are preserved in
// `meta.originalId` for traceability.
//
// IMPORTANT: this never touches an existing workspace. The import route
// always creates a new one (Issue #8 spec) so an unauthenticated or
// hostile caller cannot overwrite anyone else's data with a malicious
// bundle. Even the caller's own existing workspaces are untouched.
//
// Used by `POST /api/workspaces/import`. The HTTP layer is responsible
// for bearer-auth + parsing the multipart body; this module is purely
// DB-side and takes a `ParsedBundle` it can trust to be shape-valid
// (pviz-reader did the structural checks).

import type postgres from "postgres";
import { newAnnotationId, newTileId, type Annotation, type DiagramEngine, type DiagramKind, type GraphIR, type Tile } from "@prixmaviz/shared";
import { createDiagramWithUniqueSlug } from "../db/diagrams";
import { createWorkspace, setWorkspaceOwner, updateWorkspaceCamera, updateWorkspaceSettings, updateWorkspaceTiles } from "../db/workspaces";
import { addAnnotation } from "../db/annotations";
import type { ParsedBundle } from "./pviz-reader";

type Sql = ReturnType<typeof postgres>;
type JSONLike = Parameters<Sql["json"]>[0];

export interface ImportResult {
  workspaceId: string;
  diagramCount: number;
  importedAt: string;
}

/**
 * Materialize a parsed bundle as a new workspace.
 *
 * - Creates a fresh workspace owned by `ownerHash` (caller's bearer hash).
 * - Inserts each diagram with a fresh ID, preserves the bundle's original
 *   id in `meta.originalId`.
 * - Inserts each annotation with a fresh ID, retargeted at the new
 *   diagram row's id.
 * - Inserts tiles with fresh ids and remaps `diagramId` (was the bundle's
 *   id, now points at the new row).
 * - Restores camera + settings from the manifest.
 *
 * Slug collisions inside the bundle (rare — same slug repeated) are
 * handled by `createDiagramWithUniqueSlug` retrying with a suffix.
 */
export async function importBundle(
  sql: Sql,
  parsed: ParsedBundle,
  ownerHash: string | null,
): Promise<ImportResult> {
  const ws = await createWorkspace(sql, parsed.manifest.workspaceName ?? undefined);
  if (ownerHash) {
    await setWorkspaceOwner(sql, ws.id, ownerHash);
  }

  // Map: bundle's diagram id -> newly-inserted row's id. Tiles in the
  // bundle reference diagrams by their OLD id; we use this map to rewire
  // them after every diagram is inserted.
  const idMap = new Map<string, { id: string; slug: string }>();

  for (const d of parsed.diagrams) {
    // Stash the original id (for back-references / debugging) on meta.
    // Don't clobber other meta keys; merge with what the bundle stored.
    const meta = { ...d.meta, originalId: d.id };

    const row = await createDiagramWithUniqueSlug(sql, {
      workspaceId: ws.id,
      slug: d.slug,
      name: d.name,
      engine: d.engine as DiagramEngine,
      kind: d.kind as DiagramKind,
      ir: (d.ir as GraphIR | null) ?? undefined,
      dsl: d.dsl ?? undefined,
      bytes: d.bytes ?? undefined,
    });

    // Patch the rest in one UPDATE — svg, meta, parent_path, pinned,
    // last_opened_at — none of which createDiagram covers.
    await sql`
      UPDATE diagrams
         SET svg = ${d.svg},
             meta = ${sql.json(meta as unknown as JSONLike)},
             parent_path = ${d.parentPath},
             pinned = ${d.pinned},
             last_opened_at = ${d.lastOpenedAt ?? null},
             updated_at = now()
       WHERE id = ${row.id}
    `;

    idMap.set(d.id, { id: row.id, slug: row.slug });

    // Annotations are keyed by slug (bundle layout: annotations/<slug>.json).
    const anns = parsed.annotations[d.slug] ?? [];
    for (const a of anns) {
      const fresh: Annotation = { ...a, id: newAnnotationId() };
      await addAnnotation(sql, row.id, fresh);
    }
  }

  // Settings — apply from manifest (preserves user prefs across import).
  if (parsed.manifest.settings && Object.keys(parsed.manifest.settings).length > 0) {
    await updateWorkspaceSettings(sql, ws.id, parsed.manifest.settings);
  }

  // Camera + tiles. Tile diagramId/diagramSlug must be remapped.
  if (parsed.camera) {
    await updateWorkspaceCamera(sql, ws.id, parsed.camera);
  }
  const remappedTiles: Tile[] = [];
  for (const t of parsed.tiles) {
    const mapped = idMap.get(t.diagramId);
    if (!mapped) {
      // Tile references a diagram that wasn't in the bundle — skip,
      // since restoring it would dangle.
      continue;
    }
    remappedTiles.push({
      id: newTileId(),
      diagramId: mapped.id,
      diagramSlug: mapped.slug,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      z: t.z,
    });
  }
  if (remappedTiles.length > 0) {
    await updateWorkspaceTiles(sql, ws.id, remappedTiles);
  }

  return {
    workspaceId: ws.id,
    diagramCount: parsed.diagrams.length,
    importedAt: new Date().toISOString(),
  };
}
