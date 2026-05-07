export type DiagramEngine =
  | "actdiag"
  | "blockdiag"
  | "bpmn"
  | "bytefield"
  | "c4plantuml"
  | "d2"
  | "dbml"
  | "diagramsnet"
  | "ditaa"
  | "erd"
  | "excalidraw"
  | "graphviz"
  | "mermaid"
  | "nomnoml"
  | "nwdiag"
  | "packetdiag"
  | "pikchr"
  | "plantuml"
  | "rackdiag"
  | "seqdiag"
  | "structurizr"
  | "svgbob"
  | "symbolator"
  | "tikz"
  | "umlet"
  | "vega"
  | "vegalite"
  | "wavedrom"
  | "wireviz";

export const ALL_ENGINES: DiagramEngine[] = [
  "mermaid",
  "plantuml",
  "graphviz",
  "d2",
  "c4plantuml",
  "structurizr",
  "excalidraw",
  "bpmn",
  "erd",
  "dbml",
  "nomnoml",
  "pikchr",
  "svgbob",
  "ditaa",
  "tikz",
  "vega",
  "vegalite",
  "wavedrom",
  "wireviz",
  "bytefield",
  "blockdiag",
  "seqdiag",
  "actdiag",
  "nwdiag",
  "packetdiag",
  "rackdiag",
  "symbolator",
  "umlet",
  "diagramsnet",
];

export type RenderFormat = "svg" | "png";

export interface RenderRequest {
  id: string;
  engine: DiagramEngine;
  source: string;
  format?: RenderFormat;
}

export interface RenderResult {
  id: string;
  ok: true;
  format: RenderFormat;
  data: string;
}

export interface RenderError {
  id: string;
  ok: false;
  error: string;
}

export type RenderResponse = RenderResult | RenderError;

export interface Annotation {
  id: string;
  diagramId: string;
  kind: "stroke" | "circle" | "rect" | "text" | "pin";
  points?: Array<[number, number]>;
  bbox?: { x: number; y: number; w: number; h: number };
  text?: string;
  targetNodeId?: string;
  color?: string;
  createdAt: number;
}

export type ClientToServer =
  | { type: "render"; req: RenderRequest }
  | { type: "annotate"; annotation: Annotation }
  | { type: "clear"; diagramId: string };

export type ServerToClient =
  | { type: "render"; res: RenderResponse }
  | { type: "diagram"; req: RenderRequest }
  | { type: "annotations"; diagramId: string; annotations: Annotation[] };
