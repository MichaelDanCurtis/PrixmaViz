import { describe, expect, it } from "vitest";
import { toCanvas, toViewport } from "../../src/lib/canvas-math";

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
