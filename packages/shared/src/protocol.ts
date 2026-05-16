import type { Annotation } from "./annotations";
import type { Camera, Tile } from "./canvas";
import type { DiagramEngine } from "./engines";
import type { Diagram, DiagramId, GraphIR } from "./ir";
import type { PatchOp } from "./patches";

export interface RenderResult {
  svg: string;
  dsl: string;
}

export interface ApplyPatchResponse {
  diagramId: DiagramId;
  ir: GraphIR;
  render: RenderResult;
  warnings?: string[];
}

export interface CreateDiagramRequest {
  name: string;
  engine: DiagramEngine;
  kind?: "graph" | "passthrough";
  initialDsl?: string;
}

export interface CreateDiagramResponse {
  diagramId: DiagramId;
  render: RenderResult;
}

export interface RenderDslRequest {
  engine: DiagramEngine;
  source: string;
  name?: string;
}

export interface RenderDslResponse {
  diagramId: DiagramId;
  render: RenderResult;
}

export interface LibraryEntry {
  name: string;
  path: string;
  engine: DiagramEngine;
  kind: "graph" | "passthrough";
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * Folder path the diagram lives in. Empty string = workspace root.
   * Slash-delimited segments, no leading or trailing slash. Issue #7.
   */
  parentPath: string;
  /**
   * Whether the diagram is pinned to the top of the Library. Issue #7.
   */
  pinned: boolean;
  /**
   * Last time a client opened the diagram (createTile / loadBySlug).
   * `null` when never opened. Drives the "Recent" Library section. Issue #7.
   */
  lastOpenedAt: string | null;
}

export type ServerToClient =
  | { type: "render"; diagramId: DiagramId; ir?: GraphIR; dsl: string; svg: string; warnings?: string[] }
  | { type: "library"; entries: LibraryEntry[] }
  | { type: "diagram"; diagram: Diagram }
  | { type: "error"; message: string }
  | { type: "annotation:created"; diagramId: DiagramId; annotation: Annotation }
  | { type: "annotation:updated"; diagramId: DiagramId; annotation: Annotation }
  | { type: "annotation:deleted"; diagramId: DiagramId; annotationId: string }
  | { type: "workspace"; camera: Camera; tiles: Tile[] };

export type ClientToServer =
  | { type: "open"; diagramId: DiagramId }
  | { type: "patch"; diagramId: DiagramId; ops: PatchOp[] }
  | { type: "ping" };
