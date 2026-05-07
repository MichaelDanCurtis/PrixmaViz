import { describe, expect, it } from "bun:test";
import { irToMermaid } from "../../src/renderers/mermaid";
import { emptyGraphIR } from "@prixmaviz/shared";

describe("irToMermaid", () => {
  it("emits flowchart with direction", () => {
    const ir = emptyGraphIR("TB");
    const out = irToMermaid(ir);
    expect(out.dsl.split("\n")[0]).toBe("flowchart TB");
  });

  it("emits ungrouped nodes with shapes", () => {
    const ir = emptyGraphIR("LR");
    ir.nodes.a = { id: "a", label: "A", shape: "rect" };
    ir.nodes.b = { id: "b", label: "B", shape: "round" };
    ir.nodes.c = { id: "c", label: "C", shape: "diamond" };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain("a[A]");
    expect(out.dsl).toContain("b(B)");
    expect(out.dsl).toContain("c{C}");
  });

  it("emits edges with labels and kinds", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    ir.nodes.b = { id: "b", label: "B" };
    ir.edges.e1 = { id: "e1", from: "a", to: "b", label: "go", kind: "dashed" };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain("a -.->|go| b");
  });

  it("emits subgraphs for groups", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A", groupId: "g1" };
    ir.groups.g1 = { id: "g1", label: "Backend", members: ["a"] };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain("subgraph g1[Backend]");
    expect(out.dsl).toContain("end");
  });

  it("escapes labels containing brackets", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A[1]" };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain('a["A[1]"]');
  });

  it("warns on unknown shape, falls back to rect", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A", shape: "wat" as never };
    const out = irToMermaid(ir);
    expect(out.warnings.some((w) => /shape.*wat/.test(w))).toBe(true);
    expect(out.dsl).toContain("a[A]");
  });
});
