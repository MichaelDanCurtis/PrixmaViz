import { describe, expect, it } from "bun:test";
import { WorkspaceStore } from "../../src/canvas/store";
import { defaultWorkspace } from "@prixmaviz/shared";

describe("WorkspaceStore", () => {
  it("starts with default workspace", () => {
    const s = new WorkspaceStore();
    expect(s.get()).toEqual(defaultWorkspace());
  });

  it("addTile appends + assigns z", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.addTile({ id: "t2", diagramId: "d2", diagramSlug: "b", x: 50, y: 50, w: 200, h: 100, z: 0 });
    expect(s.get().tiles.length).toBe(2);
  });

  it("updateTile patches", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.updateTile("t1", { x: 100, y: 100 });
    const t = s.get().tiles[0]!;
    expect(t.x).toBe(100);
    expect(t.y).toBe(100);
  });

  it("removeTile removes", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.removeTile("t1");
    expect(s.get().tiles).toEqual([]);
  });

  it("setCamera clamps", () => {
    const s = new WorkspaceStore();
    s.setCamera({ x: 99999, y: -99999, zoom: 100 });
    const c = s.get().camera;
    expect(c.x).toBe(50000);
    expect(c.y).toBe(-50000);
    expect(c.zoom).toBe(4);
  });
});

describe("WorkspaceStore.focused", () => {
  it("focus() sets lastFocused; getFocused() returns it", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.focus("t1");
    const f = s.getFocused();
    expect(f?.id).toBe("t1");
    expect(f?.diagramId).toBe("d1");
  });

  it("getFocused returns undefined when nothing focused", () => {
    const s = new WorkspaceStore();
    expect(s.getFocused()).toBeUndefined();
  });

  it("focus() updates lastFocused timestamp", async () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.addTile({ id: "t2", diagramId: "d2", diagramSlug: "b", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.focus("t1");
    await new Promise(r => setTimeout(r, 10));
    s.focus("t2");
    expect(s.getFocused()?.id).toBe("t2");
  });

  it("removeTile clears focus if removed tile was focused", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.focus("t1");
    s.removeTile("t1");
    expect(s.getFocused()).toBeUndefined();
  });

  it("focus(id) on missing tile is a no-op", () => {
    const s = new WorkspaceStore();
    s.focus("nonexistent");
    expect(s.getFocused()).toBeUndefined();
  });
});
