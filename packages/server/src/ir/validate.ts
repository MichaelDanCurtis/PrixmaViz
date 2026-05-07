import type { GraphIR, PatchOp } from "@prixmaviz/shared";

export function validateOp(ir: GraphIR, op: PatchOp): string | null {
  switch (op.op) {
    case "add_node":
      if (ir.nodes[op.node.id]) return `node "${op.node.id}" exists`;
      if (op.node.groupId && !ir.groups[op.node.groupId])
        return `groupId "${op.node.groupId}" missing`;
      return null;

    case "update_node":
      if (!ir.nodes[op.id]) return `node "${op.id}" missing`;
      return null;

    case "remove_node":
      if (!ir.nodes[op.id]) return `node "${op.id}" missing`;
      return null;

    case "add_edge":
      if (ir.edges[op.edge.id]) return `edge "${op.edge.id}" exists`;
      if (!ir.nodes[op.edge.from]) return `edge from "${op.edge.from}" missing`;
      if (!ir.nodes[op.edge.to]) return `edge to "${op.edge.to}" missing`;
      return null;

    case "update_edge":
      if (!ir.edges[op.id]) return `edge "${op.id}" missing`;
      return null;

    case "remove_edge":
      if (!ir.edges[op.id]) return `edge "${op.id}" missing`;
      return null;

    case "add_group":
      if (ir.groups[op.group.id]) return `group "${op.group.id}" exists`;
      for (const m of op.group.members) {
        if (!ir.nodes[m]) return `group member "${m}" missing`;
      }
      if (op.group.parent && !ir.groups[op.group.parent])
        return `parent group "${op.group.parent}" missing`;
      return null;

    case "update_group":
      if (!ir.groups[op.id]) return `group "${op.id}" missing`;
      return null;

    case "remove_group":
      if (!ir.groups[op.id]) return `group "${op.id}" missing`;
      return null;

    case "set_layout":
      return null;

    case "set_meta":
      return null;
  }
}
