import type {
  Annotation, Camera, Diagram, DiagramEngine, DiagramId, DiagramKind, GraphIR, PatchOp, ServerToClient, Tile,
} from "@prixmaviz/shared";
import { emptyGraphIR, emptyMeta, inferKind, newAnnotationId, newTileId } from "@prixmaviz/shared";
import type postgres from "postgres";
import type { KrokiClient } from "../kroki/client";
import { applyPatch } from "../ir/engine";
import { renderDiagram } from "../render";
import type { WsHub } from "../ws/broadcast";
import { getHitTester } from "../hit-test";
import { canStructuredVsdx, maybeExtractLayout } from "../vsdx/export-helpers";
import { UnknownToolError, ValidationError } from "../mcp/tools";
import { broadcastWorkspaceUpdate } from "../mcp/broadcast";
import { authenticate } from "../auth/bearer";
import {
  createDiagram as dbCreateDiagram,
  createDiagramWithUniqueSlug as dbCreateDiagramWithUniqueSlug,
  getDiagram as dbGetDiagram,
  getDiagramBySlug as dbGetDiagramBySlug,
  listDiagrams as dbListDiagrams,
  updateDiagram as dbUpdateDiagram,
  // Issue #7 Wave 1B — library / organization helpers.
  dbBumpLastOpenedAt,
  dbListTags,
  dbMoveDiagram,
  dbSetPinned,
  dbUpdateMeta,
  isValidFolderPath,
  type DbDiagram,
} from "../db/diagrams";
import {
  dbDeleteFolder,
  dbListEmptyFolders,
  dbRenameFolder,
  dbSetEmptyFolders,
} from "../db/folders";
import { searchDiagramsImpl } from "../mcp/tools/search";
import {
  snapshotVersion as dbSnapshotVersion,
  listVersions as dbListVersions,
  getVersion as dbGetVersion,
} from "../db/versions";
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
  // The web Library component expects the cycle-3 LibraryEntry shape,
  // extended for Issue #7 Wave 1B with `parentPath / pinned / lastOpenedAt`
  // so the new Library sections (folders, pinned, recent) have the data
  // they need on first mount without a follow-up roundtrip.
  // `path` is synthesized from the slug (the web client extracts the slug
  // back out with basename(path).replace(/\.pviz$/, "")).
  if (p === "/api/library" && req.method === "GET") {
    const rows = await dbListDiagrams(deps.sql, workspaceId);
    return Response.json({
      entries: rows.map((d) => ({
        // Issue #7 Wave 2 — surface the diagram UUID so the web Library can
        // call ID-keyed routes (POST /api/diagrams/:id/pin) and match
        // library:diagram-* WS events to a row in the local library list.
        id: d.id,
        name: d.name,
        path: `${d.slug}.pviz`,
        engine: d.engine,
        kind: d.kind,
        tags: Array.isArray((d.meta as { tags?: unknown }).tags)
          ? (d.meta as { tags: string[] }).tags
          : [],
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        // Issue #7 Wave 1B — surface the new columns to the web Library.
        parentPath: d.parentPath,
        pinned: d.pinned,
        lastOpenedAt: d.lastOpenedAt,
      })),
    });
  }

  // ─── Issue #7 Wave 1B — search / library / folders ──────────────
  // GET /api/diagrams/search — query params translate to the
  // search_diagrams MCP impl's args shape. Single SQL builder shared
  // across both transports (per the spec — no duplicate query).
  if (p === "/api/diagrams/search" && req.method === "GET") {
    return await searchDiagramsRoute(url, workspaceId, deps);
  }

  // GET /api/diagrams/tags — distinct tag list for autocomplete (F3).
  if (p === "/api/diagrams/tags" && req.method === "GET") {
    const tags = await dbListTags(deps.sql, workspaceId);
    return Response.json({ tags });
  }

  // POST /api/diagrams/:id/pin — toggle pinned (F4).
  const pinMatch = p.match(/^\/api\/diagrams\/([^/]+)\/pin$/);
  if (pinMatch && req.method === "POST") {
    return await pinDiagramRoute(pinMatch[1]!, req, workspaceId, deps);
  }

  // PATCH /api/diagrams/:id/meta — update description / author / notes (F5).
  const metaMatch = p.match(/^\/api\/diagrams\/([^/]+)\/meta$/);
  if (metaMatch && req.method === "PATCH") {
    return await updateMetaRoute(metaMatch[1]!, req, workspaceId, deps);
  }

  // PATCH /api/diagrams/:id/move — set parent_path (F2 drag-drop).
  const moveMatch = p.match(/^\/api\/diagrams\/([^/]+)\/move$/);
  if (moveMatch && req.method === "PATCH") {
    return await moveDiagramRoute(moveMatch[1]!, req, workspaceId, deps);
  }

  // POST /api/folders/empty — add/remove a path in emptyFolders (F2).
  if (p === "/api/folders/empty" && req.method === "POST") {
    return await emptyFolderRoute(req, workspaceId, deps);
  }

  // POST /api/folders/rename — cascade-rename a folder (F2).
  if (p === "/api/folders/rename" && req.method === "POST") {
    return await renameFolderRoute(req, workspaceId, deps);
  }

  // POST /api/folders/delete — cascade or refuse-on-nonempty delete (F2).
  if (p === "/api/folders/delete" && req.method === "POST") {
    return await deleteFolderRoute(req, workspaceId, deps);
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

  // ─── Issue #6: inline editor + version history ───────────
  // GET /api/diagrams/:id/source — current renderable source (DSL) without
  // re-rendering. The editor uses this to populate the textarea on open.
  const sourceGetMatch = p.match(/^\/api\/diagrams\/([^/]+)\/source$/);
  if (sourceGetMatch && req.method === "GET") {
    const id = sourceGetMatch[1] as DiagramId;
    const d = await dbGetDiagram(deps.sql, workspaceId, id);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    return Response.json({
      id: d.id, engine: d.engine, kind: d.kind, source: d.dsl ?? "",
    });
  }

  // POST /api/diagrams/:id/source — update DSL from the inline editor.
  // Snapshots the prior DSL into diagram_versions, persists the new DSL,
  // and re-renders. On render failure: the prior DSL is restored so the
  // tile keeps showing its previously-good SVG, and the failed text is
  // returned to the client so the editor can preserve it. Passthrough
  // engines only — graph (IR-based) diagrams must go through apply_patch.
  if (sourceGetMatch && req.method === "POST") {
    const id = sourceGetMatch[1] as DiagramId;
    const body = await req.json().catch(() => ({})) as { source?: string };
    return await updateDiagramSourceRoute(id, body.source ?? "", workspaceId, deps);
  }

  // GET /api/diagrams/:id/versions — list newest-first.
  const versionsListMatch = p.match(/^\/api\/diagrams\/([^/]+)\/versions$/);
  if (versionsListMatch && req.method === "GET") {
    const id = versionsListMatch[1] as DiagramId;
    const d = await dbGetDiagram(deps.sql, workspaceId, id);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
    const versions = await dbListVersions(deps.sql, id);
    return Response.json({
      versions: versions.map((v) => ({
        id: v.id, engine: v.engine, kind: v.kind, source: v.source, createdAt: v.createdAt,
      })),
    });
  }

  // POST /api/diagrams/:id/versions/:versionId/restore — restore.
  // Snapshots the current state first, then restores the version's source.
  const restoreMatch = p.match(/^\/api\/diagrams\/([^/]+)\/versions\/([^/]+)\/restore$/);
  if (restoreMatch && req.method === "POST") {
    const id = restoreMatch[1] as DiagramId;
    const versionId = restoreMatch[2]!;
    return await restoreVersionRoute(id, versionId, workspaceId, deps);
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
    const body = await req.json().catch(() => ({})) as { tool?: string; args?: Record<string, unknown> };
    if (!body.tool || typeof body.tool !== "string") {
      return mcpErrorResponse(
        new ValidationError("missing_required_parameter", "Missing required parameter: tool.", "tool"),
        body.tool ?? "<unknown>",
      );
    }
    const args = (body.args ?? {}) as Record<string, unknown>;
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool(body.tool, args, {
        sql: deps.sql,
        workspaceId,
        kroki: deps.kroki,
        hub: deps.hub,
      });
      return Response.json(result);
    } catch (e) {
      return mcpErrorResponse(e, body.tool);
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
      return mcpErrorResponse(e, toolName);
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
    await broadcastWorkspaceUpdate(deps, workspaceId);
    return Response.json(ws);
  }

  if (p === "/api/tiles" && req.method === "POST") {
    const body = await req.json() as { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number };
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    // Server-side dedup (issue #3): if a tile already exists for this
    // diagramSlug, return it with `existing: true` instead of appending a
    // duplicate. Guards against multi-tab races and rapid double-clicks that
    // bypass the client-side check in Library.tsx::open().
    const existing = ws.tiles.find((t) => t.diagramSlug === body.diagramSlug);
    if (existing) {
      return Response.json({ tile: existing, existing: true });
    }
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
    // Issue #7 Wave 1B: createTile is a "first open" event — bump
    // last_opened_at and broadcast so Recent section ordering follows.
    // The helper validates diagramId ownership via the workspace_id JOIN
    // implicit in the SET; an invalid/foreign diagramId is a no-op return.
    // Note: we still check ownership above for the dedup loop, so we
    // only bump when the create succeeded.
    try {
      const verifiedOwn = await dbGetDiagram(deps.sql, workspaceId, body.diagramId);
      if (verifiedOwn) {
        const lastOpenedAt = await dbBumpLastOpenedAt(deps.sql, body.diagramId);
        if (lastOpenedAt) {
          deps.hub.broadcast(workspaceId, {
            type: "library:diagram-opened",
            diagramId: body.diagramId,
            lastOpenedAt,
          });
        }
      }
    } catch (e) {
      console.error(`[createTile] last_opened_at bump failed for ${body.diagramId}:`, e);
    }
    await broadcastWorkspaceUpdate(deps, workspaceId);
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
    await broadcastWorkspaceUpdate(deps, workspaceId);
    return Response.json({ tile: nextTiles[idx] });
  }

  if (tilePatchMatch && req.method === "DELETE") {
    const tileId = tilePatchMatch[1]!;
    const ws = await dbGetWorkspace(deps.sql, workspaceId);
    if (!ws) return Response.json({ ok: false, error: "workspace not found" }, { status: 404 });
    const nextTiles = ws.tiles.filter((t) => t.id !== tileId);
    await dbUpdateWorkspaceTiles(deps.sql, workspaceId, nextTiles);
    await broadcastWorkspaceUpdate(deps, workspaceId);
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
  // Issue #7 Wave 1B: bump last_opened_at (debounced 1s inside the helper)
  // and broadcast the new timestamp so the Recent section reorders without
  // refetching. Best-effort: failure here must NOT fail the load.
  try {
    const lastOpenedAt = await dbBumpLastOpenedAt(deps.sql, row.id);
    if (lastOpenedAt) {
      deps.hub.broadcast(workspaceId, {
        type: "library:diagram-opened",
        diagramId: row.id,
        lastOpenedAt,
      });
    }
  } catch (e) {
    console.error(`[loadDiagram] last_opened_at bump failed for ${row.id}:`, e);
  }
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

// Issue #6: inline editor save. Snapshot prior DSL, persist new DSL, render.
// On render failure: leave the live `diagrams` row UNCHANGED so existing
// SVG remains; return 502 with the engine's error message so the editor
// can surface it inline and keep the user's text.
async function updateDiagramSourceRoute(
  id: DiagramId,
  source: string,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const row = await dbGetDiagram(deps.sql, workspaceId, id);
  if (!row) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  if (row.kind !== "passthrough") {
    return Response.json(
      { ok: false, error: `inline source editing only supported for passthrough kinds (got "${row.kind}"); use apply_patch for graph diagrams` },
      { status: 400 },
    );
  }
  // Try-render BEFORE persisting — keeps the prior good state on failure.
  const trial: Diagram = {
    id: row.id, name: row.name, engine: row.engine, kind: row.kind,
    dsl: source, meta: (row.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
  const outcome = await renderDiagram(trial, { kroki: deps.kroki });
  if (!outcome.ok) {
    return Response.json(
      { ok: false, error: outcome.error, source },
      { status: 502 },
    );
  }
  // Render succeeded — snapshot the prior source, then write the new one.
  await dbSnapshotVersion(deps.sql, {
    diagramId: row.id, engine: row.engine, kind: row.kind, source: row.dsl ?? "",
  });
  await dbUpdateDiagram(deps.sql, workspaceId, id, {
    dsl: source, svg: outcome.result.svg,
  });
  broadcastRender(deps.hub, workspaceId, trial, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: row.id,
    source,
    render: outcome.result,
    warnings: outcome.warnings,
  });
}

// Issue #6: restore a prior version. Snapshots the current source first so
// "Restore" is itself reversible, then writes the version's source back.
async function restoreVersionRoute(
  diagramId: DiagramId,
  versionId: string,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const row = await dbGetDiagram(deps.sql, workspaceId, diagramId);
  if (!row) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  const version = await dbGetVersion(deps.sql, versionId);
  if (!version || version.diagramId !== diagramId) {
    return Response.json({ ok: false, error: "version not found" }, { status: 404 });
  }
  if (row.kind !== "passthrough" || version.kind !== "passthrough") {
    return Response.json(
      { ok: false, error: "restore only supported between passthrough versions" },
      { status: 400 },
    );
  }
  const restoredSource = version.source ?? "";
  const trial: Diagram = {
    id: row.id, name: row.name, engine: row.engine, kind: row.kind,
    dsl: restoredSource, meta: (row.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
  const outcome = await renderDiagram(trial, { kroki: deps.kroki });
  if (!outcome.ok) {
    return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  }
  // Snapshot the current state before restoring so the user can undo.
  await dbSnapshotVersion(deps.sql, {
    diagramId: row.id, engine: row.engine, kind: row.kind, source: row.dsl ?? "",
  });
  await dbUpdateDiagram(deps.sql, workspaceId, diagramId, {
    dsl: restoredSource, svg: outcome.result.svg,
  });
  broadcastRender(deps.hub, workspaceId, trial, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: row.id,
    source: restoredSource,
    render: outcome.result,
    warnings: outcome.warnings,
  });
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

// ───────────────────────────────────────────────────────────────────────────
// Issue #7 Wave 1B — library / folder route helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /api/diagrams/search — thin HTTP shell around the `search_diagrams`
 * MCP impl. The SQL builder lives in `mcp/tools/search.ts`; this route
 * translates URLSearchParams into the tool's args object and forwards.
 * One query path, two transports — no duplicate SQL.
 *
 * Multi-valued params (`engines`, `tags`) accept either repeated keys
 * (`?engines=mermaid&engines=d2`) or comma-separated values
 * (`?engines=mermaid,d2`). The latter is what `URLSearchParams.toString()`
 * naturally produces from an array.
 */
async function searchDiagramsRoute(
  url: URL,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const sp = url.searchParams;
  const q = sp.get("q") ?? undefined;
  const sort = sp.get("sort") ?? undefined;
  const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
  const since = sp.get("since") ?? sp.get("updatedSince") ?? undefined;
  const parentPath = sp.has("parent_path")
    ? sp.get("parent_path") ?? ""
    : sp.has("parentPath")
    ? sp.get("parentPath") ?? ""
    : undefined;

  const enginesRaw = sp.getAll("engines");
  const engines =
    enginesRaw.length === 0
      ? undefined
      : enginesRaw.length === 1 && enginesRaw[0]!.includes(",")
      ? enginesRaw[0]!.split(",").map((s) => s.trim()).filter(Boolean)
      : enginesRaw;
  const tagsRaw = sp.getAll("tags");
  const tags =
    tagsRaw.length === 0
      ? undefined
      : tagsRaw.length === 1 && tagsRaw[0]!.includes(",")
      ? tagsRaw[0]!.split(",").map((s) => s.trim()).filter(Boolean)
      : tagsRaw;

  // Build args matching the MCP tool's input shape.
  const args: Record<string, unknown> = {};
  if (q) args.query = q;
  if (engines) args.engines = engines;
  if (tags) args.tags = tags;
  if (since) args.updatedSince = since;
  if (parentPath !== undefined) args.parentPath = parentPath;
  if (sort) args.sort = sort;
  if (limit !== undefined) args.limit = limit;

  try {
    const result = await searchDiagramsImpl(args, {
      sql: deps.sql,
      workspaceId,
      kroki: deps.kroki,
      hub: deps.hub,
    });
    return Response.json(result);
  } catch (e) {
    // Validation-style errors from the impl carry useful messages.
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

/**
 * POST /api/diagrams/:id/pin — toggle pinned. Ownership check via
 * dbGetDiagram before invoking dbSetPinned (the helper keys on
 * diagramId only). Broadcasts library:diagram-updated on success.
 */
async function pinDiagramRoute(
  diagramId: string,
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { pinned?: unknown };
  if (typeof body.pinned !== "boolean") {
    return Response.json(
      { ok: false, error: "pinned must be a boolean" },
      { status: 400 },
    );
  }
  const existing = await dbGetDiagram(deps.sql, workspaceId, diagramId);
  if (!existing) {
    return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  }
  const newPinned = await dbSetPinned(deps.sql, diagramId, body.pinned);
  if (newPinned === null) {
    return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  }
  deps.hub.broadcast(workspaceId, {
    type: "library:diagram-updated",
    diagramId,
    change: "pinned",
  });
  return Response.json({ pinned: newPinned });
}

/**
 * PATCH /api/diagrams/:id/meta — patch description / author / notes.
 * Wave 1A's dbUpdateMeta uses JSONB `||` merge so `tags / sourcePaths /
 * createdAt` survive. Ownership check first, then mutate + broadcast.
 */
async function updateMetaRoute(
  diagramId: string,
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as {
    description?: unknown;
    author?: unknown;
    notes?: unknown;
  };
  // Type-check each provided patch field.
  for (const k of ["description", "author", "notes"] as const) {
    if (body[k] !== undefined && typeof body[k] !== "string") {
      return Response.json(
        { ok: false, error: `${k} must be a string` },
        { status: 400 },
      );
    }
  }
  if (body.description === undefined && body.author === undefined && body.notes === undefined) {
    return Response.json(
      { ok: false, error: "at least one of description, author, or notes must be provided" },
      { status: 400 },
    );
  }

  const existing = await dbGetDiagram(deps.sql, workspaceId, diagramId);
  if (!existing) {
    return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  }

  const patch: { description?: string; author?: string; notes?: string } = {};
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.author === "string") patch.author = body.author;
  if (typeof body.notes === "string") patch.notes = body.notes;

  const meta = await dbUpdateMeta(deps.sql, diagramId, patch);
  if (meta === null) {
    return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  }
  deps.hub.broadcast(workspaceId, {
    type: "library:diagram-updated",
    diagramId,
    change: "meta",
  });
  return Response.json({ meta });
}

/**
 * PATCH /api/diagrams/:id/move — set parent_path. isValidFolderPath
 * gate before DB mutate so path-traversal (`../`), wildcards (`%`/`_`
 * in invalid positions), and leading/trailing slashes are rejected
 * with a clean 400.
 */
async function moveDiagramRoute(
  diagramId: string,
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { parentPath?: unknown };
  if (typeof body.parentPath !== "string") {
    return Response.json(
      { ok: false, error: "parentPath must be a string" },
      { status: 400 },
    );
  }
  if (!isValidFolderPath(body.parentPath)) {
    return Response.json(
      { ok: false, error: `invalid folder path: ${JSON.stringify(body.parentPath)}` },
      { status: 400 },
    );
  }

  const existing = await dbGetDiagram(deps.sql, workspaceId, diagramId);
  if (!existing) {
    return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  }

  const newPath = await dbMoveDiagram(deps.sql, diagramId, body.parentPath);
  if (newPath === null) {
    return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  }
  deps.hub.broadcast(workspaceId, {
    type: "library:diagram-updated",
    diagramId,
    change: "moved",
  });
  return Response.json({ ok: true, parentPath: newPath });
}

/**
 * POST /api/folders/empty — add or remove a path in
 * `workspaces.settings.emptyFolders`. The list tracks folders that
 * exist in the Library tree but contain no diagrams yet (F2: "New
 * folder" inline-input).
 *
 * On first drag-drop INTO an empty folder, the F2 web flow removes
 * the entry separately — this route is for explicit add/remove.
 */
async function emptyFolderRoute(
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as {
    path?: unknown;
    action?: unknown;
  };
  if (typeof body.path !== "string") {
    return Response.json({ ok: false, error: "path must be a string" }, { status: 400 });
  }
  if (body.action !== "add" && body.action !== "remove") {
    return Response.json(
      { ok: false, error: "action must be 'add' or 'remove'" },
      { status: 400 },
    );
  }
  if (!isValidFolderPath(body.path) || body.path === "") {
    return Response.json(
      { ok: false, error: `invalid folder path: ${JSON.stringify(body.path)}` },
      { status: 400 },
    );
  }

  const current = await dbListEmptyFolders(deps.sql, workspaceId);
  const next =
    body.action === "add"
      ? current.includes(body.path)
        ? current
        : [...current, body.path]
      : current.filter((p) => p !== body.path);

  try {
    await dbSetEmptyFolders(deps.sql, workspaceId, next);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
  deps.hub.broadcast(workspaceId, {
    type: "library:folders-changed",
    emptyFolders: next,
  });
  return Response.json({ emptyFolders: next });
}

/**
 * POST /api/folders/rename — cascade-rename. Wave 1A's dbRenameFolder
 * handles the diagram rows (using starts_with, not LIKE — guards
 * against `%`/`_` glob attacks). We additionally rewrite any
 * empty-folder entries whose path starts with the renamed prefix,
 * since those live in workspaces.settings and aren't touched by the
 * diagram-rename SQL.
 */
async function renameFolderRoute(
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { from?: unknown; to?: unknown };
  if (typeof body.from !== "string" || typeof body.to !== "string") {
    return Response.json(
      { ok: false, error: "from and to must both be strings" },
      { status: 400 },
    );
  }
  if (body.from === "" || !isValidFolderPath(body.from)) {
    return Response.json(
      { ok: false, error: `invalid source folder: ${JSON.stringify(body.from)}` },
      { status: 400 },
    );
  }
  if (body.to === "" || !isValidFolderPath(body.to)) {
    return Response.json(
      { ok: false, error: `invalid target folder: ${JSON.stringify(body.to)}` },
      { status: 400 },
    );
  }

  let affected = 0;
  try {
    affected = await dbRenameFolder(deps.sql, workspaceId, body.from, body.to);
  } catch (e) {
    // Wave 1A throws a structured error with `error / rows / cap` for
    // the row-cap overflow case. Pass it through with a 400 so the
    // client can show the count.
    const err = e as { error?: string; rows?: number; cap?: number; message?: string };
    if (err.error === "folder rename touches too many rows") {
      return Response.json(
        { ok: false, error: err.error, rows: err.rows, cap: err.cap },
        { status: 400 },
      );
    }
    return Response.json(
      { ok: false, error: err.message ?? String(e) },
      { status: 400 },
    );
  }

  // Now rewrite the workspace's empty-folder entries with the same
  // prefix-rewrite as the SQL helper. Defensive: list, transform, set.
  const ef = await dbListEmptyFolders(deps.sql, workspaceId);
  const rewriteFrom = body.from;
  const rewriteTo = body.to;
  const rewritten = ef.map((p) => {
    if (p === rewriteFrom) return rewriteTo;
    if (p.startsWith(rewriteFrom + "/")) {
      return rewriteTo + p.slice(rewriteFrom.length);
    }
    return p;
  });
  if (rewritten.some((p, i) => p !== ef[i])) {
    try {
      await dbSetEmptyFolders(deps.sql, workspaceId, rewritten);
    } catch (e) {
      console.error("[renameFolder] empty-folder rewrite failed:", e);
      // Non-fatal — diagrams already moved.
    }
  }

  deps.hub.broadcast(workspaceId, {
    type: "library:folders-changed",
    emptyFolders: rewritten,
  });
  return Response.json({ affected });
}

/**
 * POST /api/folders/delete — cascade or refuse-on-nonempty.
 * Wave 1A's dbDeleteFolder atomically deletes the diagrams (when
 * cascade) AND strips the path from emptyFolders.
 */
async function deleteFolderRoute(
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as {
    path?: unknown;
    cascade?: unknown;
  };
  if (typeof body.path !== "string") {
    return Response.json({ ok: false, error: "path must be a string" }, { status: 400 });
  }
  if (typeof body.cascade !== "boolean") {
    return Response.json(
      { ok: false, error: "cascade must be a boolean" },
      { status: 400 },
    );
  }
  if (body.path === "" || !isValidFolderPath(body.path)) {
    return Response.json(
      { ok: false, error: `invalid folder path: ${JSON.stringify(body.path)}` },
      { status: 400 },
    );
  }

  let deleted = 0;
  try {
    deleted = await dbDeleteFolder(deps.sql, workspaceId, body.path, body.cascade);
  } catch (e) {
    const err = e as { error?: string; count?: number; message?: string };
    if (err.error === "folder has N diagrams") {
      return Response.json(
        { ok: false, error: err.error, count: err.count },
        { status: 409 },
      );
    }
    return Response.json(
      { ok: false, error: err.message ?? String(e) },
      { status: 400 },
    );
  }

  // After delete, broadcast the new empty-folder state (dbDeleteFolder
  // strips the path inside its transaction — list again for accuracy).
  const ef = await dbListEmptyFolders(deps.sql, workspaceId);
  deps.hub.broadcast(workspaceId, {
    type: "library:folders-changed",
    emptyFolders: ef,
  });
  return Response.json({ deleted });
}

// ───────────────────────────────────────────────────────────────────────────
// MCP error envelope
// ───────────────────────────────────────────────────────────────────────────
//
// Translate a thrown exception from `dispatchTool` into a structured HTTP
// response. The error envelope is:
//
//   {
//     "ok": false,
//     "error": {
//       "code": "<machine_readable_code>",
//       "message": "<human readable, names the offending parameter>",
//       // Optional extras (when applicable):
//       "parameter": "<arg name>",   // for validation errors
//       "expected": <unknown>,       // valid alternatives (enum / type)
//       "tool":     "<tool name>",   // always present
//       "correlationId": "<uuid>"    // for INTERNAL_ERROR only
//     }
//   }
//
// Status codes:
//   400 — validation error (caller bug, fixable from the message)
//   404 — unknown tool
//   500 — anything else (treated as an internal error; stack logged
//         server-side, NOT leaked to the caller)
//
// The shim parses the body as plain text and slices to 500 chars before
// embedding in its own thrown error, so the JSON envelope must remain
// readable when truncated. `ok: false` is preserved alongside the new
// `error` object purely for backwards-compat with any consumer still
// checking the legacy boolean.
function mcpErrorResponse(e: unknown, toolName: string): Response {
  if (e instanceof ValidationError) {
    const body = {
      ok: false,
      error: {
        code: e.code,
        message: e.message,
        ...(e.parameter !== undefined ? { parameter: e.parameter } : {}),
        ...(e.expected !== undefined ? { expected: e.expected } : {}),
        tool: toolName,
      },
    };
    return Response.json(body, { status: 400 });
  }
  if (e instanceof UnknownToolError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "unknown_tool",
          message: `Unknown MCP tool: ${e.toolName}.`,
          tool: e.toolName,
        },
      },
      { status: 404 },
    );
  }
  // A plain `Error` carries an intentional, caller-facing message —
  // e.g. "diagram not found", "tile not found", "patch failed at op N".
  // Surface it as a 400 with `code: tool_error` so the client gets a
  // useful explanation without leaking JS-runtime internals.
  //
  // A `TypeError` / `ReferenceError` / `RangeError` / `SyntaxError`
  // signals a bug or unguarded undefined inside the impl (the
  // classic `s.toLowerCase` / `name.endsWith` leak from issue #14).
  // The same goes for `UNDEFINED_VALUE` from the postgres driver
  // when a required field reached the SQL layer as `undefined`.
  // Map those to a generic 500 so they never reach the caller.
  const isJsRuntimeError =
    e instanceof TypeError ||
    e instanceof ReferenceError ||
    e instanceof RangeError ||
    e instanceof SyntaxError ||
    isUndefinedValuePostgresError(e);

  if (e instanceof Error && !isJsRuntimeError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "tool_error",
          message: e.message,
          tool: toolName,
        },
      },
      { status: 400 },
    );
  }

  // Unknown / runtime-bug throw — log with a correlation id so operators
  // can find the original stack, but never leak the runtime detail.
  const correlationId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  // eslint-disable-next-line no-console
  console.error(`[mcp:${toolName}:${correlationId}] internal error:`, e);
  return Response.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "Internal server error. See server logs for details.",
        tool: toolName,
        correlationId,
      },
    },
    { status: 500 },
  );
}

function isUndefinedValuePostgresError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && code === "UNDEFINED_VALUE") return true;
  // Some postgres versions put the marker in the message instead of `.code`.
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && msg.startsWith("UNDEFINED_VALUE:");
}
