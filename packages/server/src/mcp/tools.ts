import {
  ALL_ENGINES, emptyGraphIR, emptyMeta, inferKind,
  type Camera, type Diagram, type DiagramEngine, type GraphIR,
  type PatchOp, type ServerToClient, type Tile,
} from "@prixmaviz/shared";
import type postgres from "postgres";
import { applyPatch } from "../ir/engine";
import { arrange } from "../canvas/arrange";
import type { KrokiClient, KrokiFormat } from "../kroki/client";
import { renderDiagram } from "../render";
import { getIrRenderer } from "../renderers/registry";
import { parseVsdx } from "../renderers/vsdx-parse";
import { canStructuredVsdx, maybeExtractLayout } from "../vsdx/export-helpers";
import type { WsHub } from "../ws/broadcast";
import { broadcastWorkspaceUpdate } from "./broadcast";
import {
  createDiagram as dbCreateDiagram,
  createDiagramWithUniqueSlug as dbCreateDiagramWithUniqueSlug,
  getDiagram as dbGetDiagram,
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
import { crudTools, loadDiagramTool } from "./tools/crud";
import { annotationTools } from "./tools/annotations";
import { workspaceTools } from "./tools/workspaces";
import { bulkTools } from "./tools/bulk";
import { searchTools } from "./tools/search";
import { canvasTools } from "./tools/canvas";
import { libraryTools } from "./tools/library";

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
  /**
   * Optional legacy parameter aliases honored by the impl. Map from
   * legacy-name → canonical-name. These keys are accepted by the validator
   * as substitutes for the canonical required field (e.g. `name` is an
   * accepted alias for `slug` on `load_diagram`).
   *
   * Aliases are also added to the "known properties" set so callers using
   * the legacy form aren't rejected as supplying an unknown parameter.
   */
  legacyAliases?: Record<string, string>;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

/**
 * Extension of `inputSchema` that lets a tool declare a structural
 * "exactly one of these fields" requirement. The validator reads either
 * `inputSchema.oneOf` (array of field names — exactly one must be
 * present) or the JSON-Schema-style `oneOf: [{ required: ["a"] }, ...]`
 * which is also honored. Both forms support the same semantics: zero
 * matches → `missing_required_parameter`; two or more → `mutually_exclusive`.
 *
 * The validator also reads `inputSchema.mutuallyExclusive` — an array of
 * `[fieldA, fieldB]` pairs (or longer tuples) where supplying any two
 * fields from the same group simultaneously is rejected.
 *
 * Existing tools don't declare either field, so behavior on the current
 * surface is unchanged. New tools (`delete_diagram`, `duplicate_diagram`,
 * `get_diagram`, `focus_tile`, `add_annotation`, ...) opt in.
 */

// ───────────────────────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Structured error thrown by `validateArgs` when an MCP tool call is rejected
 * before dispatch. The HTTP layer translates this into a 400 with a stable
 * `{ error: { code, message, parameter?, expected? } }` envelope.
 */
export class ValidationError extends Error {
  public readonly code: ValidationErrorCode;
  public readonly parameter?: string;
  public readonly expected?: unknown;

  constructor(
    code: ValidationErrorCode,
    message: string,
    parameter?: string,
    expected?: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.parameter = parameter;
    this.expected = expected;
  }
}

export type ValidationErrorCode =
  | "missing_required_parameter"
  | "unknown_parameter"
  | "invalid_parameter_type"
  | "invalid_parameter_value"
  | "mutually_exclusive_parameters";

/**
 * Thrown when `dispatchTool` is called with a tool name not present in TOOLS.
 * The HTTP layer maps this to a 404 with `code: "unknown_tool"`.
 */
export class UnknownToolError extends Error {
  public readonly toolName: string;
  constructor(toolName: string) {
    super(`unknown tool: ${toolName}`);
    this.name = "UnknownToolError";
    this.toolName = toolName;
  }
}

interface ParsedSchema {
  properties: Record<string, { type?: string; enum?: unknown[] }>;
  required: string[];
  /**
   * Normalized `oneOf` group — flat array of field names where exactly
   * one must be present. Empty when the schema declares no oneOf.
   *
   * Accepts both the shorthand `oneOf: ["a", "b"]` AND the JSON-Schema
   * form `oneOf: [{ required: ["a"] }, { required: ["b"] }]`. Both
   * normalize to the same shape so the validator can treat them uniformly.
   */
  oneOf: string[];
  /**
   * Each inner array is one mutually-exclusive group; supplying ≥2 fields
   * from the same group is rejected. Empty when the schema declares no
   * mutuallyExclusive.
   */
  mutuallyExclusive: string[][];
}

function parseSchema(schema: Record<string, unknown>): ParsedSchema {
  const props = (schema.properties as Record<string, { type?: string; enum?: unknown[] }> | undefined) ?? {};
  const required = (schema.required as string[] | undefined) ?? [];

  // Normalize `oneOf`.
  const rawOneOf = schema.oneOf;
  let oneOf: string[] = [];
  if (Array.isArray(rawOneOf)) {
    if (rawOneOf.every((x) => typeof x === "string")) {
      // Shorthand: oneOf: ["a", "b"].
      oneOf = rawOneOf as string[];
    } else {
      // JSON-Schema form: oneOf: [{ required: ["a"] }, { required: ["b"] }].
      const collected: string[] = [];
      for (const branch of rawOneOf as unknown[]) {
        if (branch && typeof branch === "object") {
          const r = (branch as { required?: unknown }).required;
          if (Array.isArray(r)) {
            for (const name of r) {
              if (typeof name === "string" && !collected.includes(name)) {
                collected.push(name);
              }
            }
          }
        }
      }
      oneOf = collected;
    }
  }

  // Normalize `mutuallyExclusive`.
  const rawMx = schema.mutuallyExclusive;
  const mutuallyExclusive: string[][] = [];
  if (Array.isArray(rawMx)) {
    for (const group of rawMx) {
      if (
        Array.isArray(group) &&
        group.length >= 2 &&
        group.every((x) => typeof x === "string")
      ) {
        mutuallyExclusive.push(group as string[]);
      }
    }
  }

  return { properties: props, required, oneOf, mutuallyExclusive };
}

function jsTypeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function expectedTypeMatches(spec: { type?: string }, value: unknown): boolean {
  const expected = spec.type;
  if (!expected) return true; // no type constraint
  const actual = jsTypeOf(value);
  if (expected === "number" || expected === "integer") return actual === "number";
  if (expected === "object") return actual === "object";
  return actual === expected;
}

/**
 * Validate an MCP tool's args against the tool's `inputSchema`. Throws
 * `ValidationError` on the first problem. Checks performed:
 *
 *   1. required fields present (alias-aware: a documented `legacyAliases`
 *      entry mapping `legacy → canonical` satisfies the canonical's
 *      required check when only the legacy name is supplied)
 *   2. no unknown top-level keys (catches `format` for `engine`, etc.)
 *   3. provided values match the declared `type`
 *   4. provided values are members of any declared `enum`
 *   5. exactly one of `inputSchema.oneOf` (if declared) is supplied
 *   6. no two fields from any `inputSchema.mutuallyExclusive` group are
 *      supplied together
 *
 * Deliberately shallow — nested objects/arrays are accepted as long as the
 * top-level shape is right. Tool impls remain responsible for deeper
 * validation of their own structured args (e.g. patch ops).
 */
export function validateArgs(tool: ToolDef, args: Record<string, unknown>): void {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new ValidationError(
      "invalid_parameter_type",
      `Arguments must be a JSON object, got ${jsTypeOf(args)}.`,
    );
  }

  const { properties, required, oneOf, mutuallyExclusive } = parseSchema(tool.inputSchema);
  const aliases = tool.legacyAliases ?? {};
  const known = new Set([...Object.keys(properties), ...Object.keys(aliases)]);
  const suppliedKeys = Object.keys(args);
  const unknownSupplied = suppliedKeys.filter((k) => !known.has(k));

  /** `true` when `key` is supplied (or any of its legacy aliases is). */
  const isPresent = (key: string): boolean => {
    if (args[key] !== undefined && args[key] !== null) return true;
    for (const [legacy, canonical] of Object.entries(aliases)) {
      if (canonical === key && args[legacy] !== undefined && args[legacy] !== null) {
        return true;
      }
    }
    return false;
  };

  // 1. Required-field check (alias-aware).
  for (const key of required) {
    const hasCanonical = args[key] !== undefined && args[key] !== null;
    if (hasCanonical) continue;
    // Accept any documented alias that resolves to this canonical name.
    const aliasMatch = Object.entries(aliases).find(([, canonical]) => canonical === key);
    if (aliasMatch) {
      const [legacy] = aliasMatch;
      if (args[legacy] !== undefined && args[legacy] !== null) continue;
    }
    // If the caller supplied keys that aren't recognized at all (e.g.
    // `format` instead of `engine`), name them in the message — that's
    // the most common failure pattern from issue #14.
    const got = suppliedKeys.length > 0 ? ` Got: ${suppliedKeys.join(", ")}.` : "";
    const hint = unknownSupplied.length > 0
      ? ` Unknown keys supplied: ${unknownSupplied.join(", ")}.`
      : "";
    throw new ValidationError(
      "missing_required_parameter",
      `Missing required parameter: ${key}.${got}${hint}`,
      key,
    );
  }

  // 2. Unknown-field check.
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      const expectedList = [...known].sort();
      throw new ValidationError(
        "unknown_parameter",
        `Unknown parameter: ${key}. Expected one of: ${expectedList.join(", ")}.`,
        key,
        expectedList,
      );
    }
  }

  // 3+4. Type / enum checks on present values (skip aliases — the impl
  // resolves the alias to the canonical value before use, and the legacy
  // shape historically wasn't type-checked).
  for (const [key, spec] of Object.entries(properties)) {
    const v = args[key];
    if (v === undefined || v === null) continue;
    if (!expectedTypeMatches(spec, v)) {
      throw new ValidationError(
        "invalid_parameter_type",
        `Invalid type for parameter ${key}: expected ${spec.type}, got ${jsTypeOf(v)}.`,
        key,
        spec.type,
      );
    }
    if (spec.enum && Array.isArray(spec.enum) && !spec.enum.includes(v)) {
      throw new ValidationError(
        "invalid_parameter_value",
        `Invalid value for ${key}: ${JSON.stringify(v)}. Expected one of: ${spec.enum.map((e) => JSON.stringify(e)).join(", ")}.`,
        key,
        spec.enum,
      );
    }
  }

  // 5. oneOf — exactly one of the named fields must be present. Aliases
  // count toward the canonical field they map to.
  if (oneOf.length > 0) {
    const present = oneOf.filter(isPresent);
    if (present.length === 0) {
      throw new ValidationError(
        "missing_required_parameter",
        `Exactly one of [${oneOf.join(", ")}] is required, but none were supplied.`,
        undefined,
        oneOf,
      );
    }
    if (present.length > 1) {
      throw new ValidationError(
        "mutually_exclusive_parameters",
        `Exactly one of [${oneOf.join(", ")}] is allowed, but multiple were supplied: ${present.join(", ")}.`,
        present[0],
        oneOf,
      );
    }
  }

  // 6. mutuallyExclusive — no two fields from the same group at once.
  for (const group of mutuallyExclusive) {
    const present = group.filter(isPresent);
    if (present.length >= 2) {
      throw new ValidationError(
        "mutually_exclusive_parameters",
        `Parameters [${present.join(", ")}] cannot be supplied together (any two of [${group.join(", ")}] are mutually exclusive).`,
        present[0],
        group,
      );
    }
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: "create_diagram",
    description: "Create a new diagram in the workspace and render it. `engine` is one of: actdiag, blockdiag, bpmn, bytefield, c4plantuml, d2, dbml, diagramsnet, ditaa, erd, excalidraw, graphviz, mermaid, nomnoml, nwdiag, packetdiag, pikchr, plantuml, rackdiag, seqdiag, structurizr, svgbob, symbolator, tikz, umlet, vega, vegalite, vsdx, wavedrom, wireviz. `kind` is `graph` (uses IR + apply_patch) or `passthrough` (uses initialDsl + render_dsl).",
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
  // load_diagram — defined in tools/crud.ts so the A3-folded extension
  // (accept diagramId; gain includeSvg) lives next to the new CRUD ops.
  loadDiagramTool,
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
    description: "Render arbitrary diagram DSL via the chosen engine. Pass `engine` (e.g. mermaid, plantuml, d2, graphviz, vegalite, wavedrom, bytefield, structurizr, ditaa, pikchr, svgbob, tikz) and `dsl` (the textual diagram source). Optionally `name` to persist as a saved diagram.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string", enum: ALL_ENGINES },
        dsl: { type: "string" },
        name: { type: "string" },
      },
      required: ["engine", "dsl"],
    },
    legacyAliases: { source: "dsl" },
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
  {
    name: "analyze_vsdx",
    description: "Parse a previously-imported vsdx diagram into structured JSON (shapes, connectors, labels, layout). Use this as the input to your own translation step if the user asks to convert a Visio diagram to Mermaid/D2/BPMN.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
      },
      required: ["diagramId"],
    },
    run: analyzeVsdxImpl,
  },
  {
    name: "export_vsdx",
    description: "Export a diagram as a Microsoft Visio (.vsdx) file. Returns base64-encoded bytes. For graph diagrams (Mermaid/D2/Graphviz), produces a Visio-editable file with real shapes. For other engines, produces an image-embed vsdx. ALWAYS call this after building a graph diagram when the user asks for Visio/vsdx output — then save the bytes to a local .vsdx file path the user can open.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
      },
      required: ["diagramId"],
    },
    run: exportVsdxImpl,
  },
  {
    name: "export_diagram",
    description: "Export an existing diagram as SVG/PNG/JPEG bytes (base64-encoded). Use this when an AI agent needs to save a rendered diagram to disk — e.g. embedding in markdown specs or committing alongside docs. For .vsdx output, use export_vsdx instead.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        format: { type: "string", enum: ["svg", "png", "jpeg"] },
      },
      required: ["diagramId", "format"],
    },
    run: exportDiagramImpl,
  },
  // ─── Group A — CRUD (delete + duplicate). load_diagram (A3-folded) is
  // inserted above where the legacy load_diagram entry used to live so the
  // tool ordering matches the prior surface. ───
  ...crudTools,
  // Group B — discoverability: search + DSL validation (Issue #5).
  ...searchTools,
  // Group C — annotation writes (Issue #5).
  ...annotationTools,
  // Group D — canvas state introspection + manipulation (Issue #5).
  ...canvasTools,
  // Group E — workspace lifecycle (Issue #5).
  ...workspaceTools,
  // Group F — bulk operations (Issue #5).
  ...bulkTools,
  // Issue #7 Wave 1B — library / organization (pin / move / meta).
  ...libraryTools,
];

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new UnknownToolError(name);
  validateArgs(tool, args);
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
  await broadcastWorkspaceUpdate(ctx, ctx.workspaceId);
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

// loadDiagramImpl moved to tools/crud.ts as part of the A3-folded
// extension (accept diagramId; gain includeSvg). The registry entry
// imports `loadDiagramTool` from that module.

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
  // Accept either `dsl` (new, matches description) or `source` (legacy alias).
  // The `source` alias will be removed after v0.7.x.
  const dsl = (args.dsl ?? args.source) as string | undefined;
  if (!dsl) throw new Error("Missing required parameter: dsl");
  const name = (args.name as string | undefined) ?? "untitled";
  const slug = slugify(name);
  const row = await dbCreateDiagram(ctx.sql, {
    workspaceId: ctx.workspaceId,
    slug,
    name,
    engine,
    kind: "passthrough",
    dsl,
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
  await broadcastWorkspaceUpdate(ctx, ctx.workspaceId);
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
  const base64Source = args.base64Source as string;
  if (!base64Source) throw new Error("base64Source is required");
  const bytes = new Uint8Array(Buffer.from(base64Source, "base64"));
  if (bytes.length < 4 || !VSDX_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("not a valid .vsdx file (missing ZIP magic)");
  }
  const maxBytes = Number(process.env.VSDX_MAX_BYTES ?? "5242880");
  if (bytes.length > maxBytes) {
    throw new Error(`file exceeds VSDX_MAX_BYTES (${maxBytes})`);
  }
  let name = (args.name as string | undefined) ?? "";
  if (!name) {
    name = `imported-${Math.random().toString(36).slice(2, 8)}`;
  }
  const slug = slugify(name);

  const row = await dbCreateDiagramWithUniqueSlug(ctx.sql, {
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

async function analyzeVsdxImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!row) throw new Error("diagram not found");
  if (row.engine !== "vsdx" || row.kind !== "binary" || !row.bytes) {
    throw new Error("diagram is not a vsdx import");
  }
  const doc = await parseVsdx(row.bytes);
  return doc;
}

async function exportVsdxImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  if (!diagramId) throw new Error("diagramId is required");
  const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!row) throw new Error("diagram not found");

  let bytes: Uint8Array;
  let strategy: "verbatim" | "structured" | "image-embed";
  if (row.engine === "vsdx" && row.kind === "binary" && row.bytes) {
    bytes = row.bytes;
    strategy = "verbatim";
  } else if (row.kind === "graph" && row.ir && canStructuredVsdx(row.engine)) {
    const { writeVsdxFromIr } = await import("../renderers/vsdx-writer");
    const ir = await maybeExtractLayout(row.engine, row.ir, row.dsl);
    const result = await writeVsdxFromIr(ir);
    bytes = result.bytes;
    if (result.warnings.length) {
      console.warn("[vsdx-export-mcp]", diagramId, result.warnings);
    }
    strategy = "structured";
  } else {
    if (!row.svg) throw new Error("no rendered SVG to embed");
    const { writeVsdxFromSvg } = await import("../renderers/vsdx-writer-fallback");
    bytes = await writeVsdxFromSvg(row.svg);
    strategy = "image-embed";
  }

  return {
    base64Source: Buffer.from(bytes).toString("base64"),
    byteCount: bytes.length,
    suggestedFilename: `${row.slug}.vsdx`,
    strategy,
  };
}

const EXPORT_MIME_TYPES: Record<KrokiFormat, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
};

async function exportDiagramImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  if (!diagramId) throw new Error("diagramId is required");
  const format = args.format as KrokiFormat;
  if (format !== "svg" && format !== "png" && format !== "jpeg") {
    throw new Error(`unsupported format: ${format}`);
  }
  const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!row) throw new Error("diagram not found");

  let bytes: Uint8Array;
  if (row.engine === "vsdx" && row.kind === "binary") {
    // vsdx is not a Kroki engine. We can still hand back the rendered SVG
    // when one is on file (rendered via the native vsdx pipeline at import
    // time), but PNG/JPEG would require a separate raster pipeline we don't
    // ship yet — direct the caller to export_vsdx for binary formats.
    if (format !== "svg") {
      throw new Error("vsdx-engine diagrams only support svg via this tool (use export_vsdx for binary)");
    }
    if (!row.svg) throw new Error("vsdx diagram has no rendered svg");
    bytes = new TextEncoder().encode(row.svg);
  } else if (row.kind === "graph") {
    if (!row.ir) throw new Error("graph diagram missing ir");
    const renderer = getIrRenderer(row.engine);
    if (!renderer) throw new Error(`no IR renderer for engine "${row.engine}"`);
    const out = renderer(row.ir);
    bytes = await ctx.kroki.renderBinary(row.engine, out.dsl, format);
  } else if (row.kind === "passthrough") {
    if (row.dsl === undefined || row.dsl === null) {
      throw new Error("passthrough diagram missing dsl");
    }
    bytes = await ctx.kroki.renderBinary(row.engine, row.dsl, format);
  } else {
    throw new Error(`cannot export diagram of kind "${row.kind}"`);
  }

  // Map "jpeg" -> ".jpg" for the suggested filename so callers writing to
  // disk get the conventional extension. Mirrors `getExportFilename` on the
  // web side.
  const ext = format === "jpeg" ? "jpg" : format;
  return {
    diagramId: row.id,
    format,
    mimeType: EXPORT_MIME_TYPES[format],
    base64: Buffer.from(bytes).toString("base64"),
    byteCount: bytes.length,
    suggestedFilename: `${row.slug}.${ext}`,
  };
}
