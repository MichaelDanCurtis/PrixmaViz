import type {
  Diagram, DiagramId, PatchOp, ServerToClient,
} from "@prixmaviz/shared";
import { emptyGraphIR, emptyMeta, inferKind } from "@prixmaviz/shared";
import type { KrokiClient } from "../kroki/client";
import { applyPatch } from "../ir/engine";
import { renderDiagram } from "../render";
import { DiagramStore, newDiagramId } from "../store/diagrams";
import { listPvizEntries, readPviz, writePviz } from "../pviz/io";
import type { PrixmaPaths } from "../bootstrap";
import type { WsHub } from "../ws/broadcast";

export interface RouteDeps {
  paths: PrixmaPaths;
  store: DiagramStore;
  kroki: KrokiClient;
  hub: WsHub;
}

export async function handleApi(
  req: Request,
  url: URL,
  deps: RouteDeps,
): Promise<Response | undefined> {
  const p = url.pathname;

  if (p === "/api/health") return Response.json({ ok: true });

  if (p === "/api/library" && req.method === "GET") {
    const entries = await listPvizEntries(deps.paths.diagramsDir);
    return Response.json({ entries });
  }

  const thumbMatch = p.match(/^\/api\/library\/([^/]+)\/thumb$/);
  if (thumbMatch && req.method === "GET") {
    const slug = thumbMatch[1]!;
    const path = `${deps.paths.diagramsDir}/${slug}.svg`;
    const file = Bun.file(path);
    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": "image/svg+xml" } });
    }
    return new Response("not found", { status: 404 });
  }

  if (p === "/api/diagrams" && req.method === "POST") {
    const body = await req.json() as {
      name: string; engine: Diagram["engine"]; kind?: Diagram["kind"]; initialDsl?: string;
    };
    return await createDiagram(body, deps);
  }

  const patchMatch = p.match(/^\/api\/diagrams\/([^/]+)\/patch$/);
  if (patchMatch && req.method === "POST") {
    const id = patchMatch[1] as DiagramId;
    const body = await req.json() as { ops: PatchOp[] };
    return await patchDiagram(id, body.ops, deps);
  }

  const loadMatch = p.match(/^\/api\/diagrams\/([^/]+)\/load$/);
  if (loadMatch && req.method === "POST") {
    const slug = loadMatch[1]!;
    return await loadDiagramBySlug(slug, deps);
  }

  const saveMatch = p.match(/^\/api\/diagrams\/([^/]+)\/save$/);
  if (saveMatch && req.method === "POST") {
    const id = saveMatch[1] as DiagramId;
    const body = await req.json().catch(() => ({})) as { name?: string; tags?: string[] };
    return await saveDiagram(id, body, deps);
  }

  if (p === "/api/render-dsl" && req.method === "POST") {
    const body = await req.json() as { engine: Diagram["engine"]; source: string; name?: string };
    return await renderDsl(body, deps);
  }

  if (p === "/api/mcp/call" && req.method === "POST") {
    const body = await req.json() as { tool: string; args: Record<string, unknown> };
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool(body.tool, body.args, deps as unknown as import("../mcp/tools").ToolCtx);
      return Response.json(result);
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  }

  return undefined;
}

async function createDiagram(
  body: { name: string; engine: Diagram["engine"]; kind?: Diagram["kind"]; initialDsl?: string },
  deps: RouteDeps,
): Promise<Response> {
  const kind: Diagram["kind"] = body.kind ?? inferKind(body.engine);
  const id = newDiagramId();
  const diagram: Diagram = {
    id,
    name: body.name,
    engine: body.engine,
    kind,
    ir: kind === "graph" ? emptyGraphIR() : undefined,
    dsl: kind === "passthrough" ? body.initialDsl ?? "" : undefined,
    meta: emptyMeta(),
  };
  deps.store.put(diagram);

  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) {
    return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  }
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: id,
    render: outcome.result,
    warnings: outcome.warnings,
  });
}

async function patchDiagram(
  id: DiagramId,
  ops: PatchOp[],
  deps: RouteDeps,
): Promise<Response> {
  const d = deps.store.get(id);
  if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  if (d.kind !== "graph" || !d.ir)
    return Response.json({ ok: false, error: "patches only valid on graph diagrams" }, { status: 400 });
  const result = applyPatch(d.ir, ops);
  if (!result.ok)
    return Response.json({ ok: false, error: result.error, opIndex: result.opIndex }, { status: 400 });

  d.ir = result.ir;
  deps.store.touch(id);
  const outcome = await renderDiagram(d, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });

  broadcastRender(deps.hub, d, outcome.result.svg, [...result.warnings, ...outcome.warnings]);
  return Response.json({
    diagramId: id,
    ir: d.ir,
    render: outcome.result,
    warnings: [...result.warnings, ...outcome.warnings],
  });
}

async function loadDiagramBySlug(slug: string, deps: RouteDeps): Promise<Response> {
  const path = `${deps.paths.diagramsDir}/${slug}.pviz`;
  if (!(await Bun.file(path).exists()))
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const file = await readPviz(path);
  const id = file.id;
  const diagram: Diagram = {
    id,
    name: file.name,
    engine: file.engine,
    kind: file.kind,
    ir: file.ir,
    dsl: file.dsl,
    meta: file.meta,
  };
  deps.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: id,
    ir: diagram.ir,
    dsl: diagram.dsl,
    render: outcome.result,
  });
}

async function saveDiagram(
  id: DiagramId,
  body: { name?: string; tags?: string[] },
  deps: RouteDeps,
): Promise<Response> {
  const d = deps.store.get(id);
  if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  if (body.name) d.name = body.name;
  if (body.tags) d.meta.tags = body.tags;
  d.meta.updatedAt = new Date().toISOString();

  const outcome = await renderDiagram(d, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  const written = await writePviz(deps.paths.diagramsDir, d, outcome.result.svg);
  return Response.json({ path: written.path, slug: written.slug, meta: d.meta });
}

async function renderDsl(
  body: { engine: Diagram["engine"]; source: string; name?: string },
  deps: RouteDeps,
): Promise<Response> {
  const id = newDiagramId();
  const diagram: Diagram = {
    id,
    name: body.name ?? "untitled",
    engine: body.engine,
    kind: "passthrough",
    dsl: body.source,
    meta: emptyMeta(),
  };
  deps.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  if (body.name) {
    await writePviz(deps.paths.diagramsDir, diagram, outcome.result.svg);
  }
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({ diagramId: id, render: outcome.result });
}

function broadcastRender(
  hub: WsHub,
  d: Diagram,
  svg: string,
  warnings: string[],
): void {
  const msg: ServerToClient = {
    type: "render",
    diagramId: d.id,
    ir: d.ir,
    dsl: d.dsl ?? "",
    svg,
    warnings: warnings.length ? warnings : undefined,
  };
  hub.broadcast(msg);
}
