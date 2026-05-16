/**
 * Group A — CRUD completeness for MCP.
 *
 * Adds:
 *   - delete_diagram   — cascade-aware deletion that detaches from workspaces
 *   - duplicate_diagram — clone with optional annotation copy + fresh render
 *
 * Extends:
 *   - load_diagram — accepts `diagramId` OR `slug`; gains `includeSvg` flag
 *
 * Re-exported via packages/server/src/mcp/tools.ts; that file owns the
 * registry-level concatenation into `TOOLS`. Each impl mirrors the existing
 * conventions in tools.ts (slugify helper, domain Diagram conversion,
 * render-and-cache pattern, ws broadcast).
 *
 * Spec: docs/superpowers/specs/2026-05-15-missing-mcp-tools-design.md §A
 */

import {
  emptyMeta, type Diagram, type DiagramEngine, type GraphIR, type ServerToClient, type Tile,
} from "@prixmaviz/shared";
import { renderDiagram } from "../../render";
import {
  createDiagramWithUniqueSlug as dbCreateDiagramWithUniqueSlug,
  deleteDiagram as dbDeleteDiagram,
  getDiagram as dbGetDiagram,
  getDiagramBySlug as dbGetDiagramBySlug,
  updateDiagram as dbUpdateDiagram,
  type DbDiagram,
} from "../../db/diagrams";
import {
  getWorkspace as dbGetWorkspace,
  updateWorkspaceTiles as dbUpdateWorkspaceTiles,
} from "../../db/workspaces";
import { broadcastWorkspaceUpdate } from "../broadcast";
import type { ToolCtx, ToolDef } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// Local helpers (kept module-private so crud.ts is self-contained)
// ───────────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "diagram";
}

function dbDiagramToDomain(d: DbDiagram): Diagram {
  return {
    id: d.id,
    name: d.name,
    engine: d.engine,
    kind: d.kind,
    ir: d.ir ?? undefined,
    dsl: d.dsl ?? undefined,
    bytes: d.bytes ?? undefined,
    meta: (d.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
}

function broadcastRender(
  ctx: ToolCtx,
  d: Diagram,
  svg: string,
  warnings: string[],
): void {
  const msg: ServerToClient = {
    type: "render",
    diagramId: d.id,
    ir: d.ir,
    dsl: d.dsl ?? "",
    svg,
    warnings: warnings.length ? warnings : undefined,
  };
  ctx.hub.broadcast(ctx.workspaceId, msg);
}

/**
 * Resolve a diagram by either `slug` or `diagramId`. Tools that gate
 * resolution behind `oneOf` already guarantee exactly one is set, but we
 * keep the both-undefined branch defensive in case a caller bypasses the
 * dispatcher.
 */
async function resolveDiagram(
  ctx: ToolCtx,
  ref: { slug?: string; diagramId?: string },
): Promise<DbDiagram | null> {
  if (ref.diagramId) {
    return dbGetDiagram(ctx.sql, ctx.workspaceId, ref.diagramId);
  }
  if (ref.slug) {
    const slug = ref.slug.endsWith(".pviz")
      ? ref.slug.replace(/\.pviz$/, "")
      : ref.slug;
    return dbGetDiagramBySlug(ctx.sql, ctx.workspaceId, slug);
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// A1. delete_diagram
// ───────────────────────────────────────────────────────────────────────────

/**
 * Delete a diagram. With `cascade: true` (default) the row's annotations
 * fall away via ON DELETE CASCADE (FK constraint on `annotations.diagram_id`)
 * and any tiles referencing the diagram in the workspace's `tiles` JSON
 * column are stripped — all in one transaction.
 *
 * With `cascade: false`, the call REFUSES to delete when orphans exist and
 * returns a structured error listing the counts so the caller can decide
 * whether to retry with `cascade: true`.
 */
async function deleteDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const slug = args.slug as string | undefined;
  const diagramId = args.diagramId as string | undefined;
  const cascade = args.cascade === undefined ? true : Boolean(args.cascade);

  const row = await resolveDiagram(ctx, { slug, diagramId });
  if (!row) throw new Error("diagram not found");

  // Snapshot what we're about to cascade so we can return it in the response.
  // Annotation IDs come from the DB; tile IDs come from workspace JSON.
  const annotationIds = await ctx.sql<{ id: string }[]>`
    SELECT id FROM annotations WHERE diagram_id = ${row.id}
  `.then((rows) => rows.map((r) => r.id));

  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  const allTiles = (ws?.tiles ?? []) as Tile[];
  const matchingTiles = allTiles.filter((t) => t.diagramId === row.id);
  const deletedTileIds = matchingTiles.map((t) => t.id);

  if (!cascade && (annotationIds.length > 0 || deletedTileIds.length > 0)) {
    // Structured error response. We throw to leverage the existing dispatch
    // error path; the caller sees `{ error: { message } }` in HTTP land.
    throw new Error(
      `diagram has ${deletedTileIds.length} tile(s), ${annotationIds.length} annotation(s); pass cascade: true to delete with them`,
    );
  }

  // Single transaction across all three deletes so a partial failure
  // doesn't leave dangling tiles. annotations cascade via FK; we still
  // explicitly delete the diagram row inside the txn.
  await ctx.sql.begin(async (tx) => {
    // Remove tiles from workspace JSON if any.
    if (deletedTileIds.length > 0 && ws) {
      const remainingTiles = allTiles.filter((t) => t.diagramId !== row.id);
      await tx`
        UPDATE workspaces
        SET tiles = ${tx.json(remainingTiles as unknown as Parameters<typeof tx.json>[0])},
            updated_at = now()
        WHERE id = ${ctx.workspaceId}
      `;
    }
    // annotations fall away via ON DELETE CASCADE on FK.
    await tx`
      DELETE FROM diagrams WHERE id = ${row.id} AND workspace_id = ${ctx.workspaceId}
    `;
  });

  await broadcastWorkspaceUpdate(ctx, ctx.workspaceId);

  return {
    ok: true,
    deletedId: row.id,
    deletedTileIds,
    deletedAnnotationIds: annotationIds,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// A2. duplicate_diagram
// ───────────────────────────────────────────────────────────────────────────

/**
 * Clone a diagram under a new name. The clone is created via
 * `createDiagramWithUniqueSlug` so concurrent duplicate calls can't collide
 * on the slug. Tags merge (source ∪ caller-supplied). The clone is
 * RE-RENDERED rather than reusing the source's cached SVG — engine versions
 * can drift between source-render-time and now.
 *
 * Optional `preserveAnnotations: true` copies annotation rows with fresh
 * UUIDs and the new diagram_id. Resolved annotations are copied too; their
 * `resolved_at` stays set on the clone.
 */
async function duplicateDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const sourceSlug = args.sourceSlug as string | undefined;
  const sourceDiagramId = args.sourceDiagramId as string | undefined;
  const newName = args.newName as string;
  const tagsInput = (args.tags as string[] | undefined) ?? [];
  const preserveAnnotations = Boolean(args.preserveAnnotations);

  const source = await resolveDiagram(ctx, {
    slug: sourceSlug,
    diagramId: sourceDiagramId,
  });
  if (!source) throw new Error("source diagram not found");

  // Merge tags: source ∪ caller. Preserve order (source first, new tags
  // appended); dedupe by string equality.
  const sourceTags = ((source.meta as { tags?: string[] }).tags ?? []) as string[];
  const mergedTags = Array.from(new Set([...sourceTags, ...tagsInput]));
  const newMeta: Record<string, unknown> = {
    ...(source.meta as Record<string, unknown>),
    tags: mergedTags,
  };

  // Clone scalars + IR/DSL into a fresh row. Bytes (vsdx binary) are
  // copied verbatim. The `createDiagramWithUniqueSlug` helper retries with
  // a random suffix on slug collision.
  const baseSlug = slugify(newName);
  const cloneRow = await dbCreateDiagramWithUniqueSlug(ctx.sql, {
    workspaceId: ctx.workspaceId,
    slug: baseSlug,
    name: newName,
    engine: source.engine,
    kind: source.kind,
    ir: source.ir ?? undefined,
    dsl: source.dsl ?? undefined,
    bytes: source.bytes ?? undefined,
  });

  // Persist the merged tag set on the new row.
  if (mergedTags.length > 0) {
    await dbUpdateDiagram(ctx.sql, ctx.workspaceId, cloneRow.id, { meta: newMeta });
  }

  // Re-render: engine versions may have drifted since `source` last rendered.
  const cloneDomain = dbDiagramToDomain({ ...cloneRow, meta: newMeta });
  const outcome = await renderDiagram(cloneDomain, { kroki: ctx.kroki });
  if (!outcome.ok) {
    // Roll back the clone so we don't leave half-baked rows behind.
    await dbDeleteDiagram(ctx.sql, ctx.workspaceId, cloneRow.id);
    throw new Error(`render failed: ${outcome.error}`);
  }
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, cloneRow.id, { svg: outcome.result.svg });

  // Annotation cloning. Uses `gen_random_uuid()` cast to text (matches the
  // existing id shape — pgcrypto is enabled in 0001_init.sql).
  if (preserveAnnotations) {
    await ctx.sql`
      INSERT INTO annotations
        (id, diagram_id, kind, text, color, resolved_at, target_nodes, bbox_pixel, bbox_data, point, nearest_node, created_at)
      SELECT
        gen_random_uuid()::text,
        ${cloneRow.id},
        kind, text, color, resolved_at, target_nodes, bbox_pixel, bbox_data, point, nearest_node,
        now()
      FROM annotations
      WHERE diagram_id = ${source.id}
    `;
  }

  // Broadcast: render event for the new diagram + workspace event (no
  // tiles created here, but downstream listeners may refresh listings).
  broadcastRender(ctx, cloneDomain, outcome.result.svg, outcome.warnings);
  await broadcastWorkspaceUpdate(ctx, ctx.workspaceId);

  return {
    diagramId: cloneRow.id,
    slug: cloneRow.slug,
    name: cloneRow.name,
    engine: cloneRow.engine,
    kind: cloneRow.kind,
    render: outcome.result,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// A3 (folded). load_diagram extension — accept diagramId; gain includeSvg.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Load a saved diagram. Accepts EITHER `slug` (PR #22 + earlier) OR
 * `diagramId` (new in this PR). The `name` alias from PR #22 stays for
 * backwards-compat; the validator's `legacyAliases` mapping translates
 * `{ name }` → `{ slug }`.
 *
 * `includeSvg` defaults to false to keep MCP transcripts lean. Callers
 * who want the full rendered SVG (the web client, save-to-disk tools)
 * opt in explicitly.
 */
async function loadDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const slugRaw = (args.slug ?? args.name) as string | undefined;
  const diagramId = args.diagramId as string | undefined;
  const includeSvg = Boolean(args.includeSvg);

  if (!slugRaw && !diagramId) {
    throw new Error("Missing required parameter: slug");
  }

  const row = diagramId
    ? await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId)
    : await dbGetDiagramBySlug(
        ctx.sql,
        ctx.workspaceId,
        slugRaw!.endsWith(".pviz")
          ? slugRaw!.replace(/\.pviz$/, "")
          : slugRaw!,
      );
  if (!row) throw new Error("diagram not found");

  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });

  // Always broadcast on load (web clients show the freshly-rendered tile).
  broadcastRender(ctx, diagram, outcome.result.svg, outcome.warnings);

  return {
    diagramId: row.id,
    slug: row.slug,
    name: row.name,
    engine: row.engine,
    kind: row.kind,
    ir: diagram.ir,
    dsl: diagram.dsl,
    render: includeSvg
      ? outcome.result
      // Omit `svg` to keep responses lean. Callers can call again with
      // `includeSvg: true` if they need the bytes.
      : { dsl: outcome.result.dsl },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const crudTools: ToolDef[] = [
  {
    name: "delete_diagram",
    description:
      "Delete a diagram from the workspace. Cascade-deletes annotations and removes tiles from the canvas. Pass `cascade: false` to refuse deletion when orphans exist. Exactly one of `slug` or `diagramId` is required.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        diagramId: { type: "string" },
        cascade: { type: "boolean" },
      },
    },
    oneOf: [["slug", "diagramId"]],
    run: deleteDiagramImpl,
  },
  {
    name: "duplicate_diagram",
    description:
      "Clone a diagram under a new name. The clone receives a fresh render (engine versions may have drifted since the source was last rendered) and merges the source's tags with any new tags you supply. Pass `preserveAnnotations: true` to copy annotation rows; default false. Exactly one of `sourceSlug` or `sourceDiagramId` is required.",
    inputSchema: {
      type: "object",
      properties: {
        sourceSlug: { type: "string" },
        sourceDiagramId: { type: "string" },
        newName: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        preserveAnnotations: { type: "boolean" },
      },
      required: ["newName"],
    },
    oneOf: [["sourceSlug", "sourceDiagramId"]],
    run: duplicateDiagramImpl,
  },
];

// Used to replace the existing `load_diagram` definition in the registry.
// `tools.ts` swaps the existing entry rather than appending so we don't
// have two `load_diagram` tools.
export const loadDiagramTool: ToolDef = {
  name: "load_diagram",
  description:
    "Load a saved diagram by `slug` or `diagramId` into the workspace. Slug is the kebab-case identifier returned by list_diagrams. Pass `includeSvg: true` to include the rendered SVG in the response (default omits it to keep transcripts lean). The legacy `name` alias for `slug` is still accepted.",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      diagramId: { type: "string" },
      includeSvg: { type: "boolean" },
    },
  },
  legacyAliases: { name: "slug" },
  oneOf: [["slug", "diagramId", "name"]],
  run: loadDiagramImpl,
};

export const crudImpls = {
  deleteDiagramImpl,
  duplicateDiagramImpl,
  loadDiagramImpl,
};

// Internal exports for tests that want to assert wiring without spinning
// up the dispatcher.
export const __internal = {
  slugify,
  resolveDiagram,
};
