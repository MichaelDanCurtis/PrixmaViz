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
  /**
   * Diagram UUID. Surfaced so the web client can call ID-keyed routes
   * (POST /api/diagrams/:id/pin, etc.) and match `library:diagram-*`
   * WS events to a row in the local library list. Issue #7 Wave 2.
   */
  id: DiagramId;
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
  /**
   * Optional metadata projected from `meta` JSONB into the listing so the
   * item-detail modal doesn't need a second roundtrip on open. Issue #7
   * Wave 2 (F5).
   */
  description?: string;
  author?: string;
  notes?: string;
}

export type ServerToClient =
  | { type: "render"; diagramId: DiagramId; ir?: GraphIR; dsl: string; svg: string; warnings?: string[] }
  | { type: "library"; entries: LibraryEntry[] }
  | { type: "diagram"; diagram: Diagram }
  | { type: "error"; message: string }
  | { type: "annotation:created"; diagramId: DiagramId; annotation: Annotation }
  | { type: "annotation:updated"; diagramId: DiagramId; annotation: Annotation }
  | { type: "annotation:deleted"; diagramId: DiagramId; annotationId: string }
  | { type: "workspace"; camera: Camera; tiles: Tile[] }
  // Issue #7 Wave 1B: library / org events. Each fans out to every WS
  // client authenticated for the workspace so a change in tab A surfaces
  // in tab B without polling.
  | { type: "library:diagram-updated"; diagramId: DiagramId; change: "pinned" | "moved" | "meta" }
  | { type: "library:diagram-opened"; diagramId: DiagramId; lastOpenedAt: string }
  | { type: "library:folders-changed"; emptyFolders: string[] }
  | { type: "library:tags-changed" };

export type ClientToServer =
  | { type: "open"; diagramId: DiagramId }
  | { type: "patch"; diagramId: DiagramId; ops: PatchOp[] }
  | { type: "ping" };
