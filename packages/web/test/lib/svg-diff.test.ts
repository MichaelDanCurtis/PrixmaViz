import { describe, expect, it } from "vitest";
import { diffSvgNodeIds } from "../../src/lib/svg-diff";

describe("diffSvgNodeIds", () => {
  it("computes added/removed/kept", () => {
    const r = diffSvgNodeIds(["a", "b"], ["b", "c"]);
    expect(r.added).toEqual(["c"]);
    expect(r.removed).toEqual(["a"]);
    expect(r.kept).toEqual(["b"]);
  });

  it("empty prev → all added", () => {
    const r = diffSvgNodeIds([], ["a", "b"]);
    expect(r.added).toEqual(["a", "b"]);
    expect(r.removed).toEqual([]);
  });
});
