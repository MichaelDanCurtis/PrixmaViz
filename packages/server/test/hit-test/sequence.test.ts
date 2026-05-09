import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sequenceHitTester } from "../../src/hit-test/sequence";

const svg = readFileSync(join(import.meta.dir, "../fixtures/plantuml-sequence.svg"), "utf8");
const realSvg = readFileSync(join(import.meta.dir, "../fixtures/plantuml-sequence-real.svg"), "utf8");

describe("sequenceHitTester", () => {
  it("hits User actor at (80,30)", () => {
    const r = sequenceHitTester.byPoint(svg, 80, 30);
    expect(r.nodes).toContain("User");
  });

  it("hits Server at (200,30)", () => {
    const r = sequenceHitTester.byPoint(svg, 200, 30);
    expect(r.nodes).toContain("Server");
  });

  it("region covers User + Server", () => {
    const r = sequenceHitTester.byRegion(svg, { x: 0, y: 0, w: 250, h: 100 });
    expect(r.nodes.sort()).toEqual(["Server", "User"]);
  });
});

describe("sequenceHitTester (real Kroki PlantUML)", () => {
  it("hits User column via byPoint inside lifeline", () => {
    // User lifeline: x=19.9551, width=8, padded → x:[-8.04, 55.96], y:[81.30, 305.23]
    // Click at x=24, y=150 falls within User's padded column
    const r = sequenceHitTester.byPoint(realSvg, 24, 150);
    expect(r.nodes).toContain("User");
  });

  it("byRegion captures multiple participants", () => {
    // Region x:0-200, y:80-280 covers User (x≈-8..56) and Webview (x≈106..171)
    const r = sequenceHitTester.byRegion(realSvg, { x: 0, y: 80, w: 200, h: 200 });
    expect(r.nodes).toEqual(expect.arrayContaining(["User", "Webview"]));
  });

  it("returns empty when click is far from any lifeline", () => {
    const r = sequenceHitTester.byPoint(realSvg, 1000, 1000);
    expect(r.nodes).toEqual([]);
  });
});
