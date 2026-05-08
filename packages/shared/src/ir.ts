import type { DiagramEngine } from "./engines";

export type NodeId = string;
export type EdgeId = string;
export type GroupId = string;
export type DiagramId = string;

export type NodeShape =
  | "rect" | "round" | "circle" | "diamond" | "hex" | "cyl";

export type EdgeKind = "solid" | "dashed" | "dotted" | "thick";
export type EdgeArrow = "normal" | "open" | "none";

export type LayoutDirection = "LR" | "RL" | "TB" | "BT";

export interface Node {
  id: NodeId;
  label: string;
  shape?: NodeShape;
  attrs?: Record<string, unknown>;
  groupId?: GroupId;
}

export interface Edge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  label?: string;
  kind?: EdgeKind;
  arrow?: EdgeArrow;
  attrs?: Record<string, unknown>;
}

export interface Group {
  id: GroupId;
  label: string;
  members: NodeId[];
  parent?: GroupId;
  attrs?: Record<string, unknown>;
}

export interface Layout {
  direction: LayoutDirection;
  spacing?: number;
  theme?: string;
}

export interface GraphIR {
  nodes: Record<NodeId, Node>;
  edges: Record<EdgeId, Edge>;
  groups: Record<GroupId, Group>;
  layout: Layout;
}

export type DiagramKind = "graph" | "passthrough";

export interface DiagramMeta {
  createdAt: string;
  updatedAt: string;
  tags: string[];
  sourcePaths: string[];
}

export interface Diagram {
  id: DiagramId;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  meta: DiagramMeta;
  annotations?: import("./annotations").Annotation[];   // NEW
}

export const PVIZ_VERSION = 1;

export interface PvizFile {
  version: typeof PVIZ_VERSION;
  id: DiagramId;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  meta: DiagramMeta;
  annotations?: import("./annotations").Annotation[];   // NEW
}

export function emptyGraphIR(direction: LayoutDirection = "LR"): GraphIR {
  return {
    nodes: {},
    edges: {},
    groups: {},
    layout: { direction },
  };
}

export function emptyMeta(now: string = new Date().toISOString()): DiagramMeta {
  return {
    createdAt: now,
    updatedAt: now,
    tags: [],
    sourcePaths: [],
  };
}
