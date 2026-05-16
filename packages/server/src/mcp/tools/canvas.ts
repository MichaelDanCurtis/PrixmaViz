/**
 * Group D — Canvas state introspection + manipulation (Issue #5).
 *
 * MCP tools that read or mutate the workspace's `tiles` JSON column.
 * Workspace-scoped via `ctx.workspaceId` — there's no per-tile auth
 * because tiles only exist on a workspace the caller already
 * authenticated to.
 *
 * Spec: docs/superpowers/specs/2026-05-15-missing-mcp-tools-design.md §D.
 */

import type { Tile } from "@prixmaviz/shared";
import { getWorkspace as dbGetWorkspace } from "../../db/workspaces";
import type { ToolCtx, ToolDef } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// Local types
//
// Mirrors the "FocusableTile" pattern already used in tools.ts: the runtime
// workspace `tiles` JSON column carries `focused`/`lastFocusedAt` fields
// that aren't formally on the shared Tile type — the web client and the
// existing update_tile/get_focused_tile flow both rely on them.
// ───────────────────────────────────────────────────────────────────────────

interface FocusableTile extends Tile {
  focused?: boolean;
  lastFocusedAt?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// D1. list_tiles
// ───────────────────────────────────────────────────────────────────────────

/**
 * Enumerate every tile in the caller's workspace with geometry, z-stack
 * position, and a `focused` flag. The `focused` flag matches the same
 * resolution `get_focused_tile` uses (the tile carrying
 * `focused === true`) so callers can use list_tiles as a strict superset
 * of get_focused_tile when they want both the focus + every other tile in
 * one round-trip.
 *
 * Empty workspace returns `{ tiles: [] }`.
 */
async function listTilesImpl(_args: Record<string, unknown>, ctx: ToolCtx) {
  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) return { tiles: [] };
  const tiles = ws.tiles as FocusableTile[];

  return {
    tiles: tiles.map((t) => ({
      id: t.id,
      diagramId: t.diagramId,
      diagramSlug: t.diagramSlug,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      z: t.z,
      // Only emit `focused: true`; omit the false case to keep responses
      // lean and to mirror the existing get_focused_tile contract (it
      // returns the single tile or `null`).
      ...(t.focused === true ? { focused: true } : {}),
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const canvasTools: ToolDef[] = [
  {
    name: "list_tiles",
    description:
      "List every tile in the current workspace with geometry (x, y, w, h, z) and a `focused: true` flag for the tile currently focused. Returns `{ tiles: [] }` for an empty workspace. Same focus semantics as get_focused_tile.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    run: listTilesImpl,
  },
];

export const canvasImpls = {
  list_tiles: listTilesImpl,
};
