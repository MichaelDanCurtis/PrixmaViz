import type {
  Annotation, Camera, Diagram, DiagramEngine, DiagramId, DiagramKind, Edge, GraphIR, Node, PatchOp, ServerToClient, Tile,
} from "@prixmaviz/shared";
import { emptyGraphIR, emptyMeta, inferKind, newAnnotationId, newTileId } from "@prixmaviz/shared";
import type postgres from "postgres";
import type { KrokiClient } from "../kroki/client";
import { applyPatch } from "../ir/engine";
import { renderDiagram } from "../render";
import type { WsHub } from "../ws/broadcast";
import { getHitTester } from "../hit-test";
import { authenticate } from "../auth/bearer";
import {
  createDiagram as dbCreateDiagram,
  createDiagramWithUniqueSlug as dbCreateDiagramWithUniqueSlug,
  getDiagram as dbGetDiagram,
  getDiagramBySlug as dbGetDiagramBySlug,
  listDiagrams as dbListDiagrams,
  updateDiagram as dbUpdateDiagram,
  type DbDiagram,
} from "../db/diagrams";
import {
  addAnnotation as dbAddAnnotation,
  deleteAnnotation as dbDeleteAnnotation,
  listAnnotations as dbListAnnotations,
  updateAnnotation as dbUpdateAnnotation,
} from "../db/annotations";
import {
  createWorkspace as dbCreateWorkspace,
  getWorkspace as dbGetWorkspace,
  updateWorkspaceCamera as dbUpdateWorkspaceCamera,
  updateWorkspaceSettings as dbUpdateWorkspaceSettings,
  updateWorkspaceTiles as dbUpdateWorkspaceTiles,
} from "../db/workspaces";

type Sql = ReturnType<typeof postgres>;

export interface RouteDeps {
  sql: Sql;
  kroki: KrokiClient;
  hub: WsHub;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "diagram";
}

function dbDiagramToDomain(d: DbDiagram): Diagram {
  return {
    id: d.id,
    name: d.name,
    engine: d.engine,
    kind: d.kind,
    ir: d.ir ?? undefined,
    dsl: d.dsl ?? undefined,
    bytes: d.bytes ?? undefined,
    meta: (d.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
}

export async function handleApi(
  req: Request,
  url: URL,
  deps: RouteDeps,
): Promise<Response | undefined> {
  const p = url.pathname;

  // ─── Pre-auth routes ─────────────────────────────────────
  if (p === "/api/health") return Response.json({ ok: true });

  if (p === "/api/workspaces" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { name?: string };
    const ws = await dbCreateWorkspace(deps.sql, body.name);
    return Response.json({ id: ws.id });
  }

  // ─── Public diagram views (no auth) ───────────────────────
  // /p/:id.svg — raw SVG, iframe-friendly
  const pubSvgMatch = p.match(/^\/p\/([a-z0-9_-]+)\.svg$/i);
  if (pubSvgMatch && req.method === "GET") {
    const diagramId = pubSvgMatch[1]!;
    const { getPublicDiagram } = await import("../db/diagrams");
    const d = await getPublicDiagram(deps.sql, diagramId);
    if (!d || !d.svg) return new Response("Not Found", { status: 404 });
    return new Response(d.svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Frame-Options": "ALLOWALL",
        "Content-Security-Policy": "frame-ancestors *",
      },
    });
  }

  // /p/:id — confirm existence, then fall through to the SPA index.html
  const pubViewMatch = p.match(/^\/p\/([a-z0-9_-]+)$/i);
  if (pubViewMatch && req.method === "GET") {
    const diagramId = pubViewMatch[1]!;
    const { getPublicDiagram } = await import("../db/diagrams");
    const d = await getPublicDiagram(deps.sql, diagramId);
    if (!d) return new Response("Not Found", { status: 404 });
    // Fall through — let the static handler serve index.html and the SPA
    // renders /p/<id> client-side via PublicDiagram.
    return undefined;
  }

  // JSON API for the SPA — also no auth
  const pubApiMatch = p.match(/^\/api\/public\/diagrams\/([a-z0-9_-]+)$/i);
  if (pubApiMatch && req.method === "GET") {
    const diagramId = pubApiMatch[1]!;
    const { getPublicDiagram } = await import("../db/diagrams");
    const d = await getPublicDiagram(deps.sql, diagramId);
    if (!d) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({
      id: d.id, name: d.name, engine: d.engine, kind: d.kind, svg: d.svg, dsl: d.dsl,
    });
  }

  if (!p.startsWith("/api/")) return undefined;

  // ─── Auth gate ────────────────────────────────────────────
  const auth = await authenticate(req, deps.sql);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: auth.status });
  }
  const workspaceId = auth.workspaceId;

  // ─── Diagrams ─────────────────────────────────────────────
  if (p === "/api/diagrams" && req.method === "GET") {
    const rows = await dbListDiagrams(deps.sql, workspaceId);
    return Response.json({
      diagrams: rows.map((d) => ({
        id: d.id,
        slug: d.slug,
        name: d.name,
        engine: d.engine,
        kind: d.kind,
        updatedAt: d.updatedAt,
      })),
    });
  }

  // ─── Library (alias for /api/diagrams + Postgres-backed thumb) ───
  // The web Library component expects the cycle-3 LibraryEntry shape:
  //   { name, path, engine, kind, tags, createdAt, updatedAt }
  // `path` is synthesized from the slug (the web client extracts the slug
  // back out with basename(path).replace(/\.pviz$/, "")).
  if (p === "/api/library" && req.method === "GET") {
    const rows = await dbListDiagrams(deps.sql, workspaceId);
    return Response.json({
      entries: rows.map((d) => ({
        name: d.name,
        path: `${d.slug}.pviz`,
        engine: d.engine,
        kind: d.kind,
        tags: Array.isArray((d.meta as { tags?: unknown }).tags)
          ? (d.meta as { tags: string[] }).tags
          : [],
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  }

  const thumbMatch = p.match(/^\/api\/library\/([^/]+)\/thumb$/);
  if (thumbMatch && req.method === "GET") {
    const slug = thumbMatch[1]!;
    const d = await dbGetDiagramBySlug(deps.sql, workspaceId, slug);
    if (!d || !d.svg) return new Response("not found", { status: 404 });
    return new Response(d.svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }

  if (p === "/api/diagrams" && req.method === "POST") {
    const body = await req.json() as {
      name: string; engine: DiagramEngine; kind?: DiagramKind; initialDsl?: string;
    };
    return await createDiagramRoute(body, workspaceId, deps);
  }

  const patchMatch = p.match(/^\/api\/diagrams\/([^/]+)\/patch$/);
  if (patchMatch && req.method === "POST") {
    const id = patchMatch[1] as DiagramId;
    const body = await req.json() as { ops: PatchOp[] };
    return await patchDiagramRoute(id, body.ops, workspaceId, deps);
  }

  const loadMatch = p.match(/^\/api\/diagrams\/([^/]+)\/load$/);
  if (loadMatch && req.method === "POST") {
    const slug = loadMatch[1]!;
    return await loadDiagramRoute(slug, workspaceId, deps);
  }

  const saveMatch = p.match(/^\/api\/diagrams\/([^/]+)\/save$/);
  if (saveMatch && req.method === "POST") {
    const id = saveMatch[1] as DiagramId;
    const body = await req.json().catch(() => ({})) as { name?: string; tags?: string[] };
    return await saveDiagramRoute(id, body, workspaceId, deps);
  }

  const visMatch = p.match(/^\/api\/diagrams\/([^/]+)\/visibility$/);
  if (visMatch && req.method === "POST") {
    const diagramId = visMatch[1]!;
    const body = await req.json() as { public: boolean };
    const { setDiagramPublic } = await import("../db/diagrams");
    const existing = await dbGetDiagram(deps.sql, workspaceId, diagramId);
    if (!existing) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    await setDiagramPublic(deps.sql, workspaceId, diagramId, body.public);
    const publicUrl = body.public
      ? `${process.env.PRIXMAVIZ_PUBLIC_URL ?? ""}/p/${diagramId}`
      : undefined;
    return Response.json({ public: body.public, publicUrl });
  }

  const exportVsdxMatch = p.match(/^\/api\/diagrams\/([^/]+)\/export\.vsdx$/);
  if (exportVsdxMatch && req.method === "GET") {
    return await exportVsdxRoute(exportVsdxMatch[1]!, workspaceId, deps);
  }

  if (p === "/api/import" && req.method === "POST") {
    return await importVsdxRoute(req, workspaceId, deps);
  }

  // GET /api/diagrams/:id — single-diagram metadata (no suffix).
  // Placed AFTER all the /api/diagrams/:id/* suffix routes so it only fires
  // when no suffix branch matched.
  const getOneMatch = p.match(/^\/api\/diagrams\/([^/]+)$/);
  if (getOneMatch && req.method === "GET") {
    const id = getOneMatch[1] as DiagramId;
    const d = await dbGetDiagram(deps.sql, workspaceId, id);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    return Response.json({
      id: d.id,
      slug: d.slug,
      name: d.name,
      engine: d.engine,
      kind: d.kind,
      publicView: d.publicView,
      updatedAt: d.updatedAt,
      // ir/dsl/svg intentionally omitted — fetch via /load or render.
    });
  }

  if (p === "/api/render-dsl" && req.method === "POST") {
    const body = await req.json() as { engine: DiagramEngine; source: string; name?: string };
    return await renderDslRoute(body, workspaceId, deps);
  }

  if (p === "/api/mcp/call" && req.method === "POST") {
    const body = await req.json() as { tool: string; args: Record<string, unknown> };
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool(body.tool, body.args, {
        sql: deps.sql,
        workspaceId,
        kroki: deps.kroki,
        hub: deps.hub,
      });
      return Response.json(result);
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  }

  const mcpMatch = p.match(/^\/api\/mcp\/([a-z_]+)$/);
  if (mcpMatch && req.method === "POST") {
    const toolName = mcpMatch[1]!;
    const args = await req.json().catch(() => ({}));
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool(toolName, args as Record<string, unknown>, {
        sql: deps.sql,
        workspaceId,
        kroki: deps.kroki,
        hub: deps.hub,
      });
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
    const d = await dbGetDiagram(deps.sql, workspaceId, id);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    const annotations = await dbListAnnotations(deps.sql, id, { includeResolved: true });
    return Response.json({ annotations });
  }

  if (p === "/api/annotations" && req.method === "POST") {
    const body = (await req.json()) as {
      diagramId: DiagramId;
      kind: Annotation["kind"];
      text?: string;
      bboxPixel?: { x: number; y: number; w: number; h: number };
      point?: { x: number; y: number };
    };
    const d = await dbGetDiagram(deps.sql, workspaceId, body.diagramId);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });

    const ann: Annotation = {
      id: newAnnotationId(),
      kind: body.kind,
      text: body.text,
      bboxPixel: body.bboxPixel,
      point: body.point,
      createdAt: new Date().toISOString(),
    };

    if (d.svg) {
      const tester = getHitTester(d.engine);
      if (body.kind === "tag" && body.point) {
        const hit = tester.byPoint(d.svg, body.point.x, body.point.y);
        ann.targetNodes = hit.nodes;
      } else if (body.kind === "region" && body.bboxPixel) {
        const hit = tester.byRegion(d.svg, body.bboxPixel);
        ann.targetNodes = hit.nodes;
        ann.bboxData = hit.dataRange;
      } else if (body.kind === "pin" && body.point) {
        const hit = tester.byPoint(d.svg, body.point.x, body.point.y);
        ann.nearestNode = hit.nodes[0];
      }
    }

    const saved = await dbAddAnnotation(deps.sql, body.diagramId, ann);
    deps.hub.broadcast(workspaceId, { type: "annotation:created", diagramId: body.diagramId, annotation: saved });
    return Response.json({ annotation: saved });
  }

  const annPutMatch = p.match(/^\/api\/annotations\/([^/]+)$/);
  if (annPutMatch && req.method === "PUT") {
    const annId = annPutMatch[1]!;
    const body = (await req.json()) as { diagramId: DiagramId; patch: Partial<Annotation> };
    const d = await dbGetDiagram(deps.sql, workspaceId, body.diagramId);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    const updated = await dbUpdateAnnotation(deps.sql, body.diagramId, annId, body.patch);
    if (!updated) return Response.json({ ok: false, error: "annotation not found" }, { status: 404 });
    deps.hub.broadcast(workspaceId, { type: "annotation:updated", diagramId: body.diagramId, annotation: updated });
    return Response.json({ annotation: updated });
  }

  if (annPutMatch && req.method === "DELETE") {
    const annId = annPutMatch[1]!;
    const body = (await req.json().catch(() => ({}))) as { diagramId?: DiagramId };
    if (!body.diagramId) return Response.json({ ok: false, error: "diagramId required" }, { status: 400 });
    const d = await dbGetDiagram(deps.sql, workspaceId, body.diagramId);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    await dbDeleteAnnotation(deps.sql, body.diagramId, annId);
    deps.hub.broadcast(workspaceId, { type: "annotation:deleted", diagramId: body.diagramId, annotationId: annId });
    return Response.json({ ok: true });
  }

  // ─── Workspace ───────────────────────────────────────────
  if (p === "/api/workspace" && req.method === "GET") {
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    return Response.json(ws);
  }

  if (p === "/api/workspace" && req.method === "DELETE") {
    const { deleteWorkspace } = await import("../db/workspaces");
    await deleteWorkspace(deps.sql, workspaceId);
    return Response.json({ ok: true });
  }

  if (p === "/api/workspace/name" && req.method === "PUT") {
    const body = await req.json() as { name: string | null };
    const { updateWorkspaceName } = await import("../db/workspaces");
    await updateWorkspaceName(deps.sql, workspaceId, body.name);
    return Response.json({ name: body.name });
  }

  if (p === "/api/workspace/camera" && req.method === "PUT") {
    const body = await req.json() as Camera;
    await dbUpdateWorkspaceCamera(deps.sql, workspaceId, body);
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    deps.hub.broadcast(workspaceId, { type: "workspace", camera: ws.camera, tiles: ws.tiles });
    return Response.json(ws);
  }

  if (p === "/api/tiles" && req.method === "POST") {
    const body = await req.json() as { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number };
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    const tile: Tile = {
      id: newTileId(),
      diagramId: body.diagramId,
      diagramSlug: body.diagramSlug,
      x: body.x ?? 0, y: body.y ?? 0,
      w: body.w ?? 600, h: body.h ?? 400,
      z: 0,
    };
    const nextTiles = [...ws.tiles, tile];
    await dbUpdateWorkspaceTiles(deps.sql, workspaceId, nextTiles);
    const updated = await dbGetWorkspace(deps.sql, workspaceId);
    if (updated) deps.hub.broadcast(workspaceId, { type: "workspace", camera: updated.camera, tiles: updated.tiles });
    return Response.json({ tile });
  }

  const tilePatchMatch = p.match(/^\/api\/tiles\/([^/]+)$/);
  if (tilePatchMatch && req.method === "PATCH") {
    const tileId = tilePatchMatch[1]!;
    const body = await req.json() as Partial<{ x: number; y: number; w: number; h: number; z: number }>;
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    const idx = ws.tiles.findIndex((t) => t.id === tileId);
    if (idx < 0) return Response.json({ ok: false, error: "tile not found" }, { status: 404 });
    const nextTiles = [...ws.tiles];
    nextTiles[idx] = { ...nextTiles[idx]!, ...body, id: tileId };
    await dbUpdateWorkspaceTiles(deps.sql, workspaceId, nextTiles);
    const updated = await dbGetWorkspace(deps.sql, workspaceId);
    if (updated) deps.hub.broadcast(workspaceId, { type: "workspace", camera: updated.camera, tiles: updated.tiles });
    return Response.json({ tile: nextTiles[idx] });
  }

  if (tilePatchMatch && req.method === "DELETE") {
    const tileId = tilePatchMatch[1]!;
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    const nextTiles = ws.tiles.filter((t) => t.id !== tileId);
    await dbUpdateWorkspaceTiles(deps.sql, workspaceId, nextTiles);
    const updated = await dbGetWorkspace(deps.sql, workspaceId);
    if (updated) deps.hub.broadcast(workspaceId, { type: "workspace", camera: updated.camera, tiles: updated.tiles });
    return Response.json({ ok: true });
  }

  // ─── Settings ────────────────────────────────────────────
  if (p === "/api/settings" && req.method === "GET") {
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    return Response.json(ws.settings ?? {});
  }

  if (p === "/api/settings" && req.method === "PUT") {
    const body = await req.json() as Record<string, unknown>;
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    const merged = { ...(ws.settings ?? {}), ...body };
    await dbUpdateWorkspaceSettings(deps.sql, workspaceId, merged);
    return Response.json(merged);
  }

  if (p === "/api/settings/test-kroki" && req.method === "POST") {
    const body = await req.json() as { url: string };
    try {
      const resp = await fetch(`${body.url}/health`, { signal: AbortSignal.timeout(3000) });
      const ok = resp.ok;
      const status = await resp.json().catch(() => null);
      return Response.json({ ok, status });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 });
    }
  }

  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Route helpers
// ───────────────────────────────────────────────────────────────────────────

async function createDiagramRoute(
  body: { name: string; engine: DiagramEngine; kind?: DiagramKind; initialDsl?: string },
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const kind: DiagramKind = body.kind ?? inferKind(body.engine);
  const slug = slugify(body.name);
  const ir: GraphIR | undefined = kind === "graph" ? emptyGraphIR() : undefined;
  const dsl: string | undefined = kind === "passthrough" ? body.initialDsl ?? "" : undefined;
  const row = await dbCreateDiagram(deps.sql, {
    workspaceId,
    slug,
    name: body.name,
    engine: body.engine,
    kind,
    ir,
    dsl,
  });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) {
    return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  }
  await dbUpdateDiagram(deps.sql, workspaceId, row.id, { svg: outcome.result.svg });
  broadcastRender(deps.hub, workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: row.id,
    slug: row.slug,
    render: outcome.result,
    warnings: outcome.warnings,
  });
}

async function patchDiagramRoute(
  id: DiagramId,
  ops: PatchOp[],
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const row = await dbGetDiagram(deps.sql, workspaceId, id);
  if (!row) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  if (row.kind !== "graph" || !row.ir)
    return Response.json({ ok: false, error: "patches only valid on graph diagrams" }, { status: 400 });
  const result = applyPatch(row.ir, ops);
  if (!result.ok)
    return Response.json({ ok: false, error: result.error, opIndex: result.opIndex }, { status: 400 });

  await dbUpdateDiagram(deps.sql, workspaceId, id, { ir: result.ir });
  const diagram = dbDiagramToDomain({ ...row, ir: result.ir });
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });

  await dbUpdateDiagram(deps.sql, workspaceId, id, { svg: outcome.result.svg });
  const warnings = [...result.warnings, ...outcome.warnings];
  broadcastRender(deps.hub, workspaceId, diagram, outcome.result.svg, warnings);
  return Response.json({
    diagramId: id,
    ir: result.ir,
    render: outcome.result,
    warnings,
  });
}

async function loadDiagramRoute(slug: string, workspaceId: string, deps: RouteDeps): Promise<Response> {
  const row = await dbGetDiagramBySlug(deps.sql, workspaceId, slug);
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  await dbUpdateDiagram(deps.sql, workspaceId, row.id, { svg: outcome.result.svg });
  broadcastRender(deps.hub, workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: row.id,
    ir: diagram.ir,
    dsl: diagram.dsl,
    render: outcome.result,
  });
}

async function saveDiagramRoute(
  id: DiagramId,
  body: { name?: string; tags?: string[] },
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const row = await dbGetDiagram(deps.sql, workspaceId, id);
  if (!row) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  const patch: Parameters<typeof dbUpdateDiagram>[3] = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.tags !== undefined) {
    const meta = { ...(row.meta as Record<string, unknown>), tags: body.tags };
    patch.meta = meta;
  }
  const updated = await dbUpdateDiagram(deps.sql, workspaceId, id, patch);
  return Response.json({ diagram: updated });
}

async function renderDslRoute(
  body: { engine: DiagramEngine; source: string; name?: string },
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const name = body.name ?? "untitled";
  const slug = slugify(name);
  const row = await dbCreateDiagram(deps.sql, {
    workspaceId,
    slug,
    name,
    engine: body.engine,
    kind: "passthrough",
    dsl: body.source,
  });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  await dbUpdateDiagram(deps.sql, workspaceId, row.id, { svg: outcome.result.svg });
  broadcastRender(deps.hub, workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({ diagramId: row.id, slug: row.slug, render: outcome.result });
}

function broadcastRender(
  hub: WsHub,
  workspaceId: string,
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
  hub.broadcast(workspaceId, msg);
}

async function exportVsdxRoute(
  id: string,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const row = await dbGetDiagram(deps.sql, workspaceId, id);
  if (!row) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });

  let bytes: Uint8Array;
  if (row.engine === "vsdx" && row.kind === "binary" && row.bytes) {
    bytes = row.bytes;
  } else if (row.kind === "graph" && row.ir && canStructuredVsdx(row.engine)) {
    const { writeVsdxFromIr } = await import("../renderers/vsdx-writer");
    const ir = await maybeExtractLayout(row.engine, row.ir, row.dsl);
    const result = await writeVsdxFromIr(ir);
    bytes = result.bytes;
    if (result.warnings.length) console.warn("[vsdx-export]", id, result.warnings);
  } else {
    if (!row.svg) return Response.json({ ok: false, error: "no rendered SVG to embed" }, { status: 400 });
    const { writeVsdxFromSvg } = await import("../renderers/vsdx-writer-fallback");
    bytes = await writeVsdxFromSvg(row.svg);
  }

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-visio.drawing",
      "Content-Disposition": `attachment; filename="${row.slug}.vsdx"`,
    },
  });
}

function canStructuredVsdx(engine: DiagramEngine): boolean {
  return engine === "mermaid" || engine === "d2" || engine === "graphviz";
}

async function maybeExtractLayout(
  engine: DiagramEngine,
  ir: GraphIR,
  dsl: string | null,
): Promise<GraphIR> {
  // For mermaid: original IR has the semantic shapes/labels. Use graphviz
  // ONLY for layout — then merge `_x`/`_y` back into the original IR so we
  // don't lose stencil hints across the round-trip.
  if (engine === "mermaid") {
    const { extractGraphFromDot } = await import("../renderers/graphviz-extractor");
    const laidOut = await extractGraphFromDot(irToDot(ir));
    return mergeLayoutBack(ir, laidOut);
  }
  if (engine === "graphviz" && dsl) {
    const { extractGraphFromDot } = await import("../renderers/graphviz-extractor");
    return await extractGraphFromDot(dsl);
  }
  if (engine === "d2" && dsl) {
    const { extractGraphFromD2 } = await import("../renderers/d2-extractor");
    return await extractGraphFromD2(dsl);
  }
  return ir;
}

function mergeLayoutBack(original: GraphIR, laidOut: GraphIR): GraphIR {
  const nodes: GraphIR["nodes"] = {};
  for (const [id, n] of Object.entries(original.nodes) as Array<[string, Node]>) {
    const laidNode = laidOut.nodes[id] as (Node & { _x?: number; _y?: number }) | undefined;
    nodes[id] = {
      ...n,
      ...(laidNode ? { _x: laidNode._x, _y: laidNode._y } : {}),
    } as Node;
  }
  return { ...original, nodes };
}

const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

async function importVsdxRoute(
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const maxBytes = Number(process.env.VSDX_MAX_BYTES ?? "5242880");
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ ok: false, error: "file part required" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return Response.json(
      { ok: false, error: `file exceeds VSDX_MAX_BYTES (${maxBytes})` },
      { status: 413 },
    );
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length < 4 || !VSDX_MAGIC.every((b, i) => buf[i] === b)) {
    return Response.json(
      { ok: false, error: "not a valid .vsdx file (missing ZIP magic)" },
      { status: 400 },
    );
  }
  let name = (formData.get("name") as string | null) ?? "";
  if (!name && file instanceof File && file.name) {
    name = file.name.replace(/\.vsdx$/i, "").trim();
  }
  if (!name) {
    name = `imported-${Math.random().toString(36).slice(2, 8)}`;
  }
  const slug = slugify(name);

  const row = await dbCreateDiagramWithUniqueSlug(deps.sql, {
    workspaceId,
    slug,
    name,
    engine: "vsdx",
    kind: "binary",
    bytes: buf,
  });
  const diagram: Diagram = {
    id: row.id,
    name: row.name,
    engine: row.engine,
    kind: row.kind,
    bytes: row.bytes ?? undefined,
    meta: (row.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) {
    const { deleteDiagram } = await import("../db/diagrams");
    await deleteDiagram(deps.sql, workspaceId, row.id);
    return Response.json(
      { ok: false, error: `render failed: ${outcome.error}` },
      { status: 502 },
    );
  }
  await dbUpdateDiagram(deps.sql, workspaceId, row.id, { svg: outcome.result.svg });
  broadcastRender(deps.hub, workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: row.id,
    slug: row.slug,
    render: outcome.result,
  });
}

function irToDot(ir: GraphIR): string {
  const lines = ["digraph G { rankdir=" + (ir.layout?.direction ?? "TB") + ";"];
  for (const n of Object.values(ir.nodes) as Node[]) {
    const shape = n.shape ?? "box";
    lines.push(`  ${n.id} [label=${JSON.stringify(n.label ?? n.id)}, shape="${shape}"];`);
  }
  for (const e of Object.values(ir.edges) as Edge[]) {
    const lbl = e.label ? ` [label=${JSON.stringify(e.label)}]` : "";
    lines.push(`  ${e.from} -> ${e.to}${lbl};`);
  }
  lines.push("}");
  return lines.join("\n");
}
