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
import {
  getWorkspace as dbGetWorkspace,
  updateWorkspaceTiles as dbUpdateWorkspaceTiles,
} from "../../db/workspaces";
import { broadcastWorkspaceUpdate } from "../broadcast";
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
// D2. focus_tile
// ───────────────────────────────────────────────────────────────────────────

/**
 * Raise a tile to the top of the z-stack and (optionally) return the
 * world-space coordinate the client should pan to.
 *
 * z stacking: the new z is `max(allTiles.z) + 1`. If multiple tiles
 * already share the current max — possible from race conditions or
 * older clients that didn't honor z — we still produce a strict winner.
 *
 * pan: the spec deliberately says "no zoom" because the server doesn't
 * know the client viewport dimensions. We return the tile center in
 * world coordinates; the client subtracts (viewport/2) to compute the
 * camera position that lands the tile in the middle of the screen.
 *
 * The `focused` flag + `lastFocusedAt` are mirrored to keep parity with
 * `update_tile`'s focused-promotion path: anything inspecting focus state
 * (`get_focused_tile`, the web app's tile-glow effect) sees a consistent
 * single-focused-tile invariant.
 */
async function focusTileImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const tileId = args.tileId as string | undefined;
  const diagramSlug = args.diagramSlug as string | undefined;
  const pan = Boolean(args.pan);

  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) throw new Error("workspace not found");
  const tiles = ws.tiles as FocusableTile[];

  // Resolve the target tile. Prefer direct id lookup; fall back to slug
  // match (first matching tile wins — a single diagram is rarely tiled
  // more than once, but it's not forbidden).
  let idx = -1;
  if (tileId) {
    idx = tiles.findIndex((t) => t.id === tileId);
  } else if (diagramSlug) {
    idx = tiles.findIndex((t) => t.diagramSlug === diagramSlug);
  }
  if (idx < 0) {
    throw new Error(
      tileId
        ? `tile not found: ${tileId}`
        : `no tile for diagramSlug: ${diagramSlug}`,
    );
  }

  const target = tiles[idx]!;
  const maxZ = tiles.reduce((m, t) => (t.z > m ? t.z : m), -Infinity);
  const newZ = (Number.isFinite(maxZ) ? maxZ : 0) + 1;

  // Build the next tiles snapshot in one pass: target gets the bumped z
  // + focused flag; everyone else loses focus (so we keep the
  // single-focused-tile invariant `get_focused_tile` relies on).
  const now = new Date().toISOString();
  const nextTiles: FocusableTile[] = tiles.map((t, i) => {
    if (i === idx) {
      return { ...t, z: newZ, focused: true, lastFocusedAt: now };
    }
    if (t.focused) {
      return { ...t, focused: false };
    }
    return t;
  });

  await dbUpdateWorkspaceTiles(ctx.sql, ctx.workspaceId, nextTiles);
  await broadcastWorkspaceUpdate(ctx, ctx.workspaceId);

  const result: { ok: true; tileId: string; newZ: number; panTo?: { x: number; y: number } } = {
    ok: true,
    tileId: target.id,
    newZ,
  };
  if (pan) {
    // Tile center in world coordinates. The client subtracts viewport/2
    // to compute the camera; we deliberately don't return zoom because
    // the server doesn't know viewport dims.
    result.panTo = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  }
  return result;
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
  {
    name: "focus_tile",
    description:
      "Raise a tile to the top of the canvas z-stack and optionally pan the camera to it. Specify the tile by either `tileId` (direct lookup) or `diagramSlug` (first matching tile). Pass `pan: true` to also receive a `panTo: { x, y }` world-space coordinate the client should center its viewport on. Exactly one of `tileId` or `diagramSlug` is required.",
    inputSchema: {
      type: "object",
      properties: {
        tileId: { type: "string" },
        diagramSlug: { type: "string" },
        pan: { type: "boolean" },
      },
      oneOf: ["tileId", "diagramSlug"],
    },
    run: focusTileImpl,
  },
];

export const canvasImpls = {
  list_tiles: listTilesImpl,
  focus_tile: focusTileImpl,
};
