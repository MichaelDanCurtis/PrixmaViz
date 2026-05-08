import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sequenceHitTester } from "../../src/hit-test/sequence";

const svg = readFileSync(join(import.meta.dir, "../fixtures/plantuml-sequence.svg"), "utf8");

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
