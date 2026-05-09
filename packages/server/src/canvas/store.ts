import { clampCamera, defaultWorkspace, type Camera, type Tile, type WorkspaceState } from "@prixmaviz/shared";

export class WorkspaceStore {
  private state: WorkspaceState = defaultWorkspace();

  get(): WorkspaceState {
    return structuredClone(this.state);
  }

  load(state: WorkspaceState): void {
    this.state = state;
  }

  addTile(tile: Tile): Tile {
    this.state.tiles.push(tile);
    return tile;
  }

  updateTile(id: string, patch: Partial<Tile>): Tile | undefined {
    const idx = this.state.tiles.findIndex(t => t.id === id);
    if (idx < 0) return undefined;
    this.state.tiles[idx] = { ...this.state.tiles[idx]!, ...patch, id };
    return this.state.tiles[idx];
  }

  removeTile(id: string): void {
    this.state.tiles = this.state.tiles.filter(t => t.id !== id);
  }

  setCamera(c: Camera): void {
    this.state.camera = clampCamera(c);
  }
}
