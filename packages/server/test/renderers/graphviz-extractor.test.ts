import { describe, expect, it } from "bun:test";
import { extractGraphFromDot } from "../../src/renderers/graphviz-extractor";

describe("extractGraphFromDot", () => {
  it("extracts nodes and edges with positions from a simple digraph", async () => {
    const dot = `
      digraph G {
        a [label="Alpha", shape=box];
        b [label="Beta", shape=diamond];
        a -> b [label="go"];
      }
    `;
    const ir = await extractGraphFromDot(dot);
    expect(Object.keys(ir.nodes)).toHaveLength(2);
    expect(ir.nodes.a!.label).toBe("Alpha");
    expect(ir.nodes.a!.shape).toBe("rect"); // dot "box" → IR "rect"
    expect(ir.nodes.b!.shape).toBe("diamond");
    expect(Object.keys(ir.edges)).toHaveLength(1);
    const edge = Object.values(ir.edges)[0]!;
    expect(edge.from).toBe("a");
    expect(edge.to).toBe("b");
    expect(edge.label).toBe("go");
    expect(typeof (ir.nodes.a as unknown as { _x: number })._x).toBe("number");
  });

  it("throws on invalid DOT", async () => {
    await expect(extractGraphFromDot("not valid {{{")).rejects.toThrow();
  });
});
