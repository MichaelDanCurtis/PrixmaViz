import { describe, expect, it } from "bun:test";
import { nullHitTester } from "../../src/hit-test/null";

describe("nullHitTester", () => {
  it("byPoint returns empty nodes", () => {
    const r = nullHitTester.byPoint("<svg/>", 10, 20);
    expect(r.nodes).toEqual([]);
    expect(r.data).toBeUndefined();
  });

  it("byRegion returns empty nodes", () => {
    const r = nullHitTester.byRegion("<svg/>", { x: 0, y: 0, w: 10, h: 10 });
    expect(r.nodes).toEqual([]);
    expect(r.dataRange).toBeUndefined();
  });
});
