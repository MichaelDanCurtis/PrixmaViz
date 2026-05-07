import { describe, expect, it } from "bun:test";
import { validateOp } from "../../src/ir/validate";
import { emptyGraphIR } from "@prixmaviz/shared";

describe("validateOp", () => {
  it("rejects add_node when id already exists", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    const err = validateOp(ir, { op: "add_node", node: { id: "a", label: "A" } });
    expect(err).toMatch(/exists/);
  });

  it("rejects add_edge with missing from", () => {
    const ir = emptyGraphIR();
    ir.nodes.b = { id: "b", label: "B" };
    const err = validateOp(ir, {
      op: "add_edge",
      edge: { id: "e1", from: "a", to: "b" },
    });
    expect(err).toMatch(/from.*missing/);
  });

  it("rejects update_node when id missing", () => {
    const ir = emptyGraphIR();
    const err = validateOp(ir, { op: "update_node", id: "x", patch: { label: "Y" } });
    expect(err).toMatch(/missing/);
  });

  it("accepts add_node with new id", () => {
    const ir = emptyGraphIR();
    expect(validateOp(ir, { op: "add_node", node: { id: "a", label: "A" } })).toBeNull();
  });

  it("accepts remove_node even with edges (cascade handled in engine)", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    expect(validateOp(ir, { op: "remove_node", id: "a" })).toBeNull();
  });

  it("rejects add_group with members referencing missing nodes", () => {
    const ir = emptyGraphIR();
    const err = validateOp(ir, {
      op: "add_group",
      group: { id: "g", label: "G", members: ["a"] },
    });
    expect(err).toMatch(/member.*missing/);
  });

  it("accepts set_layout with partial patch", () => {
    const ir = emptyGraphIR();
    expect(validateOp(ir, { op: "set_layout", patch: { direction: "TB" } })).toBeNull();
  });
});
