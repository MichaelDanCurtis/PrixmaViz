/**
 * Group F — Bulk MCP operations.
 *
 * Adds:
 *   - `import_diagrams` — create + render N diagrams in one call, with per-item
 *     error handling and a single trailing workspace broadcast.
 *
 * Per-item semantics (intentional): a failure on item k does NOT roll back
 * the k-1 already-created rows. The maintainer's call (see spec §F) is that
 * partial success is more useful than transactional all-or-nothing for the
 * common "import N starter templates" / "seed example workspace" flows. If
 * users complain we'll add an `atomic: true` mode later.
 *
 * Spec: docs/superpowers/specs/2026-05-15-missing-mcp-tools-design.md §F
 */

import {
  emptyGraphIR,
  emptyMeta,
  inferKind,
  type Diagram,
  type DiagramEngine,
  type DiagramKind,
  type GraphIR,
  type RenderResult,
} from "@prixmaviz/shared";
import { renderDiagram } from "../../render";
import {
  createDiagramWithUniqueSlug as dbCreateDiagramWithUniqueSlug,
  updateDiagram as dbUpdateDiagram,
  type DbDiagram,
} from "../../db/diagrams";
import { broadcastWorkspaceUpdate } from "../broadcast";
import type { ToolCtx, ToolDef } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// Local helpers (kept module-private so bulk.ts is self-contained)
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

interface ImportItem {
  name: string;
  engine: DiagramEngine;
  kind?: DiagramKind;
  source?: string;
  tags?: string[];
}

interface ImportSuccess {
  slug: string;
  diagramId: string;
  render: RenderResult;
}

interface ImportFailure {
  name: string;
  error: string;
}

/**
 * Light per-item shape validation. The top-level dispatcher validator only
 * sees `items: array` — it does not look inside. We accept the cost of
 * re-validating here in exchange for structured errors per item that
 * preserve the rest of the batch.
 */
function validateItem(raw: unknown, index: number): ImportItem {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`items[${index}] must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const name = o.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`items[${index}].name must be a non-empty string`);
  }
  const engine = o.engine;
  if (typeof engine !== "string") {
    throw new Error(`items[${index}].engine must be a string`);
  }
  const kind = o.kind;
  if (kind !== undefined && kind !== "graph" && kind !== "passthrough") {
    throw new Error(`items[${index}].kind must be "graph" or "passthrough" if provided`);
  }
  const source = o.source;
  if (source !== undefined && typeof source !== "string") {
    throw new Error(`items[${index}].source must be a string if provided`);
  }
  const tags = o.tags;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
      throw new Error(`items[${index}].tags must be an array of strings if provided`);
    }
  }
  return {
    name,
    engine: engine as DiagramEngine,
    kind: kind as DiagramKind | undefined,
    source: source as string | undefined,
    tags: tags as string[] | undefined,
  };
}

/**
 * Import + render a single item. Returns either an `ImportSuccess` row to
 * append to `created`, or an `ImportFailure` row to append to `failed`.
 *
 * Slug-collision is handled by `createDiagramWithUniqueSlug` — when the
 * base slug already exists in the workspace (either from a previous batch
 * or from earlier items in the same batch), the helper appends a random
 * suffix.
 *
 * Throws ONLY on programmer errors (e.g. unknown engine reaching the
 * renderer). Engine/render failures are captured as `ImportFailure` so
 * the loop can continue.
 */
async function importOne(
  ctx: ToolCtx,
  item: ImportItem,
): Promise<{ ok: true; success: ImportSuccess } | { ok: false; failure: ImportFailure }> {
  try {
    const kind = item.kind ?? inferKind(item.engine);
    const slug = slugify(item.name);
    const initialDsl = item.source ?? "";
    const ir: GraphIR | undefined = kind === "graph" ? emptyGraphIR() : undefined;
    const dsl: string | undefined = kind === "passthrough" ? initialDsl : undefined;

    // Tags are stored on `meta.tags` to match the convention used elsewhere
    // (see `duplicate_diagram` in crud.ts).
    const row = await dbCreateDiagramWithUniqueSlug(ctx.sql, {
      workspaceId: ctx.workspaceId,
      slug,
      name: item.name,
      engine: item.engine,
      kind,
      ir,
      dsl,
    });

    // Persist tags as a metadata update — `createDiagram(...)` doesn't
    // accept meta directly; the column defaults to `'{}'::jsonb` and we
    // patch it after the row exists.
    if (item.tags && item.tags.length > 0) {
      const meta: Record<string, unknown> = { tags: item.tags };
      await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { meta });
    }

    // Re-fetch the domain shape (with merged tags) and render.
    const diagram = dbDiagramToDomain(
      item.tags && item.tags.length > 0
        ? { ...row, meta: { ...row.meta, tags: item.tags } }
        : row,
    );
    const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
    if (!outcome.ok) {
      // Best-effort cleanup so we don't leave half-imported rows. We swallow
      // any cleanup error — the original render failure is what matters.
      const { deleteDiagram } = await import("../../db/diagrams");
      try {
        await deleteDiagram(ctx.sql, ctx.workspaceId, row.id);
      } catch {
        // ignore — cleanup is best-effort
      }
      return {
        ok: false,
        failure: { name: item.name, error: outcome.error },
      };
    }
    await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });

    return {
      ok: true,
      success: {
        slug: row.slug,
        diagramId: row.id,
        render: outcome.result,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, failure: { name: item.name, error: message } };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// F1. import_diagrams
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bulk-import N diagrams. Each item is created + rendered independently;
 * a single trailing `broadcastWorkspaceUpdate` notifies live clients exactly
 * once (NOT N times) so the canvas refresh is a single repaint regardless
 * of batch size.
 *
 * `stopOnError: true`  — halt on first failure. `created[]` contains the
 *                        items successfully imported before the failure;
 *                        `failed[]` contains exactly one entry (the failing
 *                        item). Rows already created are NOT rolled back.
 * `stopOnError: false` — (default) continue past failures; `failed[]`
 *                        accumulates all failed items.
 */
async function importDiagramsImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const rawItems = args.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("items must be an array");
  }
  const stopOnError = Boolean(args.stopOnError);

  const created: ImportSuccess[] = [];
  const failed: ImportFailure[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    let item: ImportItem;
    try {
      item = validateItem(rawItems[i], i);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // For shape errors we have no `name` to use as the identifier; fall
      // back to a synthetic so the failure entry is still informative.
      const fallbackName =
        (rawItems[i] && typeof rawItems[i] === "object" && (rawItems[i] as { name?: unknown }).name) as string | undefined;
      failed.push({ name: fallbackName ?? `items[${i}]`, error: message });
      if (stopOnError) break;
      continue;
    }

    const outcome = await importOne(ctx, item);
    if (outcome.ok) {
      created.push(outcome.success);
    } else {
      failed.push(outcome.failure);
      if (stopOnError) break;
    }
  }

  // Single trailing broadcast — not one per item. Even when nothing was
  // created (e.g. all items failed validation) we broadcast: in practice
  // it's a cheap re-read and lets the client recover if it was already
  // out-of-sync.
  await broadcastWorkspaceUpdate(ctx, ctx.workspaceId);

  return { created, failed };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const bulkTools: ToolDef[] = [
  {
    name: "import_diagrams",
    description:
      "Bulk-create N diagrams in one call. Each item is created and rendered independently; failures on individual items don't abort the batch unless `stopOnError: true` is passed. Slug collisions inside the batch are resolved by appending a random suffix. Emits exactly one workspace broadcast at the end, regardless of batch size.",
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array" },
        stopOnError: { type: "boolean" },
      },
      required: ["items"],
    },
    run: importDiagramsImpl,
  },
];

export const bulkImpls = {
  import_diagrams: importDiagramsImpl,
};
