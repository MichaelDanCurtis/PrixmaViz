/**
 * Group D — Canvas state introspection + manipulation (Issue #5).
 *
 * Three MCP tools that read or mutate the workspace's `tiles` JSON column:
 *   - `list_tiles`            : enumerate every tile with geometry + focus flag
 *   - `focus_tile`            : raise a tile's z to the top of the stack
 *   - `take_canvas_snapshot`  : compose a single SVG (or PNG) of the whole canvas
 *
 * All three:
 *   - Workspace-scoped via `ctx.workspaceId` (no per-tile auth needed — tiles
 *     only exist on a workspace the caller already authenticated to).
 *   - Use the Wave-1 shared helpers `broadcastWorkspaceUpdate` (for mutating
 *     ops) and `composeWorkspaceSvg` (for snapshot composition) — see the
 *     spec at docs/superpowers/specs/2026-05-15-missing-mcp-tools-design.md §D.
 *
 * focus_tile mirrors the focused-tile semantics already established by
 * `update_tile` + `get_focused_tile` in tools.ts: a single tile carries
 * `focused: true` + `lastFocusedAt` at any moment, and z is bumped to
 * max(z)+1 to win the visual stacking order on the web client.
 *
 * take_canvas_snapshot is MVP: includeAnnotations is accepted but ignored
 * with a warning, per the spec ("D3 ships an MVP; font scoping is a
 * follow-up" + "MVP ignores this flag with a warning in the response").
 */

import type { Tile } from "@prixmaviz/shared";
import { composeWorkspaceSvg } from "../../canvas/snapshot-svg";
import {
  getDiagram as dbGetDiagram,
  updateDiagram as dbUpdateDiagram,
  type DbDiagram,
} from "../../db/diagrams";
import {
  getWorkspace as dbGetWorkspace,
  updateWorkspaceTiles as dbUpdateWorkspaceTiles,
} from "../../db/workspaces";
import { rasterizeSvg } from "../../canvas/rasterize-svg";
import { renderDiagram } from "../../render";
import { broadcastWorkspaceUpdate } from "../broadcast";
import type { ToolCtx, ToolDef } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// Local types (mirror the "FocusableTile" pattern in tools.ts so we don't
// have to leak the extra fields back into the shared Tile type — those
// fields live in the workspace's `tiles` JSON column at runtime even though
// the shared Tile interface doesn't formally enumerate them).
// ───────────────────────────────────────────────────────────────────────────

interface FocusableTile extends Tile {
  focused?: boolean;
  lastFocusedAt?: string;
}

const SNAPSHOT_MIME_TYPES = {
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
} as const;

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
// D3. take_canvas_snapshot (MVP)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compose every tile in the workspace into a single SVG (or rasterize to
 * PNG/JPEG). Tile SVGs are looked up from the cache first; cache misses
 * trigger a fresh `renderDiagram` (and the new SVG is persisted back to
 * the cache).
 *
 * MVP limits:
 *   - `includeAnnotations: true` returns a warning rather than rendering
 *     annotation overlays (font scoping + annotation rendering on the
 *     server is a follow-up — see spec D3 "out of scope").
 *   - jpeg output: rsvg-convert only produces png/pdf/svg; we surface a
 *     warning when jpeg is requested and return png bytes under the
 *     image/jpeg mime so callers' format-routing still works. A second
 *     iteration will swap in a proper jpeg encoder when one is shipped.
 */
async function takeCanvasSnapshotImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const formatRaw = (args.format as string | undefined) ?? "svg";
  if (formatRaw !== "svg" && formatRaw !== "png" && formatRaw !== "jpeg") {
    throw new Error(`unsupported format: ${formatRaw}`);
  }
  const format = formatRaw as "svg" | "png" | "jpeg";
  const includeAnnotations = Boolean(args.includeAnnotations);
  const padding = typeof args.padding === "number" ? args.padding : 40;
  const background = (args.background as string | undefined) ?? "transparent";

  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) throw new Error("workspace not found");
  const tiles = ws.tiles as FocusableTile[];

  const warnings: string[] = [];
  if (includeAnnotations) {
    warnings.push(
      "includeAnnotations is accepted for forward-compat but not yet implemented — annotations are NOT rendered in this MVP.",
    );
  }

  // Build a per-tile SVG cache populated on demand. We don't render
  // multiple diagrams concurrently here: render-on-miss is rare in
  // practice (the web client triggers renders on creation), and serial
  // execution keeps Kroki load predictable.
  const svgByDiagramId = new Map<string, string | null>();
  for (const tile of tiles) {
    if (svgByDiagramId.has(tile.diagramId)) continue;
    const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, tile.diagramId);
    if (!row) {
      // Tile points at a deleted diagram. Skip; composeWorkspaceSvg
      // will simply not emit a block for this index. The tileCount in
      // the response still reflects the input tiles so callers can
      // detect the partial composition.
      svgByDiagramId.set(tile.diagramId, null);
      continue;
    }
    if (row.svg) {
      svgByDiagramId.set(tile.diagramId, row.svg);
      continue;
    }
    // Cache miss: render and persist back to the cache. If the render
    // fails (e.g. broken DSL), record the failure as a warning and
    // skip the tile; we still want to produce a snapshot of the
    // remaining tiles rather than failing the whole call.
    const outcome = await renderDiagram(dbDiagramToRenderInput(row), {
      kroki: ctx.kroki,
    });
    if (!outcome.ok) {
      warnings.push(`tile ${tile.id}: render failed (${outcome.error}); skipping`);
      svgByDiagramId.set(tile.diagramId, null);
      continue;
    }
    await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, {
      svg: outcome.result.svg,
    });
    svgByDiagramId.set(tile.diagramId, outcome.result.svg);
  }

  const composed = await composeWorkspaceSvg({
    tiles: tiles.map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      diagramId: t.diagramId,
    })),
    padding,
    background,
    getTileSvg: (t) => svgByDiagramId.get(t.diagramId ?? "") ?? null,
  });

  let bytes: Uint8Array;
  if (format === "svg") {
    bytes = new TextEncoder().encode(composed.svg);
  } else {
    // Rasterize via rsvg-convert. rsvg-convert can't emit jpeg directly
    // (formats are png/pdf/svg) — when the caller asks for jpeg we
    // still return png bytes but flag it so the response is honest.
    const rasterTarget = format === "jpeg" ? "png" : format;
    bytes = await rasterizeSvg(composed.svg, rasterTarget);
    if (format === "jpeg") {
      warnings.push(
        "jpeg output is not yet supported by the server-side rasterizer; returning png bytes under image/jpeg. Use format: 'png' for an exact-match mime.",
      );
    }
  }

  return {
    format,
    mimeType: SNAPSHOT_MIME_TYPES[format],
    base64: Buffer.from(bytes).toString("base64"),
    width: composed.width,
    height: composed.height,
    tileCount: tiles.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Marshal a DbDiagram into the shape renderDiagram() expects. Same
 * pattern as tools.ts → dbDiagramToDomain; inlined here so canvas.ts
 * doesn't take a back-channel dependency on a non-exported helper.
 */
function dbDiagramToRenderInput(d: DbDiagram) {
  return {
    id: d.id,
    name: d.name,
    engine: d.engine,
    kind: d.kind,
    ir: d.ir ?? undefined,
    dsl: d.dsl ?? undefined,
    bytes: d.bytes ?? undefined,
    meta: (d.meta as unknown as Parameters<typeof renderDiagram>[0]["meta"]) ?? {
      createdAt: "",
      updatedAt: "",
      tags: [],
      sourcePaths: [],
    },
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
  {
    name: "take_canvas_snapshot",
    description:
      "Compose every tile in the workspace into a single SVG (or PNG, or JPEG) and return the bytes base64-encoded. `format` defaults to 'svg'. `padding` (default 40) is the outer margin around the bbox of all tiles. `background` (default 'transparent') is a CSS color or 'transparent' for no rect. `includeAnnotations` is accepted but NOT YET IMPLEMENTED in the MVP — passing true returns a warning and the snapshot without annotations.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["svg", "png", "jpeg"] },
        includeAnnotations: { type: "boolean" },
        padding: { type: "number" },
        background: { type: "string" },
      },
    },
    run: takeCanvasSnapshotImpl,
  },
];

export const canvasImpls = {
  list_tiles: listTilesImpl,
  focus_tile: focusTileImpl,
  take_canvas_snapshot: takeCanvasSnapshotImpl,
};
