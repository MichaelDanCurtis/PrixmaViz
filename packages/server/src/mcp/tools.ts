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

export interface ToolCtx {
  paths: PrixmaPaths;
  store: DiagramStore;
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
