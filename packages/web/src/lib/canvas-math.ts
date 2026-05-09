import type { Camera } from "@prixmaviz/shared";

export interface Point { x: number; y: number; }

export function toViewport(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function toCanvas(p: Point, cam: Camera): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}
