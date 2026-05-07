import { describe, expect, it } from "bun:test";
import { applyPatch } from "../../src/ir/engine";
import { emptyGraphIR } from "@prixmaviz/shared";
import type { GraphIR } from "@prixmaviz/shared";

describe("applyPatch", () => {
  it("applies multiple ops atomically", () => {
    const ir = emptyGraphIR();
    const result = applyPatch(ir, [
      { op: "add_node", node: { id: "a", label: "A" } },
      { op: "add_node", node: { id: "b", label: "B" } },
      { op: "add_edge", edge: { id: "e1", from: "a", to: "b" } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.ir.nodes)).toEqual(["a", "b"]);
      expect(Object.keys(result.ir.edges)).toEqual(["e1"]);
    }
  });

  it("rejects whole batch if one op invalid; original ir untouched", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    const result = applyPatch(ir, [
      { op: "add_node", node: { id: "b", label: "B" } },
      { op: "add_node", node: { id: "a", label: "Dup" } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.opIndex).toBe(1);
      expect(result.error).toMatch(/exists/);
    }
    expect(ir.nodes.b).toBeUndefined();
  });

  it("cascades remove_node to its edges", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    ir.nodes.b = { id: "b", label: "B" };
    ir.edges.e1 = { id: "e1", from: "a", to: "b" };
    ir.edges.e2 = { id: "e2", from: "b", to: "a" };
    const result = applyPatch(ir, [{ op: "remove_node", id: "a" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.ir.edges)).toEqual([]);
      expect(Object.keys(result.ir.nodes)).toEqual(["b"]);
    }
  });

  it("removes node from group members on remove_node", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    ir.nodes.b = { id: "b", label: "B" };
    ir.groups.g1 = { id: "g1", label: "G", members: ["a", "b"] };
    const result = applyPatch(ir, [{ op: "remove_node", id: "a" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.groups.g1.members).toEqual(["b"]);
    }
  });

  it("update_node merges patch", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A", shape: "rect" };
    const result = applyPatch(ir, [
      { op: "update_node", id: "a", patch: { label: "AA" } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.nodes.a.label).toBe("AA");
      expect(result.ir.nodes.a.shape).toBe("rect");
    }
  });

  it("set_layout merges direction", () => {
    const ir = emptyGraphIR("LR");
    const result = applyPatch(ir, [
      { op: "set_layout", patch: { direction: "TB", spacing: 40 } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.layout.direction).toBe("TB");
      expect(result.ir.layout.spacing).toBe(40);
    }
  });
});
