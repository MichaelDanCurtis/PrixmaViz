// Issue #8 Wave 1B — `.pviz` workspace bundle writer.
//
// Produces a single zip archive containing the full state of a workspace:
// workspace settings, every diagram (including its SVG snapshot + optional
// binary bytes), every annotation, and the current canvas tile layout.
//
// The bundle is the round-trippable companion to `parseBundle()` in
// ./pviz-reader.ts. Together they back `GET /api/workspaces/:id/export`
// and `POST /api/workspaces/import` — the "back up my workspace / move
// between instances / version-control my diagrams" surface from #8.
//
// Layout (per the spec in Issue #8):
//
//   manifest.json                  workspace meta + format version
//   diagrams/<slug>.json           one file per diagram, full payload
//   annotations/<slug>.json        one file per annotated diagram
//   tiles.json                     current canvas state (tiles + camera)
//
// `bytes` (vsdx binary engines) is encoded as base64 in the diagram JSON
// when present so the JSON file remains valid UTF-8.
//
// Version is `1.0`. Major-version bumps are reserved for breaking
// changes; pviz-reader rejects bundles with a newer major than supported.

import JSZip from "jszip";
import type postgres from "postgres";
import { listDiagrams } from "../db/diagrams";
import { listAnnotations } from "../db/annotations";
import { getWorkspace } from "../db/workspaces";

type Sql = ReturnType<typeof postgres>;

export const BUNDLE_VERSION = "1.0";

/**
 * Compose a `.pviz` bundle for `workspaceId`. Returns the zip as a Buffer
 * so callers can stream it back over HTTP (`new Response(buf, ...)`) or
 * write it to disk.
 *
 * The caller is responsible for authentication / ownership — `composeBundle`
 * does not check anything beyond the workspace existing. Bearer-auth +
 * workspace ownership is enforced at the HTTP layer.
 *
 * Throws if the workspace does not exist.
 */
export async function composeBundle(sql: Sql, workspaceId: string): Promise<Buffer> {
  const ws = await getWorkspace(sql, workspaceId);
  if (!ws) {
    throw new Error(`workspace not found: ${workspaceId}`);
  }
  const diagrams = await listDiagrams(sql, workspaceId);

  const zip = new JSZip();

  zip.file("manifest.json", JSON.stringify({
    version: BUNDLE_VERSION,
    workspaceId: ws.id,
    workspaceName: ws.name,
    createdAt: new Date().toISOString(),
    settings: ws.settings ?? {},
    diagramCount: diagrams.length,
  }, null, 2));

  for (const d of diagrams) {
    const diagramJson: Record<string, unknown> = {
      id: d.id,
      name: d.name,
      slug: d.slug,
      engine: d.engine,
      kind: d.kind,
      parentPath: d.parentPath,
      pinned: d.pinned,
      lastOpenedAt: d.lastOpenedAt,
      ir: d.ir,
      dsl: d.dsl,
      meta: d.meta,
      svg: d.svg,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
    // Binary engines (vsdx) keep their bytes too — base64 so JSON stays valid UTF-8.
    if (d.bytes && d.bytes.length > 0) {
      diagramJson.bytes = Buffer.from(d.bytes).toString("base64");
    }
    zip.file(`diagrams/${d.slug}.json`, JSON.stringify(diagramJson, null, 2));

    // Annotations: emit one file per diagram that HAS annotations. Empty
    // diagrams get no file (simpler reader, no junk in the archive).
    const annotations = await listAnnotations(sql, d.id, { includeResolved: true });
    if (annotations.length > 0) {
      zip.file(`annotations/${d.slug}.json`, JSON.stringify({
        diagramSlug: d.slug,
        annotations,
      }, null, 2));
    }
  }

  zip.file("tiles.json", JSON.stringify({
    tiles: ws.tiles ?? [],
    camera: ws.camera ?? { x: 0, y: 0, zoom: 1 },
  }, null, 2));

  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
