import {
  ALL_ENGINES, emptyGraphIR, emptyMeta, inferKind,
  type Camera, type Diagram, type DiagramEngine, type GraphIR,
  type PatchOp, type ServerToClient, type Tile,
} from "@prixmaviz/shared";
import type postgres from "postgres";
import { applyPatch } from "../ir/engine";
import { arrange } from "../canvas/arrange";
import type { KrokiClient } from "../kroki/client";
import { renderDiagram } from "../render";
import type { WsHub } from "../ws/broadcast";
import {
  createDiagram as dbCreateDiagram,
  getDiagram as dbGetDiagram,
  getDiagramBySlug as dbGetDiagramBySlug,
  listDiagrams as dbListDiagrams,
  updateDiagram as dbUpdateDiagram,
  type DbDiagram,
} from "../db/diagrams";
import { listAnnotations as dbListAnnotations } from "../db/annotations";
import {
  getWorkspace as dbGetWorkspace,
  updateWorkspaceCamera as dbUpdateWorkspaceCamera,
  updateWorkspaceTiles as dbUpdateWorkspaceTiles,
} from "../db/workspaces";

type Sql = ReturnType<typeof postgres>;

export interface ToolCtx {
  sql: Sql;
  workspaceId: string;
  kroki: KrokiClient;
  hub: WsHub;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "create_diagram",
    description: "Create a new diagram in the workspace. Persisted immediately.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        engine: { type: "string", enum: ALL_ENGINES },
        kind: { type: "string", enum: ["graph", "passthrough"] },
        initialDsl: { type: "string" },
      },
      required: ["name", "engine"],
    },
    run: createDiagramImpl,
  },
  {
    name: "apply_patch",
    description: "Apply N patch ops atomically to a graph diagram. Returns new IR + render.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        ops: { type: "array" },
      },
      required: ["diagramId", "ops"],
    },
    run: applyPatchImpl,
  },
  {
    name: "save_diagram",
    description: "Update diagram metadata (name, tags). Diagrams are auto-persisted on every change in the new model; this is a metadata-only update.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["diagramId"],
    },
    run: saveDiagramImpl,
  },
  {
    name: "load_diagram",
    description: "Load a saved diagram by slug within the workspace.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: loadDiagramImpl,
  },
  {
    name: "list_diagrams",
    description: "List diagrams in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        search: { type: "string" },
      },
    },
    run: listDiagramsImpl,
  },
  {
    name: "render_dsl",
    description: "Render an arbitrary diagram DSL via the chosen engine. For passthrough engines.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string", enum: ALL_ENGINES },
        source: { type: "string" },
        name: { type: "string" },
      },
      required: ["engine", "source"],
    },
    run: renderDslImpl,
  },
  {
    name: "get_annotations",
    description: "List annotations on a diagram. Each annotation includes structured target info (e.g., targetNodes for graph engines, bboxData for charts).",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        includeResolved: { type: "boolean" },
      },
      required: ["diagramId"],
    },
    run: getAnnotationsImpl,
  },
  {
    name: "update_tile",
    description: "Move, resize, or focus a tile on the canvas. patch fields override current tile state.",
    inputSchema: {
      type: "object",
      properties: {
        tileId: { type: "string" },
        patch: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            w: { type: "number" }, h: { type: "number" },
            focused: { type: "boolean" },
          },
        },
      },
      required: ["tileId", "patch"],
    },
    run: updateTileImpl,
  },
  {
    name: "set_view",
    description: "Control the canvas viewport. Either set the camera directly, or auto-arrange tiles by style.",
    inputSchema: {
      type: "object",
      properties: {
        camera: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, zoom: { type: "number" } },
        },
        arrange: {
          type: "object",
          properties: {
            style: { type: "string", enum: ["grid", "horizontal", "vertical"] },
            diagrams: { type: "array", items: { type: "string" } },
            padding: { type: "number" },
          },
        },
      },
    },
    run: setViewImpl,
  },
  {
    name: "get_focused_tile",
    description: "Return the tile most recently interacted with (clicked, dragged, annotated, or AI-patched). Use this to resolve deictic references like 'this', 'that', 'the highlighted area'.",
    inputSchema: { type: "object", properties: {} },
    run: getFocusedTileImpl,
  },
  {
    name: "get_view_url",
    description: "Return the URL where the user can view rendered diagrams in their browser. ALWAYS call this after rendering and include the URL in your response so the user can see the diagram.",
    inputSchema: { type: "object", properties: {} },
    run: getViewUrlImpl,
  },
  {
    name: "import_vsdx",
    description: "Import a Microsoft Visio (.vsdx) file into the workspace. Renders natively via the server-side converter. Returns the new diagram ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        base64Source: { type: "string", description: "Base64-encoded .vsdx file bytes" },
      },
      required: ["name", "base64Source"],
    },
    run: importVsdxImpl,
  },
];

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return await tool.run(args, ctx);
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

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

function broadcast(hub: WsHub, workspaceId: string, d: Diagram, svg: string, warnings: string[]): void {
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

async function broadcastWorkspace(ctx: ToolCtx): Promise<void> {
  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) return;
  ctx.hub.broadcast(ctx.workspaceId, { type: "workspace", camera: ws.camera, tiles: ws.tiles });
}

// ───────────────────────────────────────────────────────────────────────────
// Tool implementations
// ───────────────────────────────────────────────────────────────────────────

async function createDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const engine = args.engine as DiagramEngine;
  const kind = (args.kind as Diagram["kind"]) ?? inferKind(engine);
  const slug = slugify(name);
  const initialDsl = (args.initialDsl as string | undefined) ?? "";
  const ir: GraphIR | undefined = kind === "graph" ? emptyGraphIR() : undefined;
  const dsl: string | undefined = kind === "passthrough" ? initialDsl : undefined;

  const row = await dbCreateDiagram(ctx.sql, {
    workspaceId: ctx.workspaceId,
    slug,
    name,
    engine,
    kind,
    ir,
    dsl,
  });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });
  broadcast(ctx.hub, ctx.workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: row.id, slug: row.slug, render: outcome.result };
}

async function applyPatchImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as string;
  const ops = args.ops as PatchOp[];
  const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, id);
  if (!row) throw new Error("diagram not found");
  if (row.kind !== "graph" || !row.ir) throw new Error("patches only valid on graph diagrams");
  const result = applyPatch(row.ir, ops);
  if (!result.ok) {
    throw new Error(`patch failed at op ${result.opIndex}: ${result.error}`);
  }
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, id, { ir: result.ir });
  const diagram = dbDiagramToDomain({ ...row, ir: result.ir });
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, id, { svg: outcome.result.svg });
  const warnings = [...result.warnings, ...outcome.warnings];
  broadcast(ctx.hub, ctx.workspaceId, diagram, outcome.result.svg, warnings);
  return { diagramId: id, ir: result.ir, render: outcome.result, warnings };
}

async function saveDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as string;
  const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, id);
  if (!row) throw new Error("diagram not found");
  const patch: Parameters<typeof dbUpdateDiagram>[3] = {};
  if (args.name !== undefined) patch.name = args.name as string;
  if (args.tags !== undefined) {
    const meta = { ...(row.meta as Record<string, unknown>), tags: args.tags };
    patch.meta = meta;
  }
  const updated = await dbUpdateDiagram(ctx.sql, ctx.workspaceId, id, patch);
  return { diagram: updated };
}

async function loadDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const slug = name.endsWith(".pviz") ? name.replace(/\.pviz$/, "") : name;
  const row = await dbGetDiagramBySlug(ctx.sql, ctx.workspaceId, slug);
  if (!row) throw new Error("diagram not found");
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });
  broadcast(ctx.hub, ctx.workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: row.id, ir: diagram.ir, dsl: diagram.dsl, render: outcome.result };
}

async function listDiagramsImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const tag = args.tag as string | undefined;
  const search = args.search as string | undefined;
  const rows = await dbListDiagrams(ctx.sql, ctx.workspaceId);
  let filtered = rows;
  if (tag) {
    filtered = filtered.filter((d) => {
      const tags = (d.meta as { tags?: string[] }).tags;
      return Array.isArray(tags) && tags.includes(tag);
    });
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((d) => {
      if (d.name.toLowerCase().includes(q)) return true;
      const tags = (d.meta as { tags?: string[] }).tags;
      if (Array.isArray(tags) && tags.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }
  return {
    diagrams: filtered.map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.name,
      engine: d.engine,
      kind: d.kind,
      updatedAt: d.updatedAt,
    })),
  };
}

async function renderDslImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const engine = args.engine as DiagramEngine;
  const source = args.source as string;
  const name = (args.name as string | undefined) ?? "untitled";
  const slug = slugify(name);
  const row = await dbCreateDiagram(ctx.sql, {
    workspaceId: ctx.workspaceId,
    slug,
    name,
    engine,
    kind: "passthrough",
    dsl: source,
  });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });
  broadcast(ctx.hub, ctx.workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: row.id, slug: row.slug, render: outcome.result };
}

async function getAnnotationsImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const includeResolved = Boolean(args.includeResolved);
  // Authorization: verify diagram belongs to this workspace before reading annotations.
  const d = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!d) throw new Error("diagram not found");
  const annotations = await dbListAnnotations(ctx.sql, diagramId, { includeResolved });
  return { annotations };
}

interface FocusableTile extends Tile {
  focused?: boolean;
  lastFocusedAt?: string;
}

async function updateTileImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const tileId = args.tileId as string;
  const patch = args.patch as { x?: number; y?: number; w?: number; h?: number; focused?: boolean };
  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) throw new Error("workspace not found");
  const tiles = ws.tiles as FocusableTile[];
  const idx = tiles.findIndex((t) => t.id === tileId);
  if (idx < 0) throw new Error("tile not found");
  const current = tiles[idx]!;
  const next: FocusableTile = {
    ...current,
    ...(patch.x !== undefined ? { x: patch.x } : {}),
    ...(patch.y !== undefined ? { y: patch.y } : {}),
    ...(patch.w !== undefined ? { w: patch.w } : {}),
    ...(patch.h !== undefined ? { h: patch.h } : {}),
  };
  const nextTiles = [...tiles];
  nextTiles[idx] = next;

  if (patch.focused) {
    // Clear focused from all others, set on this one
    for (let i = 0; i < nextTiles.length; i++) {
      const t = nextTiles[i]!;
      if (i === idx) {
        nextTiles[i] = { ...t, focused: true, lastFocusedAt: new Date().toISOString() };
      } else if (t.focused) {
        nextTiles[i] = { ...t, focused: false };
      }
    }
    const camera: Camera = {
      x: next.x + next.w / 2 - 400,
      y: next.y + next.h / 2 - 300,
      zoom: 1,
    };
    await dbUpdateWorkspaceCamera(ctx.sql, ctx.workspaceId, camera);
  }
  await dbUpdateWorkspaceTiles(ctx.sql, ctx.workspaceId, nextTiles);
  await broadcastWorkspace(ctx);
  return { tile: nextTiles[idx] };
}

async function setViewImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const camera = args.camera as Camera | undefined;
  const arr = args.arrange as
    | { style: "grid" | "horizontal" | "vertical"; diagrams: string[]; padding?: number }
    | undefined;

  if (camera) {
    await dbUpdateWorkspaceCamera(ctx.sql, ctx.workspaceId, camera);
  }
  if (arr) {
    const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
    if (!ws) throw new Error("workspace not found");
    const tiles = ws.tiles as Tile[];
    const subset = tiles.filter((t) => arr.diagrams.includes(t.diagramId));
    const arranged = arrange(subset, arr.style, arr.padding ?? 20);
    const byId = new Map(arranged.map((t) => [t.id, t]));
    const nextTiles = tiles.map((t) => {
      const a = byId.get(t.id);
      return a ? { ...t, x: a.x, y: a.y } : t;
    });
    await dbUpdateWorkspaceTiles(ctx.sql, ctx.workspaceId, nextTiles);
  }
  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) throw new Error("workspace not found");
  ctx.hub.broadcast(ctx.workspaceId, { type: "workspace", camera: ws.camera, tiles: ws.tiles });
  return { camera: ws.camera, tiles: ws.tiles };
}

async function getFocusedTileImpl(_args: Record<string, unknown>, ctx: ToolCtx) {
  const ws = await dbGetWorkspace(ctx.sql, ctx.workspaceId);
  if (!ws) return { tile: null };
  const tiles = ws.tiles as FocusableTile[];
  const focused = tiles.find((t) => t.focused);
  return { tile: focused ?? null };
}

async function getViewUrlImpl(_args: Record<string, unknown>, ctx: ToolCtx) {
  const baseUrl = process.env.PRIXMAVIZ_PUBLIC_URL;
  if (!baseUrl) {
    return {
      url: null,
      message: "PRIXMAVIZ_PUBLIC_URL not set",
    };
  }
  // Deep-link to the caller's workspace so opening the URL in a fresh browser
  // tab lands on the SAME workspace the AI just rendered into, not a freshly
  // bootstrapped empty one. The web client honors /w/<uuid> by caching the
  // UUID in localStorage and using it as the Bearer token for subsequent calls.
  const url = `${baseUrl.replace(/\/$/, "")}/w/${ctx.workspaceId}`;
  return {
    url,
    note: "Open this URL in any browser to see the rendered diagrams and annotate them.",
  };
}

const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

async function importVsdxImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const base64Source = args.base64Source as string;
  if (!name || !base64Source) throw new Error("name and base64Source are required");
  const bytes = new Uint8Array(Buffer.from(base64Source, "base64"));
  if (bytes.length < 4 || !VSDX_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("not a valid .vsdx file (missing ZIP magic)");
  }
  const maxBytes = Number(process.env.VSDX_MAX_BYTES ?? "5242880");
  if (bytes.length > maxBytes) {
    throw new Error(`file exceeds VSDX_MAX_BYTES (${maxBytes})`);
  }
  const slug = slugify(name);

  const row = await dbCreateDiagram(ctx.sql, {
    workspaceId: ctx.workspaceId,
    slug,
    name,
    engine: "vsdx",
    kind: "binary",
    bytes,
  });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) {
    const { deleteDiagram } = await import("../db/diagrams");
    await deleteDiagram(ctx.sql, ctx.workspaceId, row.id);
    throw new Error(`render failed: ${outcome.error}`);
  }
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });
  broadcast(ctx.hub, ctx.workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: row.id, slug: row.slug, render: outcome.result };
}

