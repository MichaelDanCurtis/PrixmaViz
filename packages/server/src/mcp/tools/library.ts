/**
 * Issue #7 Wave 1B — Library / organization tools.
 *
 * Three thin wrappers around the Wave 1A DB helpers, with workspace
 * ownership checks and WS broadcasts attached:
 *
 *   - `update_diagram_meta` — patch user-editable `meta.description /
 *                              author / notes` (preserves `tags`,
 *                              `sourcePaths`, timestamps).
 *   - `move_diagram`        — set `parent_path` for folder placement.
 *   - `pin_diagram`         — toggle the `pinned` flag.
 *
 * Each tool also fires a `library:diagram-updated` WS broadcast so
 * cross-tab clients refresh without polling. Pin emits `change: "pinned"`,
 * move emits `change: "moved"`, meta emits `change: "meta"`.
 *
 * Wave 1A's DB helpers (dbSetPinned / dbMoveDiagram / dbUpdateMeta)
 * intentionally take only `diagramId` (no workspaceId). The wrappers
 * here MUST do the ownership check (look up the diagram inside the
 * caller's workspace) BEFORE invoking the helper — otherwise an MCP
 * caller could mutate diagrams belonging to a different workspace.
 *
 * Spec: docs/superpowers/specs/2026-05-16-discovery-and-org-design.md
 */

import type { ServerToClient } from "@prixmaviz/shared";
import {
  dbMoveDiagram,
  dbSetPinned,
  dbUpdateMeta,
  getDiagram as dbGetDiagram,
  isValidFolderPath,
} from "../../db/diagrams";
import type { ToolCtx, ToolDef } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Emit the canonical `library:diagram-updated` event. Cross-tab clients
 * use the `change` discriminator to decide which local cache to invalidate
 * (pin star icon vs folder tree vs detail modal).
 */
function broadcastDiagramUpdated(
  ctx: ToolCtx,
  diagramId: string,
  change: "pinned" | "moved" | "meta",
): void {
  const msg: ServerToClient = {
    type: "library:diagram-updated",
    diagramId,
    change,
  };
  ctx.hub.broadcast(ctx.workspaceId, msg);
}

// ───────────────────────────────────────────────────────────────────────────
// update_diagram_meta
// ───────────────────────────────────────────────────────────────────────────

/**
 * Patch `meta.description / author / notes` on a diagram. Other keys
 * (`tags`, `sourcePaths`, `createdAt`, etc.) are preserved by Wave 1A's
 * `dbUpdateMeta` which uses JSONB `||` merge semantics.
 *
 * At least one of the three patch fields must be present; an entirely
 * empty patch is rejected (a no-op call almost always means a caller bug).
 */
async function updateDiagramMetaImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const description = args.description as string | undefined;
  const author = args.author as string | undefined;
  const notes = args.notes as string | undefined;

  if (description === undefined && author === undefined && notes === undefined) {
    throw new Error("at least one of description, author, or notes must be provided");
  }

  // Workspace ownership check FIRST — the Wave 1A helper keys by
  // diagramId only and would happily mutate a foreign workspace's row
  // if we didn't gate here.
  const existing = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!existing) throw new Error("diagram not found");

  const patch: { description?: string; author?: string; notes?: string } = {};
  if (description !== undefined) patch.description = description;
  if (author !== undefined) patch.author = author;
  if (notes !== undefined) patch.notes = notes;

  const meta = await dbUpdateMeta(ctx.sql, diagramId, patch);
  if (meta === null) throw new Error("diagram not found");

  broadcastDiagramUpdated(ctx, diagramId, "meta");
  return { ok: true, meta };
}

// ───────────────────────────────────────────────────────────────────────────
// move_diagram
// ───────────────────────────────────────────────────────────────────────────

/**
 * Set `parent_path` to place a diagram in a folder. Validates the path
 * via {@link isValidFolderPath} before touching the DB so the caller
 * gets a clean error on path-traversal / wildcard attempts.
 *
 * Empty `parentPath` moves the diagram back to the workspace root.
 */
async function moveDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const parentPath = args.parentPath as string;

  if (typeof parentPath !== "string") {
    throw new Error("parentPath must be a string");
  }
  if (!isValidFolderPath(parentPath)) {
    throw new Error(`invalid folder path: ${JSON.stringify(parentPath)}`);
  }

  // Ownership check before the mutate.
  const existing = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!existing) throw new Error("diagram not found");

  const newPath = await dbMoveDiagram(ctx.sql, diagramId, parentPath);
  if (newPath === null) throw new Error("diagram not found");

  broadcastDiagramUpdated(ctx, diagramId, "moved");
  return { ok: true, parentPath: newPath };
}

// ───────────────────────────────────────────────────────────────────────────
// pin_diagram
// ───────────────────────────────────────────────────────────────────────────

/**
 * Toggle the `pinned` flag. Pinned diagrams float to the top of the
 * Library's Pinned section in the web UI.
 */
async function pinDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const pinned = args.pinned as boolean;

  if (typeof pinned !== "boolean") {
    throw new Error("pinned must be a boolean");
  }

  const existing = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!existing) throw new Error("diagram not found");

  const newPinned = await dbSetPinned(ctx.sql, diagramId, pinned);
  if (newPinned === null) throw new Error("diagram not found");

  broadcastDiagramUpdated(ctx, diagramId, "pinned");
  return { ok: true, pinned: newPinned };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const libraryTools: ToolDef[] = [
  {
    name: "update_diagram_meta",
    description:
      "Patch user-editable metadata on a diagram (`description`, `author`, `notes`). Preserves other `meta` keys (`tags`, `sourcePaths`, timestamps). At least one patch field must be supplied; pass an explicit empty string to clear a field. Broadcasts `library:diagram-updated` (change: meta) over WS.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        description: { type: "string" },
        author: { type: "string" },
        notes: { type: "string" },
      },
      required: ["diagramId"],
    },
    run: updateDiagramMetaImpl,
  },
  {
    name: "move_diagram",
    description:
      "Set a diagram's `parent_path` to place it in a folder. Empty string moves to the workspace root. Slash-delimited segments, lower-kebab-case alphanumerics + `_`; no leading/trailing slash, no `..`, no `//`. Broadcasts `library:diagram-updated` (change: moved) over WS.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        parentPath: { type: "string" },
      },
      required: ["diagramId", "parentPath"],
    },
    run: moveDiagramImpl,
  },
  {
    name: "pin_diagram",
    description:
      "Toggle the `pinned` flag on a diagram. Pinned diagrams float to the top of the Library's Pinned section. Broadcasts `library:diagram-updated` (change: pinned) over WS.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        pinned: { type: "boolean" },
      },
      required: ["diagramId", "pinned"],
    },
    run: pinDiagramImpl,
  },
];

export const libraryImpls = {
  update_diagram_meta: updateDiagramMetaImpl,
  move_diagram: moveDiagramImpl,
  pin_diagram: pinDiagramImpl,
};
