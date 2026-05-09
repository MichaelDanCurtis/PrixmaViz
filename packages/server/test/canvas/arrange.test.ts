import { describe, expect, it } from "bun:test";
import { arrange } from "../../src/canvas/arrange";
import type { Tile } from "@prixmaviz/shared";

const t = (id: string): Tile => ({ id, diagramId: id, diagramSlug: id, x: 0, y: 0, w: 200, h: 100, z: 0 });

describe("arrange", () => {
  it("grid: 4 tiles → 2x2", () => {
    const tiles = arrange([t("a"), t("b"), t("c"), t("d")], "grid", 20);
    expect(tiles[0]).toMatchObject({ id: "a", x: 0, y: 0 });
    expect(tiles[1]).toMatchObject({ id: "b", x: 220, y: 0 });
    expect(tiles[2]).toMatchObject({ id: "c", x: 0, y: 120 });
    expect(tiles[3]).toMatchObject({ id: "d", x: 220, y: 120 });
  });

  it("horizontal: row", () => {
    const tiles = arrange([t("a"), t("b")], "horizontal", 20);
    expect(tiles[0]?.x).toBe(0);
    expect(tiles[1]?.x).toBe(220);
    expect(tiles[0]?.y).toBe(0);
    expect(tiles[1]?.y).toBe(0);
  });

  it("vertical: column", () => {
    const tiles = arrange([t("a"), t("b")], "vertical", 20);
    expect(tiles[0]?.y).toBe(0);
    expect(tiles[1]?.y).toBe(120);
  });
});
