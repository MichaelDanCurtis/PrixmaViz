import type { Diagram, GraphIR, RenderResult } from "@prixmaviz/shared";
import { KrokiClient, KrokiError } from "./kroki/client";
import { getIrRenderer } from "./renderers/registry";
import { renderVsdxBytes, VsdxRenderError } from "./renderers/vsdx-render";

export interface RenderEngineDeps {
  kroki: KrokiClient;
}

export interface RenderOk {
  ok: true;
  result: RenderResult;
  warnings: string[];
}

export interface RenderFail {
  ok: false;
  error: string;
}

export type RenderOutcome = RenderOk | RenderFail;

export async function renderDiagram(
  diagram: Diagram,
  deps: RenderEngineDeps,
): Promise<RenderOutcome> {
  // ─── Binary branch (vsdx) ───────────
  if (diagram.kind === "binary") {
    if (!diagram.bytes) return { ok: false, error: "binary diagram missing bytes" };
    if (diagram.engine !== "vsdx") {
      return { ok: false, error: `unsupported binary engine: ${diagram.engine}` };
    }
    try {
      const svg = await renderVsdxBytes(diagram.bytes);
      return { ok: true, result: { svg, dsl: "" }, warnings: [] };
    } catch (e) {
      if (e instanceof VsdxRenderError) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  let dsl: string;
  let warnings: string[] = [];

  if (diagram.kind === "graph") {
    if (!diagram.ir) return { ok: false, error: "graph diagram missing ir" };
    const renderer = getIrRenderer(diagram.engine);
    if (!renderer)
      return {
        ok: false,
        error: `no IR renderer for engine "${diagram.engine}"`,
      };
    const out = renderer(diagram.ir);
    dsl = out.dsl;
    warnings = out.warnings;
  } else {
    if (diagram.dsl === undefined)
      return { ok: false, error: "passthrough diagram missing dsl" };
    dsl = diagram.dsl;
  }

  try {
    const svg = await deps.kroki.renderSvg(diagram.engine, dsl);
    let svgOut = svg;
    if (diagram.kind === "passthrough" && (diagram.engine === "vega" || diagram.engine === "vegalite")) {
      const b64 = Buffer.from(dsl).toString("base64");
      svgOut = `<!--prixmaviz-spec:${b64}-->\n${svg}`;
    }
    return { ok: true, result: { svg: svgOut, dsl }, warnings };
  } catch (e) {
    if (e instanceof KrokiError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renderIR(
  engine: Diagram["engine"],
  ir: GraphIR,
  deps: RenderEngineDeps,
): Promise<RenderOutcome> {
  return renderDiagram(
    { id: "_", name: "_", engine, kind: "graph", ir, meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] } },
    deps,
  );
}
