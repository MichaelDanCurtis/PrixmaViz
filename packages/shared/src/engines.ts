export type DiagramEngine =
  | "actdiag" | "blockdiag" | "bpmn" | "bytefield"
  | "c4plantuml" | "d2" | "dbml" | "diagramsnet"
  | "ditaa" | "erd" | "excalidraw" | "graphviz"
  | "mermaid" | "nomnoml" | "nwdiag" | "packetdiag"
  | "pikchr" | "plantuml" | "rackdiag" | "seqdiag"
  | "structurizr" | "svgbob" | "symbolator" | "tikz"
  | "umlet" | "vega" | "vegalite" | "vsdx" | "wavedrom" | "wireviz";

export type EngineFamily =
  | "graph" | "sequence" | "er" | "process"
  | "signal" | "chart" | "freeform" | "network";

export const ENGINE_FAMILY: Record<DiagramEngine, EngineFamily> = {
  mermaid: "graph",
  d2: "graph",
  graphviz: "graph",
  blockdiag: "graph",
  nomnoml: "graph",
  c4plantuml: "graph",
  structurizr: "graph",
  plantuml: "sequence",
  seqdiag: "sequence",
  erd: "er",
  dbml: "er",
  bpmn: "process",
  actdiag: "process",
  wavedrom: "signal",
  packetdiag: "signal",
  bytefield: "signal",
  vega: "chart",
  vegalite: "chart",
  tikz: "freeform",
  excalidraw: "freeform",
  ditaa: "freeform",
  svgbob: "freeform",
  pikchr: "freeform",
  diagramsnet: "freeform",
  symbolator: "freeform",
  umlet: "freeform",
  nwdiag: "network",
  rackdiag: "network",
  wireviz: "freeform",
  vsdx: "freeform",
};

export const KROKI_PATH: Record<Exclude<DiagramEngine, "vsdx">, string> = {
  actdiag: "actdiag", blockdiag: "blockdiag", bpmn: "bpmn",
  bytefield: "bytefield", c4plantuml: "c4plantuml", d2: "d2",
  dbml: "dbml", diagramsnet: "diagramsnet", ditaa: "ditaa",
  erd: "erd", excalidraw: "excalidraw", graphviz: "graphviz",
  mermaid: "mermaid", nomnoml: "nomnoml", nwdiag: "nwdiag",
  packetdiag: "packetdiag", pikchr: "pikchr", plantuml: "plantuml",
  rackdiag: "rackdiag", seqdiag: "seqdiag", structurizr: "structurizr",
  svgbob: "svgbob", symbolator: "symbolator", tikz: "tikz",
  umlet: "umlet", vega: "vega", vegalite: "vegalite",
  wavedrom: "wavedrom", wireviz: "wireviz",
};

export const ALL_ENGINES = Object.keys(ENGINE_FAMILY) as DiagramEngine[];

export function inferKind(engine: DiagramEngine): "graph" | "passthrough" {
  return ENGINE_FAMILY[engine] === "graph" ? "graph" : "passthrough";
}
