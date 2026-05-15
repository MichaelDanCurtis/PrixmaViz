import { describe, expect, it } from "bun:test";
import { extractGraphFromD2 } from "../../src/renderers/d2-extractor";

describe("extractGraphFromD2", () => {
  it("extracts nodes and edges from simple D2", async () => {
    const d2 = `
      a: Alpha
      b: Beta
      a -> b: go
    `;
    const ir = await extractGraphFromD2(d2);
    expect(Object.keys(ir.nodes)).toHaveLength(2);
    expect(ir.nodes.a!.label).toBe("Alpha");
    expect(Object.keys(ir.edges)).toHaveLength(1);
    const edge = Object.values(ir.edges)[0]!;
    expect(edge.from).toBe("a");
    expect(edge.to).toBe("b");
    expect(edge.label).toBe("go");
  });

  it("handles edges without labels", async () => {
    const d2 = `
      a: A
      b: B
      a -> b
    `;
    const ir = await extractGraphFromD2(d2);
    expect(Object.keys(ir.edges)).toHaveLength(1);
  });

  it("auto-creates nodes referenced by edges", async () => {
    const d2 = `c -> d`;
    const ir = await extractGraphFromD2(d2);
    expect(Object.keys(ir.nodes)).toHaveLength(2);
    expect(ir.nodes.c).toBeDefined();
    expect(ir.nodes.d).toBeDefined();
  });
});
