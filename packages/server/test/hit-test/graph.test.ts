import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphHitTester } from "../../src/hit-test/graph";

const svg = readFileSync(join(import.meta.dir, "../fixtures/mermaid-flow.svg"), "utf8");

describe("graphHitTester.byPoint", () => {
  it("hits Auth node center (60,40)", () => {
    const r = graphHitTester.byPoint(svg, 60, 40);
    expect(r.nodes).toEqual(["Auth"]);
  });

  it("hits DB node center (180,40)", () => {
    const r = graphHitTester.byPoint(svg, 180, 40);
    expect(r.nodes).toEqual(["DB"]);
  });

  it("returns empty for empty space (5,5)", () => {
    const r = graphHitTester.byPoint(svg, 5, 5);
    expect(r.nodes).toEqual([]);
  });
});

describe("graphHitTester.byRegion", () => {
  it("captures Auth + DB when region covers both", () => {
    const r = graphHitTester.byRegion(svg, { x: 0, y: 0, w: 220, h: 80 });
    expect(r.nodes.sort()).toEqual(["Auth", "DB"]);
  });

  it("captures only Cache when region tight on right", () => {
    const r = graphHitTester.byRegion(svg, { x: 240, y: 0, w: 80, h: 80 });
    expect(r.nodes).toEqual(["Cache"]);
  });

  it("captures all 3 with full-canvas region", () => {
    const r = graphHitTester.byRegion(svg, { x: 0, y: 0, w: 320, h: 80 });
    expect(r.nodes.sort()).toEqual(["Auth", "Cache", "DB"]);
  });
});
