/**
 * Group C — annotation writes (Issue #5).
 *
 * MCP tools that mutate the annotations table.
 *
 * All tools in this module:
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
import { addAnnotation as dbAddAnnotation } from "../../db/annotations";
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
];

export const annotationImpls = {
  add_annotation: addAnnotationImpl,
};
