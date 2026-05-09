import { describe, expect, it } from "bun:test";
import { chartHitTester } from "../../src/hit-test/chart";

describe("chartHitTester (Vega-Lite)", () => {
  it("inverts pixel region to data range for ordinal x + quantitative y", () => {
    const dsl = JSON.stringify({
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "data": { "values": [
        { "engine": "mermaid", "renders": 14 },
        { "engine": "d2", "renders": 3 },
        { "engine": "graphviz", "renders": 5 },
      ]},
      "mark": "bar",
      "encoding": {
        "x": { "field": "engine", "type": "nominal" },
        "y": { "field": "renders", "type": "quantitative" }
      },
      "width": 300, "height": 200
    });
    const svgWithSpec = `<!--prixmaviz-spec:${Buffer.from(dsl).toString("base64")}--><svg/>`;
    const r = chartHitTester.byRegion(svgWithSpec, { x: 0, y: 0, w: 300, h: 200 });
    expect(r.dataRange).toBeDefined();
  });

  it("returns empty range when spec missing", () => {
    const r = chartHitTester.byRegion("<svg/>", { x: 0, y: 0, w: 100, h: 100 });
    expect(r.nodes).toEqual([]);
    expect(r.dataRange).toBeUndefined();
  });
});
