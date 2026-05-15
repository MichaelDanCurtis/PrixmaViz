import { describe, expect, it } from "bun:test";
import { mapShapeToMaster, ALL_MASTERS } from "../../src/vsdx/stencils";

describe("mapShapeToMaster", () => {
  it.each([
    ["rect", "Process"],
    ["roundedRect", "Terminator"],
    ["round", "Terminator"],
    ["diamond", "Decision"],
    ["parallelogram", "Data"],
    ["document", "Document"],
    ["cylinder", "Stored Data"],
    ["database", "Stored Data"],
    ["cloud", "Cloud"],
    ["subroutine", "Predefined Process"],
    ["manualInput", "Manual Input"],
    ["display", "Display"],
    ["connector", "Connector"],
    ["offPageConnector", "Off-page Connector"],
    ["circle", "Circle"],
    ["ellipse", "Ellipse"],
    ["triangle", "Triangle"],
    ["pentagon", "Pentagon"],
    ["hexagon", "Hexagon"],
    ["octagon", "Octagon"],
    ["star", "5-Point Star"],
    ["arrow", "Right Arrow"],
  ] as const)("maps IR shape '%s' to Visio master '%s'", (irShape, master) => {
    const result = mapShapeToMaster(irShape);
    expect(result.master).toBe(master);
  });

  it("returns Process fallback for unknown shape with a warning", () => {
    const result = mapShapeToMaster("unknown-shape");
    expect(result.master).toBe("Process");
    expect(result.fallback).toBe(true);
  });

  it("ALL_MASTERS lists every supported Visio master exactly once", () => {
    const set = new Set(ALL_MASTERS);
    expect(set.size).toBe(ALL_MASTERS.length);
    expect(set.has("Process")).toBe(true);
    expect(set.has("Decision")).toBe(true);
  });
});
