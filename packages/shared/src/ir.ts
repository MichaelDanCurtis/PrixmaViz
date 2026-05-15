import type { DiagramEngine } from "./engines";

export type NodeId = string;
export type EdgeId = string;
export type GroupId = string;
export type DiagramId = string;

export type NodeShape =
  | "rect" | "round" | "circle" | "diamond" | "hex" | "cyl"
  | "ellipse" | "parallelogram" | "cylinder" | "triangle"
  | "hexagon" | "octagon" | "star";

export type EdgeKind = "solid" | "dashed" | "dotted" | "thick";
export type EdgeArrow = "normal" | "open" | "none";

export type LayoutDirection = "LR" | "RL" | "TB" | "BT";

export interface Node {
  id: NodeId;
  label: string;
  shape?: NodeShape;
  attrs?: Record<string, unknown>;
  groupId?: GroupId;
  /**
   * Optional layout coordinates in inches (page coords, bottom-left origin).
   * Populated by graphviz/D2 layout extractors and consumed by the vsdx
   * writer. Not persisted to the database — purely a layout pass-through.
   */
  _x?: number;
  _y?: number;
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

export type DiagramKind = "graph" | "passthrough" | "binary";

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
  bytes?: Uint8Array;
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
