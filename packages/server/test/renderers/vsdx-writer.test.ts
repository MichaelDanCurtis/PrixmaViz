import { describe, expect, it } from "bun:test";
import { writeVsdxFromIr } from "../../src/renderers/vsdx-writer";
import { parseVsdx } from "../../src/renderers/vsdx-parse";
import type { GraphIR, Node } from "@prixmaviz/shared";

function sampleIr(): GraphIR {
  return {
    layout: { direction: "TB" },
    nodes: {
      a: { id: "a", label: "Alpha", shape: "rect",    _x: 1.0, _y: 5.0 } as unknown as GraphIR["nodes"][string],
      b: { id: "b", label: "Beta",  shape: "diamond", _x: 3.0, _y: 5.0 } as unknown as GraphIR["nodes"][string],
    },
    edges: {
      e1: { id: "e1", from: "a", to: "b", label: "go" },
    },
    groups: {},
  };
}

describe("writeVsdxFromIr", () => {
  it("produces a valid ZIP (PK magic)", async () => {
    const { bytes } = await writeVsdxFromIr(sampleIr());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it("round-trips through parser to the same shape/connector graph", async () => {
    const ir = sampleIr();
    const { bytes } = await writeVsdxFromIr(ir);
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages).toHaveLength(1);
    const page = parsed.pages[0]!;
    expect(page.shapes).toHaveLength(2);
    const a = page.shapes.find((s) => s.text === "Alpha")!;
    const b = page.shapes.find((s) => s.text === "Beta")!;
    expect(a.master).toBe("Process");
    expect(b.master).toBe("Decision");
    expect(page.connectors).toHaveLength(1);
    expect(page.connectors[0]!.text).toBe("go");
  });

  it("warns on edges referencing missing nodes", async () => {
    const ir: GraphIR = {
      layout: { direction: "TB" },
      nodes: { a: { id: "a", label: "A", shape: "rect" } as Node },
      edges: {
        e1: { id: "e1", from: "a", to: "ghost" },   // ghost doesn't exist
        e2: { id: "e2", from: "phantom", to: "a" }, // phantom doesn't exist
      },
      groups: {},
    };
    const { warnings } = await writeVsdxFromIr(ir);
    expect(warnings.length).toBe(2);
    expect(warnings.join("\n")).toContain("ghost");
    expect(warnings.join("\n")).toContain("phantom");
  });
});
