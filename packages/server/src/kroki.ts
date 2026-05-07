import type { DiagramEngine, RenderFormat, RenderRequest, RenderResponse } from "@prixmaviz/shared";

const KROKI_BASE = process.env.KROKI_URL ?? "https://kroki.io";

const ENGINE_PATH: Record<DiagramEngine, string> = {
  actdiag: "actdiag",
  blockdiag: "blockdiag",
  bpmn: "bpmn",
  bytefield: "bytefield",
  c4plantuml: "c4plantuml",
  d2: "d2",
  dbml: "dbml",
  diagramsnet: "diagramsnet",
  ditaa: "ditaa",
  erd: "erd",
  excalidraw: "excalidraw",
  graphviz: "graphviz",
  mermaid: "mermaid",
  nomnoml: "nomnoml",
  nwdiag: "nwdiag",
  packetdiag: "packetdiag",
  pikchr: "pikchr",
  plantuml: "plantuml",
  rackdiag: "rackdiag",
  seqdiag: "seqdiag",
  structurizr: "structurizr",
  svgbob: "svgbob",
  symbolator: "symbolator",
  tikz: "tikz",
  umlet: "umlet",
  vega: "vega",
  vegalite: "vegalite",
  wavedrom: "wavedrom",
  wireviz: "wireviz",
};

export async function renderViaKroki(req: RenderRequest): Promise<RenderResponse> {
  const format: RenderFormat = req.format ?? "svg";
  const path = ENGINE_PATH[req.engine];
  const url = `${KROKI_BASE}/${path}/${format}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: req.source,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { id: req.id, ok: false, error: `kroki ${res.status}: ${text.slice(0, 500)}` };
    }
    const data = format === "svg" ? await res.text() : Buffer.from(await res.arrayBuffer()).toString("base64");
    return { id: req.id, ok: true, format, data };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
