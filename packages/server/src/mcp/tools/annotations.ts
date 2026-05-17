/**
 * Group C — annotation writes (Issue #5).
 *
 * Three MCP tools that mutate the annotations table:
 *   - `add_annotation`     : create a new annotation (diagram-wide, node-scoped, or region-scoped)
 *   - `update_annotation`  : patch an annotation body (refuses resolved unless force:true)
 *   - `resolve_annotation` : mark resolved + optional resolution text (idempotent)
 *
 * All three:
 *   - Authorize via the parent diagram's workspace_id against ctx.workspaceId
 *     (re-using the same trust boundary that get_annotations enforces).
 *   - Broadcast over WS so the web client picks up the change live, using the
 *     established `annotation:created` / `annotation:updated` event shapes
 *     from the HTTP routes layer (see http/routes.ts).
 *
 * The DB primitives in `db/annotations.ts` do the actual SQL. We don't
 * touch tables here directly.
 */

import type { Annotation, BBox, ServerToClient } from "@prixmaviz/shared";
import { newAnnotationId } from "@prixmaviz/shared";
import {
  addAnnotation as dbAddAnnotation,
  getAnnotationWithWorkspace as dbGetAnnotationWithWorkspace,
  updateAnnotation as dbUpdateAnnotation,
} from "../../db/annotations";
import { getDiagram as dbGetDiagram } from "../../db/diagrams";
import type { ToolCtx, ToolDef } from "../tools";
import { ValidationError } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function isBBox(v: unknown): v is BBox {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number"
  );
}

function broadcastAnnotation(
  ctx: ToolCtx,
  diagramId: string,
  kind: "created" | "updated",
  annotation: Annotation,
): void {
  const type =
    kind === "created" ? "annotation:created" : "annotation:updated";
  const msg: ServerToClient = {
    type,
    diagramId,
    annotation,
  };
  ctx.hub.broadcast(ctx.workspaceId, msg);
}

// ───────────────────────────────────────────────────────────────────────────
// Tool implementations
// ───────────────────────────────────────────────────────────────────────────

async function addAnnotationImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const body = args.body as string;
  const author = (args.author as string | undefined) ?? "agent";
  const targetNodesRaw = args.targetNodes as unknown;
  const bboxDataRaw = args.bboxData as unknown;

  // Mutual exclusivity is the validator's normal job, but the dispatcher's
  // validator is currently shallow; until Wave-1 Agent-1 lands the
  // `mutuallyExclusive` validator extension, enforce here so callers get
  // a structured ValidationError rather than silently dropping one side.
  const hasNodes = targetNodesRaw !== undefined && targetNodesRaw !== null;
  const hasBbox = bboxDataRaw !== undefined && bboxDataRaw !== null;
  if (hasNodes && hasBbox) {
    throw new ValidationError(
      "invalid_parameter_value",
      "targetNodes and bboxData are mutually exclusive (pick one or omit both for a diagram-wide annotation).",
      "targetNodes",
      ["targetNodes", "bboxData"],
    );
  }

  // Light shape validation for the structured parameters — the top-level
  // dispatcher validator only checks scalar types/enums.
  if (hasNodes) {
    if (!Array.isArray(targetNodesRaw) || targetNodesRaw.some((n) => typeof n !== "string")) {
      throw new ValidationError(
        "invalid_parameter_type",
        "targetNodes must be an array of strings.",
        "targetNodes",
        "string[]",
      );
    }
  }
  if (hasBbox && !isBBox(bboxDataRaw)) {
    throw new ValidationError(
      "invalid_parameter_type",
      "bboxData must be an object with numeric x, y, w, h.",
      "bboxData",
      "{ x: number, y: number, w: number, h: number }",
    );
  }

  // Authorize: diagram must belong to caller's workspace.
  const d = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!d) throw new Error("diagram not found");

  // Pick the closest existing annotation kind. The shared Annotation type
  // distinguishes "tag" (node-scoped) and "region" (bbox-scoped); a
  // diagram-wide annotation has no targets but is still a "tag" in storage
  // — that's the same shape used by the HTTP route's diagram-wide path.
  const kind: Annotation["kind"] = hasBbox ? "region" : "tag";

  const ann: Annotation = {
    id: newAnnotationId(),
    kind,
    text: body,
    author,
    createdAt: new Date().toISOString(),
    targetNodes: hasNodes ? (targetNodesRaw as string[]) : undefined,
    bboxData: hasBbox ? bboxDataRaw : undefined,
  };

  const saved = await dbAddAnnotation(ctx.sql, diagramId, ann);
  broadcastAnnotation(ctx, diagramId, "created", saved);

  return {
    annotationId: saved.id,
    createdAt: saved.createdAt,
  };
}

async function updateAnnotationImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const annotationId = args.annotationId as string;
  const body = args.body as string;
  const force = Boolean(args.force);

  const lookup = await dbGetAnnotationWithWorkspace(ctx.sql, annotationId);
  if (!lookup || lookup.workspaceId !== ctx.workspaceId) {
    // 404-style — either the annotation doesn't exist or it lives in a
    // different workspace. Don't leak which.
    return { ok: false, code: "annotation_not_found", message: "annotation not found" };
  }

  if (lookup.annotation.resolvedAt && !force) {
    return {
      ok: false,
      code: "annotation_resolved",
      message: "annotation is resolved; pass force: true to update",
    };
  }

  const updated = await dbUpdateAnnotation(
    ctx.sql,
    lookup.diagramId,
    annotationId,
    { text: body },
  );
  if (!updated) {
    // Should be unreachable — we already looked it up — but guard anyway.
    return { ok: false, code: "annotation_not_found", message: "annotation not found" };
  }

  broadcastAnnotation(ctx, lookup.diagramId, "updated", updated);

  return {
    ok: true,
    annotationId: updated.id,
    updatedAt: new Date().toISOString(),
  };
}

async function resolveAnnotationImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const annotationId = args.annotationId as string;
  const resolution = args.resolution as string | undefined;

  const lookup = await dbGetAnnotationWithWorkspace(ctx.sql, annotationId);
  if (!lookup || lookup.workspaceId !== ctx.workspaceId) {
    return { ok: false, code: "annotation_not_found", message: "annotation not found" };
  }

  // Idempotent: if already resolved, just refresh the timestamp + resolution
  // text. The spec calls this out explicitly — agents shouldn't have to
  // care whether resolution already happened.
  const resolvedAt = new Date().toISOString();
  const patch: Partial<Annotation> = { resolvedAt };
  if (resolution !== undefined) patch.resolution = resolution;

  const updated = await dbUpdateAnnotation(
    ctx.sql,
    lookup.diagramId,
    annotationId,
    patch,
  );
  if (!updated) {
    return { ok: false, code: "annotation_not_found", message: "annotation not found" };
  }

  broadcastAnnotation(ctx, lookup.diagramId, "updated", updated);

  return {
    ok: true,
    annotationId: updated.id,
    resolvedAt: updated.resolvedAt ?? resolvedAt,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const annotationTools: ToolDef[] = [
  {
    name: "add_annotation",
    description:
      "Create a new annotation on a diagram. Provide one of `targetNodes` (node-scoped) or `bboxData` (region-scoped); omit both for a diagram-wide annotation. `targetNodes` and `bboxData` are mutually exclusive.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        body: { type: "string" },
        author: { type: "string" },
        targetNodes: { type: "array", items: { type: "string" } },
        bboxData: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
        },
      },
      required: ["diagramId", "body"],
    },
    run: addAnnotationImpl,
  },
  {
    name: "update_annotation",
    description:
      "Update an annotation's body text. If the annotation is already resolved, returns `{ ok: false, code: 'annotation_resolved' }` unless `force: true` is supplied.",
    inputSchema: {
      type: "object",
      properties: {
        annotationId: { type: "string" },
        body: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["annotationId", "body"],
    },
    run: updateAnnotationImpl,
  },
  {
    name: "resolve_annotation",
    description:
      "Mark an annotation resolved with an optional resolution note. Idempotent — resolving an already-resolved annotation just refreshes the timestamp and resolution text. Resolved annotations are excluded from `get_annotations` unless `includeResolved: true` is passed.",
    inputSchema: {
      type: "object",
      properties: {
        annotationId: { type: "string" },
        resolution: { type: "string" },
      },
      required: ["annotationId"],
    },
    run: resolveAnnotationImpl,
  },
];

export const annotationImpls = {
  add_annotation: addAnnotationImpl,
  update_annotation: updateAnnotationImpl,
  resolve_annotation: resolveAnnotationImpl,
};
