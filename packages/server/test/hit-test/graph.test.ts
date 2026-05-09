import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphHitTester } from "../../src/hit-test/graph";

const svg = readFileSync(join(import.meta.dir, "../fixtures/mermaid-flow.svg"), "utf8");
const realSvg = readFileSync(join(import.meta.dir, "../fixtures/mermaid-flow-real.svg"), "utf8");

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

// Real Kroki-rendered Mermaid SVG — nodes use <path d="M-X -Y ..."> (outer-path style)
// or <rect class="basic label-container"> instead of the contrived fixture's plain <rect>.
//
// Verified coordinates from mermaid-flow-real.svg:
//   browser: translate(361.828125, 60),     path M -39.3046875 -27   → bbox [322.5, 33.0, 401.1, 87.0]
//   tauri:   translate(361.828125, 223.117), rect x=-68.3 y=-27 w=136.6 h=54 → bbox [293.5, 196.1, 430.1, 250.1]
//   webview: translate(361.828125, 404.016), rect x=-89.3 y=-27 w=178.5 h=54 → bbox [272.6, 377.0, 451.1, 431.0]
describe("graphHitTester (real Kroki Mermaid SVG)", () => {
  it("byPoint hits the 'browser' node at its center", () => {
    // Center of browser bbox: [322.5, 33.0, 401.1, 87.0] → ~(362, 60)
    const r = graphHitTester.byPoint(realSvg, 362, 60);
    expect(r.nodes).toContain("browser");
  });

  it("byPoint misses outside any node", () => {
    const r = graphHitTester.byPoint(realSvg, 10, 10);
    expect(r.nodes).toEqual([]);
  });

  it("byRegion captures browser, tauri and webview when region spans them", () => {
    // Region covering the right column: x=[270,460] y=[0,450]
    // browser bbox: [322.5, 33, 401.1, 87] — inside
    // tauri  bbox: [293.5, 196.1, 430.1, 250.1] — inside
    // webview bbox: [272.6, 377.0, 451.1, 431.0] — inside
    const r = graphHitTester.byRegion(realSvg, { x: 270, y: 0, w: 200, h: 450 });
    expect(r.nodes).toEqual(expect.arrayContaining(["browser", "tauri", "webview"]));
  });
});
