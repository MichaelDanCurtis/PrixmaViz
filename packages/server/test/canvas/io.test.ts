import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspace, writeWorkspace } from "../../src/canvas/io";
import { defaultWorkspace } from "@prixmaviz/shared";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ws-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("workspace IO", () => {
  it("returns default when file missing", async () => {
    const w = await readWorkspace(join(dir, "missing.json"));
    expect(w).toEqual(defaultWorkspace());
  });

  it("roundtrip", async () => {
    const ws = defaultWorkspace();
    ws.tiles.push({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 1, y: 2, w: 3, h: 4, z: 0 });
    ws.camera = { x: 50, y: 100, zoom: 1.5 };
    const path = join(dir, "ws.json");
    await writeWorkspace(path, ws);
    const back = await readWorkspace(path);
    expect(back.tiles[0]?.id).toBe("t1");
    expect(back.camera.zoom).toBe(1.5);
  });

  it("returns default on parse error", async () => {
    const path = join(dir, "bad.json");
    await Bun.write(path, "{not json");
    const w = await readWorkspace(path);
    expect(w).toEqual(defaultWorkspace());
  });
});
