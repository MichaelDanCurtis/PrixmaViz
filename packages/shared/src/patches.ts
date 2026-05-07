import type {
  Edge, EdgeId, Group, GroupId, Layout, Node, NodeId,
} from "./ir";

export type PatchOp =
  | { op: "add_node"; node: Node }
  | { op: "update_node"; id: NodeId; patch: Partial<Node> }
  | { op: "remove_node"; id: NodeId }
  | { op: "add_edge"; edge: Edge }
  | { op: "update_edge"; id: EdgeId; patch: Partial<Edge> }
  | { op: "remove_edge"; id: EdgeId }
  | { op: "add_group"; group: Group }
  | { op: "update_group"; id: GroupId; patch: Partial<Group> }
  | { op: "remove_group"; id: GroupId }
  | { op: "set_layout"; patch: Partial<Layout> }
  | { op: "set_meta"; key: string; value: unknown };

export type PatchOpType = PatchOp["op"];
