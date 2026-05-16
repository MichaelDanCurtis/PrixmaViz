import type { Camera, Tile } from "@prixmaviz/shared";
import { SNAP_GRID } from "@prixmaviz/shared";

export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }

export function toViewport(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function toCanvas(p: Point, cam: Camera): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/**
 * Snap a single scalar to the nearest grid line. Exposed for ad-hoc callers
 * (Tile drag/resize handlers). The grid size defaults to SNAP_GRID (20px)
 * but is parametric so tests can probe other grid sizes without touching the
 * shared constant.
 */
export function snap(n: number, grid: number = SNAP_GRID): number {
  if (grid <= 0) return n;
  return Math.round(n / grid) * grid;
}

/**
 * Snap a point. The `enabled` flag is the override exposed to Tile.tsx — when
 * the user holds Shift while dragging we pass false and the point is returned
 * unchanged. Centralized here so the same input/output contract is testable.
 */
export function snapPoint(p: Point, enabled: boolean, grid: number = SNAP_GRID): Point {
  if (!enabled) return { x: p.x, y: p.y };
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/**
 * Snap a rect's (w, h). Min sizes are caller-side (Tile enforces 120×80).
 */
export function snapSize(w: number, h: number, enabled: boolean, grid: number = SNAP_GRID): { w: number; h: number } {
  if (!enabled) return { w, h };
  return { w: snap(w, grid), h: snap(h, grid) };
}

/**
 * Compute the axis-aligned bounding box of all tile rects. Returns null when
 * the list is empty so the minimap can render a placeholder rather than a
 * degenerate (0×0) box.
 */
export function tilesBounds(tiles: Tile[]): Rect | null {
  if (tiles.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x + t.w > maxX) maxX = t.x + t.w;
    if (t.y + t.h > maxY) maxY = t.y + t.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Compute the camera viewport rect in canvas (world) coordinates. The minimap
 * draws this overlaid on top of the tile rects so the user sees what slice of
 * the world is currently on screen.
 */
export function viewportRect(cam: Camera, viewportW: number, viewportH: number): Rect {
  return {
    x: cam.x,
    y: cam.y,
    w: viewportW / cam.zoom,
    h: viewportH / cam.zoom,
  };
}
