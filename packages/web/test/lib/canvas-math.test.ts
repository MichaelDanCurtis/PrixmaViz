import { describe, expect, it } from "vitest";
import type { Tile } from "@prixmaviz/shared";
import {
  snap, snapPoint, snapSize, tilesBounds, toCanvas, toViewport, viewportRect,
} from "../../src/lib/canvas-math";

describe("canvas math", () => {
  const cam = { x: 100, y: 100, zoom: 2 };

  it("toViewport projects canvas point", () => {
    const p = toViewport({ x: 200, y: 300 }, cam);
    expect(p).toEqual({ x: 200, y: 400 });
  });

  it("toCanvas inverts viewport point", () => {
    const p = toCanvas({ x: 200, y: 400 }, cam);
    expect(p).toEqual({ x: 200, y: 300 });
  });

  it("roundtrips", () => {
    const orig = { x: 42, y: -17 };
    const v = toViewport(orig, cam);
    const back = toCanvas(v, cam);
    expect(back).toEqual(orig);
  });

  it("handles zoom=1, origin=0", () => {
    const c = { x: 0, y: 0, zoom: 1 };
    expect(toViewport({ x: 5, y: 5 }, c)).toEqual({ x: 5, y: 5 });
    expect(toCanvas({ x: 5, y: 5 }, c)).toEqual({ x: 5, y: 5 });
  });
});

describe("snap", () => {
  it("rounds to nearest grid line", () => {
    expect(snap(0)).toBe(0);
    expect(snap(9)).toBe(0);
    expect(snap(10)).toBe(20);
    expect(snap(11)).toBe(20);
    expect(snap(20)).toBe(20);
    expect(snap(29)).toBe(20);
    expect(snap(31)).toBe(40);
  });

  it("handles negative coordinates", () => {
    // JS `Math.round(-0.45) === -0`; normalize with `+0` so the assertion
    // is on numeric equality rather than +0/-0 identity.
    expect(snap(-9) + 0).toBe(0);
    expect(snap(-10) + 0).toBe(0); // Math.round(-0.5) === 0 in JS
    expect(snap(-11)).toBe(-20);
    expect(snap(-21)).toBe(-20);
    expect(snap(-30)).toBe(-20); // Math.round(-1.5) === -1
  });

  it("respects custom grid size", () => {
    expect(snap(17, 10)).toBe(20);
    expect(snap(14, 10)).toBe(10);
    expect(snap(33, 25)).toBe(25);
    expect(snap(38, 25)).toBe(50);
  });

  it("is a no-op when grid <= 0", () => {
    expect(snap(17, 0)).toBe(17);
    expect(snap(17, -5)).toBe(17);
  });
});

describe("snapPoint", () => {
  it("snaps when enabled", () => {
    expect(snapPoint({ x: 17, y: 23 }, true)).toEqual({ x: 20, y: 20 });
  });

  it("passes through when disabled (shift-drag)", () => {
    expect(snapPoint({ x: 17, y: 23 }, false)).toEqual({ x: 17, y: 23 });
  });

  it("does not mutate the input point", () => {
    const p = { x: 17, y: 23 };
    snapPoint(p, true);
    expect(p).toEqual({ x: 17, y: 23 });
  });
});

describe("snapSize", () => {
  it("snaps w/h when enabled", () => {
    expect(snapSize(157, 81, true)).toEqual({ w: 160, h: 80 });
  });

  it("passes through when disabled", () => {
    expect(snapSize(157, 81, false)).toEqual({ w: 157, h: 81 });
  });
});

describe("tilesBounds", () => {
  it("returns null for an empty list", () => {
    expect(tilesBounds([])).toBeNull();
  });

  it("computes the bounding rect of a single tile", () => {
    const tiles: Tile[] = [
      { id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 200, w: 600, h: 400, z: 0 },
    ];
    expect(tilesBounds(tiles)).toEqual({ x: 100, y: 200, w: 600, h: 400 });
  });

  it("computes the union of multiple tiles", () => {
    const tiles: Tile[] = [
      { id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 100, w: 200, h: 200, z: 0 },
      { id: "t2", diagramId: "d2", diagramSlug: "b", x: 500, y: 50, w: 200, h: 100, z: 0 },
      { id: "t3", diagramId: "d3", diagramSlug: "c", x: -50, y: 400, w: 100, h: 100, z: 0 },
    ];
    // minX=-50, minY=50, maxX=700, maxY=500
    expect(tilesBounds(tiles)).toEqual({ x: -50, y: 50, w: 750, h: 450 });
  });
});

describe("viewportRect", () => {
  it("returns camera position + scaled viewport dims", () => {
    expect(viewportRect({ x: 10, y: 20, zoom: 1 }, 1024, 768)).toEqual({
      x: 10, y: 20, w: 1024, h: 768,
    });
  });

  it("scales dims inversely with zoom", () => {
    expect(viewportRect({ x: 0, y: 0, zoom: 2 }, 1024, 768)).toEqual({
      x: 0, y: 0, w: 512, h: 384,
    });
  });
});
