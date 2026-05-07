import type { GraphIR, PatchOp } from "@prixmaviz/shared";
import { cloneIR } from "./clone";
import { validateOp } from "./validate";

export type ApplyResult =
  | { ok: true; ir: GraphIR; warnings: string[] }
  | { ok: false; error: string; opIndex: number };

export function applyPatch(ir: GraphIR, ops: PatchOp[]): ApplyResult {
  const draft = cloneIR(ir);
  const warnings: string[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const err = validateOp(draft, op);
    if (err) return { ok: false, error: err, opIndex: i };
    applyOp(draft, op);
  }

  return { ok: true, ir: draft, warnings };
}

function applyOp(ir: GraphIR, op: PatchOp): void {
  switch (op.op) {
    case "add_node":
      ir.nodes[op.node.id] = { ...op.node };
      break;

    case "update_node":
      ir.nodes[op.id] = { ...ir.nodes[op.id]!, ...op.patch, id: op.id };
      break;

    case "remove_node": {
      delete ir.nodes[op.id];
      for (const eid of Object.keys(ir.edges)) {
        const e = ir.edges[eid]!;
        if (e.from === op.id || e.to === op.id) delete ir.edges[eid];
      }
      for (const gid of Object.keys(ir.groups)) {
        const g = ir.groups[gid]!;
        const filtered = g.members.filter((m) => m !== op.id);
        if (filtered.length !== g.members.length) {
          ir.groups[gid] = { ...g, members: filtered };
        }
      }
      break;
    }

    case "add_edge":
      ir.edges[op.edge.id] = { ...op.edge };
      break;

    case "update_edge":
      ir.edges[op.id] = { ...ir.edges[op.id]!, ...op.patch, id: op.id };
      break;

    case "remove_edge":
      delete ir.edges[op.id];
      break;

    case "add_group":
      ir.groups[op.group.id] = {
        ...op.group,
        members: [...op.group.members],
      };
      break;

    case "update_group":
      ir.groups[op.id] = { ...ir.groups[op.id]!, ...op.patch, id: op.id };
      break;

    case "remove_group": {
      const g = ir.groups[op.id]!;
      delete ir.groups[op.id];
      for (const mid of g.members) {
        const node = ir.nodes[mid];
        if (node?.groupId === op.id) {
          ir.nodes[mid] = { ...node, groupId: undefined };
        }
      }
      break;
    }

    case "set_layout":
      ir.layout = { ...ir.layout, ...op.patch };
      break;

    case "set_meta":
      break;
  }
}
