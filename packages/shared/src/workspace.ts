import type { Camera, Tile } from "./canvas";

export interface Workspace {
  id: string;                          // UUID
  name: string | null;
  camera: Camera;
  tiles: Tile[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}
