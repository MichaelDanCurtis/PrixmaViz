import type {
  Diagram, DiagramId, PatchOp, ServerToClient,
} from "@prixmaviz/shared";
import type { Annotation } from "@prixmaviz/shared";
import { emptyGraphIR, emptyMeta, inferKind, newAnnotationId } from "@prixmaviz/shared";
import type { KrokiClient } from "../kroki/client";
import { applyPatch } from "../ir/engine";
import { renderDiagram } from "../render";
import { DiagramStore, newDiagramId } from "../store/diagrams";
import { listPvizEntries, readPviz, writePviz } from "../pviz/io";
import type { PrixmaPaths } from "../bootstrap";
import type { WsHub } from "../ws/broadcast";
import { AnnotationStore } from "../annotations/store";
import { getHitTester } from "../hit-test";
import { WorkspaceStore } from "../canvas/store";

export interface RouteDeps {
  paths: PrixmaPaths;
  store: DiagramStore;
  annotations: AnnotationStore;
  workspace: WorkspaceStore;
  schedulePersistWorkspace: () => void;
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

  // ─── Annotations ─────────────────────────────────────────
  const annListMatch = p.match(/^\/api\/diagrams\/([^/]+)\/annotations$/);
  if (annListMatch && req.method === "GET") {
    const id = annListMatch[1] as DiagramId;
    return Response.json({ annotations: deps.annotations.listByDiagram(id) });
  }

  if (p === "/api/annotations" && req.method === "POST") {
    const body = (await req.json()) as {
      diagramId: DiagramId;
      kind: Annotation["kind"];
      text?: string;
      bboxPixel?: { x: number; y: number; w: number; h: number };
      point?: { x: number; y: number };
    };
    const d = deps.store.get(body.diagramId);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });

    const ann: Annotation = {
      id: newAnnotationId(),
      kind: body.kind,
      text: body.text,
      bboxPixel: body.bboxPixel,
      point: body.point,
      createdAt: new Date().toISOString(),
    };

    // hit-test enrichment using last cached SVG
    const svg = deps.store.getSvg(body.diagramId);
    if (svg) {
      const tester = getHitTester(d.engine);
      if (body.kind === "tag" && body.point) {
        const hit = tester.byPoint(svg, body.point.x, body.point.y);
        ann.targetNodes = hit.nodes;
      } else if (body.kind === "region" && body.bboxPixel) {
        const hit = tester.byRegion(svg, body.bboxPixel);
        ann.targetNodes = hit.nodes;
        ann.bboxData = hit.dataRange;
      } else if (body.kind === "pin" && body.point) {
        const hit = tester.byPoint(svg, body.point.x, body.point.y);
        ann.nearestNode = hit.nodes[0];
      }
    }

    deps.annotations.add(body.diagramId, ann);
    const wAnn = deps.workspace.get();
    const owningTileAnn = wAnn.tiles.find(t => t.diagramId === body.diagramId);
    if (owningTileAnn) deps.workspace.focus(owningTileAnn.id);
    deps.hub.broadcast({ type: "annotation:created", diagramId: body.diagramId, annotation: ann });

    // Schedule persist (debounced)
    schedulePersist(deps, body.diagramId);
    return Response.json({ annotation: ann });
  }

  const annPutMatch = p.match(/^\/api\/annotations\/([^/]+)$/);
  if (annPutMatch && req.method === "PUT") {
    const annId = annPutMatch[1]!;
    const body = (await req.json()) as { diagramId: DiagramId; patch: Partial<Annotation> };
    try {
      const updated = deps.annotations.update(body.diagramId, annId, body.patch);
      const wUpd = deps.workspace.get();
      const owningTileUpd = wUpd.tiles.find(t => t.diagramId === body.diagramId);
      if (owningTileUpd) deps.workspace.focus(owningTileUpd.id);
      deps.hub.broadcast({ type: "annotation:updated", diagramId: body.diagramId, annotation: updated });
      schedulePersist(deps, body.diagramId);
      return Response.json({ annotation: updated });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 404 });
    }
  }

  if (annPutMatch && req.method === "DELETE") {
    const annId = annPutMatch[1]!;
    const body = (await req.json().catch(() => ({}))) as { diagramId?: DiagramId };
    if (!body.diagramId) return Response.json({ ok: false, error: "diagramId required" }, { status: 400 });
    deps.annotations.delete(body.diagramId, annId);
    deps.hub.broadcast({ type: "annotation:deleted", diagramId: body.diagramId, annotationId: annId });
    schedulePersist(deps, body.diagramId);
    return Response.json({ ok: true });
  }

  // ─── Workspace ───────────────────────────────────────────
  if (p === "/api/workspace" && req.method === "GET") {
    return Response.json(deps.workspace.get());
  }

  if (p === "/api/workspace/camera" && req.method === "PUT") {
    const body = await req.json() as { x: number; y: number; zoom: number };
    deps.workspace.setCamera(body);
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json(w);
  }

  if (p === "/api/tiles" && req.method === "POST") {
    const body = await req.json() as { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number };
    const { newTileId } = await import("@prixmaviz/shared");
    const tile = deps.workspace.addTile({
      id: newTileId(),
      diagramId: body.diagramId,
      diagramSlug: body.diagramSlug,
      x: body.x ?? 0, y: body.y ?? 0,
      w: body.w ?? 600, h: body.h ?? 400,
      z: 0,
    });
    deps.workspace.focus(tile.id);
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json({ tile });
  }

  const tilePatchMatch = p.match(/^\/api\/tiles\/([^/]+)$/);
  if (tilePatchMatch && req.method === "PATCH") {
    const tileId = tilePatchMatch[1]!;
    const body = await req.json() as Partial<{ x: number; y: number; w: number; h: number; z: number }>;
    const tile = deps.workspace.updateTile(tileId, body);
    if (!tile) return Response.json({ ok: false, error: "tile not found" }, { status: 404 });
    deps.workspace.focus(tileId);
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json({ tile });
  }

  if (tilePatchMatch && req.method === "DELETE") {
    const tileId = tilePatchMatch[1]!;
    deps.workspace.removeTile(tileId);
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json({ ok: true });
  }

  if (p === "/api/install" && req.method === "POST") {
    const body = await req.json() as { host: "claude-code"; confirm: boolean };
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool("install_mcp_plugin", body, deps as unknown as import("../mcp/tools").ToolCtx);
      return Response.json(result);
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
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
  deps.store.setSvg(id, outcome.result.svg);
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

  deps.store.setSvg(id, outcome.result.svg);
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
  deps.annotations.loadFromDiagram(id, file.annotations ?? []);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  deps.store.setSvg(id, outcome.result.svg);
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
  deps.store.setSvg(id, outcome.result.svg);
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
  deps.store.setSvg(id, outcome.result.svg);
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

const persistTimers = new Map<DiagramId, ReturnType<typeof setTimeout>>();
function schedulePersist(deps: RouteDeps, diagramId: DiagramId) {
  const existing = persistTimers.get(diagramId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    persistTimers.delete(diagramId);
    const d = deps.store.get(diagramId);
    if (!d) return;
    const annotations = deps.annotations.listByDiagram(diagramId);
    d.annotations = annotations;
    // best-effort save (existing render path for SVG)
    try {
      const outcome = await renderDiagram(d, { kroki: deps.kroki });
      if (outcome.ok) await writePviz(deps.paths.diagramsDir, d, outcome.result.svg);
    } catch (e) {
      console.error(`schedulePersist(${diagramId}) failed:`, e);
      // annotations remain in memory; will save on next save_diagram MCP call
    }
  }, 500);
  persistTimers.set(diagramId, t);
}
