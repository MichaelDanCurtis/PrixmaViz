import type { DiagramEngine } from "./engines";
import type { DiagramId } from "./ir";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Tile {
  id: string;
  diagramId: DiagramId;
  diagramSlug: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface WorkspaceState {
  version: 1;
  camera: Camera;
  tiles: Tile[];
}

export const WORKSPACE_VERSION = 1;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const CAMERA_BOUND = 50000;
export const SNAP_GRID = 20;

export function newTileId(): string {
  return `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function defaultWorkspace(): WorkspaceState {
  return { version: 1, camera: { x: 0, y: 0, zoom: 1 }, tiles: [] };
}

export function clampCamera(c: Camera): Camera {
  return {
    x: Math.max(-CAMERA_BOUND, Math.min(CAMERA_BOUND, c.x)),
    y: Math.max(-CAMERA_BOUND, Math.min(CAMERA_BOUND, c.y)),
    zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom)),
  };
}
