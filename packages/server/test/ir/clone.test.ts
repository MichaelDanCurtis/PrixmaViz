import { describe, expect, it } from "bun:test";
import { cloneIR } from "../../src/ir/clone";
import type { GraphIR } from "@prixmaviz/shared";

describe("cloneIR", () => {
  it("returns a structurally equal but distinct object", () => {
    const ir: GraphIR = {
      nodes: { a: { id: "a", label: "A", attrs: { color: "red" } } },
      edges: { e1: { id: "e1", from: "a", to: "a" } },
      groups: { g1: { id: "g1", label: "G", members: ["a"] } },
      layout: { direction: "LR" },
    };
    const c = cloneIR(ir);
    expect(c).toEqual(ir);
    expect(c).not.toBe(ir);
    expect(c.nodes).not.toBe(ir.nodes);
    expect(c.nodes.a).not.toBe(ir.nodes.a);
    expect(c.nodes.a.attrs).not.toBe(ir.nodes.a.attrs);
    expect(c.groups.g1.members).not.toBe(ir.groups.g1.members);
  });

  it("survives mutation of clone without touching original", () => {
    const ir: GraphIR = {
      nodes: { a: { id: "a", label: "A" } },
      edges: {},
      groups: {},
      layout: { direction: "LR" },
    };
    const c = cloneIR(ir);
    c.nodes.b = { id: "b", label: "B" };
    expect(ir.nodes.b).toBeUndefined();
  });
});
