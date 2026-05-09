import {
  ALL_ENGINES, emptyGraphIR, emptyMeta, inferKind,
  type Diagram, type DiagramEngine, type DiagramId, type GraphIR,
  type LibraryEntry, type PatchOp, type ServerToClient,
} from "@prixmaviz/shared";
import { applyPatch } from "../ir/engine";
import type { KrokiClient } from "../kroki/client";
import type { PrixmaPaths } from "../bootstrap";
import { listPvizEntries, readPviz, writePviz } from "../pviz/io";
import { renderDiagram } from "../render";
import { DiagramStore, newDiagramId } from "../store/diagrams";
import type { WsHub } from "../ws/broadcast";
import { AnnotationStore } from "../annotations/store";
import { WorkspaceStore } from "../canvas/store";
import { arrange } from "../canvas/arrange";
import { isAppRunning, launchApp, lockfilePath } from "./lifecycle";

export interface ToolCtx {
  paths: PrixmaPaths;
  store: DiagramStore;
  annotations: AnnotationStore;
  workspace: WorkspaceStore;
  schedulePersistWorkspace: () => void;
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
    description: "Create a new diagram in memory. Not saved to disk until save_diagram.",
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
    run: createDiagram,
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
    run: applyPatchTool,
  },
  {
    name: "save_diagram",
    description: "Persist diagram to <project>/.prixmaviz/diagrams/<slug>.pviz with sibling SVG.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["diagramId"],
    },
    run: saveDiagram,
  },
  {
    name: "load_diagram",
    description: "Load a saved .pviz diagram back into memory by name (slug).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: loadDiagram,
  },
  {
    name: "list_diagrams",
    description: "List saved diagrams in the project library.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        search: { type: "string" },
      },
    },
    run: listDiagrams,
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
    run: renderDsl,
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
    run: getAnnotations,
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
    run: updateTile,
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
    run: setView,
  },
  {
    name: "install_mcp_plugin",
    description: "Write the PrixmaViz MCP entry into the host's config file. Idempotent. confirm=false returns the snippet without writing.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", enum: ["claude-code", "codex", "vscode"] },
        confirm: { type: "boolean" },
      },
      required: ["host", "confirm"],
    },
    run: installMcpPlugin,
  },
  {
    name: "get_focused_tile",
    description: "Return the tile most recently interacted with (clicked, dragged, annotated, or AI-patched). Use this to resolve deictic references like 'this', 'that', 'the highlighted area' — the focused tile is what the user is talking about.",
    inputSchema: { type: "object", properties: {} },
    run: getFocusedTile,
  },
  {
    name: "check_app_running",
    description: "Check whether the PrixmaViz Tauri app is currently running. Use BEFORE rendering a diagram so you know whether the user can see your output. If running=false, ASK the user before launching the app.",
    inputSchema: { type: "object", properties: {} },
    run: checkAppRunning,
  },
  {
    name: "launch_app",
    description: "Launch the PrixmaViz Tauri app if it is not already running. Only call this AFTER the user has explicitly confirmed they want the app launched (do not surprise users by spawning windows).",
    inputSchema: { type: "object", properties: {} },
    run: launchAppTool,
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

async function createDiagram(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const engine = args.engine as DiagramEngine;
  const kind = (args.kind as Diagram["kind"]) ?? inferKind(engine);
  const id: DiagramId = newDiagramId();
  const diagram: Diagram = {
    id,
    name,
    engine,
    kind,
    ir: kind === "graph" ? emptyGraphIR() : undefined,
    dsl: kind === "passthrough" ? (args.initialDsl as string) ?? "" : undefined,
    meta: emptyMeta(),
  };
  ctx.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  broadcast(ctx.hub, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: id, render: outcome.result };
}

async function applyPatchTool(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as DiagramId;
  const ops = args.ops as PatchOp[];
  const d = ctx.store.get(id);
  if (!d) throw new Error("diagram not found");
  if (d.kind !== "graph" || !d.ir) throw new Error("patches only valid on graph diagrams");
  const result = applyPatch(d.ir, ops);
  if (!result.ok) {
    throw new Error(`patch failed at op ${result.opIndex}: ${result.error}`);
  }
  d.ir = result.ir;
  d.meta.updatedAt = new Date().toISOString();
  const outcome = await renderDiagram(d, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  const warnings = [...result.warnings, ...outcome.warnings];
  broadcast(ctx.hub, d, outcome.result.svg, warnings);
  return { diagramId: id, ir: d.ir, render: outcome.result, warnings };
}

async function saveDiagram(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as DiagramId;
  const d = ctx.store.get(id);
  if (!d) throw new Error("diagram not found");
  if (args.name) d.name = args.name as string;
  if (args.tags) d.meta.tags = args.tags as string[];
  d.meta.updatedAt = new Date().toISOString();
  const outcome = await renderDiagram(d, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  const written = await writePviz(ctx.paths.diagramsDir, d, outcome.result.svg);
  return { path: written.path, meta: d.meta };
}

async function loadDiagram(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const slug = name.endsWith(".pviz") ? name.replace(/\.pviz$/, "") : name;
  const path = `${ctx.paths.diagramsDir}/${slug}.pviz`;
  const file = await readPviz(path);
  const id: DiagramId = file.id;
  const diagram: Diagram = {
    id,
    name: file.name,
    engine: file.engine,
    kind: file.kind,
    ir: file.ir,
    dsl: file.dsl,
    meta: file.meta,
  };
  ctx.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  broadcast(ctx.hub, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: id, ir: diagram.ir, dsl: diagram.dsl, render: outcome.result };
}

async function listDiagrams(args: Record<string, unknown>, ctx: ToolCtx) {
  const tag = args.tag as string | undefined;
  const search = args.search as string | undefined;
  let entries: LibraryEntry[] = await listPvizEntries(ctx.paths.diagramsDir);
  if (tag) entries = entries.filter((e) => e.tags.includes(tag));
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  return { diagrams: entries };
}

async function renderDsl(args: Record<string, unknown>, ctx: ToolCtx) {
  const engine = args.engine as DiagramEngine;
  const source = args.source as string;
  const name = args.name as string | undefined;
  const id: DiagramId = newDiagramId();
  const diagram: Diagram = {
    id,
    name: name ?? "untitled",
    engine,
    kind: "passthrough",
    dsl: source,
    meta: emptyMeta(),
  };
  ctx.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  if (name) await writePviz(ctx.paths.diagramsDir, diagram, outcome.result.svg);
  broadcast(ctx.hub, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: id, render: outcome.result };
}

function broadcast(hub: WsHub, d: Diagram, svg: string, warnings: string[]): void {
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

async function getAnnotations(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as DiagramId;
  const includeResolved = Boolean(args.includeResolved);
  const all = ctx.annotations.listByDiagram(id);
  const filtered = includeResolved ? all : all.filter(a => !a.resolvedAt);
  return { annotations: filtered };
}

async function updateTile(args: Record<string, unknown>, ctx: ToolCtx) {
  const tileId = args.tileId as string;
  const patch = args.patch as { x?: number; y?: number; w?: number; h?: number; focused?: boolean };
  const tile = ctx.workspace.updateTile(tileId, {
    ...(patch.x !== undefined ? { x: patch.x } : {}),
    ...(patch.y !== undefined ? { y: patch.y } : {}),
    ...(patch.w !== undefined ? { w: patch.w } : {}),
    ...(patch.h !== undefined ? { h: patch.h } : {}),
  });
  if (!tile) throw new Error("tile not found");
  if (patch.focused) {
    ctx.workspace.setCamera({
      x: tile.x + tile.w / 2 - 400,
      y: tile.y + tile.h / 2 - 300,
      zoom: 1,
    });
  }
  ctx.schedulePersistWorkspace();
  const w = ctx.workspace.get();
  ctx.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
  return { tile };
}

async function setView(args: Record<string, unknown>, ctx: ToolCtx) {
  const camera = args.camera as { x: number; y: number; zoom: number } | undefined;
  const arr = args.arrange as { style: "grid" | "horizontal" | "vertical"; diagrams: string[]; padding?: number } | undefined;
  if (camera) ctx.workspace.setCamera(camera);
  if (arr) {
    const w = ctx.workspace.get();
    const subset = w.tiles.filter(t => arr.diagrams.includes(t.diagramId));
    const arranged = arrange(subset, arr.style, arr.padding ?? 20);
    for (const t of arranged) ctx.workspace.updateTile(t.id, { x: t.x, y: t.y });
  }
  ctx.schedulePersistWorkspace();
  const w = ctx.workspace.get();
  ctx.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
  return { camera: w.camera, tiles: w.tiles };
}

async function installMcpPlugin(args: Record<string, unknown>, ctx: ToolCtx) {
  const host = args.host as "claude-code";
  const confirm = Boolean(args.confirm);
  const { defaultConfigPath, mergeMcpConfig } = await import("./install");
  const configPath = defaultConfigPath(host);
  const binaryPath = process.execPath;
  const snippet = JSON.stringify({ mcpServers: { prixmaviz: { command: binaryPath, args: ["--mcp"] } } }, null, 2);
  if (!confirm) return { configPath, entryAdded: false, snippet, dryRun: true };
  const result = mergeMcpConfig(configPath, binaryPath);
  return { configPath: result.path, entryAdded: result.added, snippet: result.snippet };
}

async function getFocusedTile(_args: Record<string, unknown>, ctx: ToolCtx) {
  const focused = ctx.workspace.getFocused();
  return { tile: focused ?? null };
}

async function checkAppRunning(_args: Record<string, unknown>, ctx: ToolCtx) {
  return await isAppRunning(lockfilePath(ctx.paths.stateDir));
}

async function launchAppTool(_args: Record<string, unknown>, _ctx: ToolCtx) {
  const appPath = process.platform === "darwin"
    ? "/Applications/PrixmaViz.app"
    : process.platform === "linux"
    ? "/usr/local/bin/prixmaviz"
    : "C:\\Program Files\\PrixmaViz\\PrixmaViz.exe";
  const launched = await launchApp(appPath);
  return { launched };
}
