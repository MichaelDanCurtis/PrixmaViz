import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import type { Annotation, ServerToClient } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { getDb, closeDb } from "../../../src/db/client";
import { createWorkspace } from "../../../src/db/workspaces";
import { createDiagram } from "../../../src/db/diagrams";
import { dispatchTool, ValidationError } from "../../../src/mcp/tools";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

interface BroadcastEvent {
  workspaceId: string | null;
  msg: ServerToClient;
}

function makeCtx(sql: ReturnType<typeof getDb>, workspaceId: string) {
  const broadcasts: BroadcastEvent[] = [];
  const ctx = {
    sql,
    workspaceId,
    kroki: { renderSvg: async () => "<svg/>" } as never,
    hub: {
      broadcast(wsId: string | null, msg: ServerToClient) {
        broadcasts.push({ workspaceId: wsId, msg });
      },
    } as never,
  };
  return { ctx, broadcasts };
}

async function makeDiagram(sql: ReturnType<typeof getDb>, workspaceId: string) {
  return createDiagram(sql, {
    workspaceId,
    slug: "g",
    name: "Graph",
    engine: "mermaid",
    kind: "passthrough",
    dsl: "graph TD\n  A --> B",
  });
}

describe("MCP add_annotation", () => {
  it("creates an annotation that appears in get_annotations", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "this needs attention" },
      ctx,
    )) as { annotationId: string; createdAt: string };

    expect(add.annotationId).toMatch(/^ann_/);
    expect(add.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations.length).toBe(1);
    expect(list.annotations[0]!.id).toBe(add.annotationId);
    expect(list.annotations[0]!.text).toBe("this needs attention");
    expect(list.annotations[0]!.author).toBe("agent");
  });

  it("accepts a diagram-wide annotation when neither targetNodes nor bboxData is given", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const r = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "global note", author: "alice" },
      ctx,
    )) as { annotationId: string };
    expect(r.annotationId).toMatch(/^ann_/);

    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.targetNodes).toBeUndefined();
    expect(list.annotations[0]!.bboxData).toBeUndefined();
    expect(list.annotations[0]!.author).toBe("alice");
  });

  it("accepts targetNodes when bboxData is absent", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "on node A", targetNodes: ["A"] },
      ctx,
    );
    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.targetNodes).toEqual(["A"]);
    expect(list.annotations[0]!.kind).toBe("tag");
  });

  it("accepts bboxData when targetNodes is absent", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "in this region", bboxData: { x: 10, y: 20, w: 30, h: 40 } },
      ctx,
    );
    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.bboxData).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(list.annotations[0]!.kind).toBe("region");
  });

  it("rejects both targetNodes and bboxData together with a ValidationError", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await expect(
      dispatchTool(
        "add_annotation",
        {
          diagramId: d.id,
          body: "bad",
          targetNodes: ["A"],
          bboxData: { x: 0, y: 0, w: 1, h: 1 },
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("broadcasts annotation:created on the workspace channel", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "watch this" },
      ctx,
    );
    const created = broadcasts.find((b) => b.msg.type === "annotation:created");
    expect(created).toBeDefined();
    expect(created!.workspaceId).toBe(ws.id);
    expect((created!.msg as { diagramId: string }).diagramId).toBe(d.id);
  });

  it("rejects when the diagram doesn't belong to the caller's workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await makeDiagram(sql, wsA.id);
    // Caller is in wsB, diagram is in wsA.
    const { ctx } = makeCtx(sql, wsB.id);

    await expect(
      dispatchTool("add_annotation", { diagramId: dA.id, body: "x" }, ctx),
    ).rejects.toThrow(/not found/);
  });
});

describe("MCP update_annotation", () => {
  it("updates the body and the new text is visible via get_annotations", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "original" },
      ctx,
    )) as { annotationId: string };

    const upd = (await dispatchTool(
      "update_annotation",
      { annotationId: add.annotationId, body: "edited" },
      ctx,
    )) as { ok: boolean; annotationId: string; updatedAt: string };
    expect(upd.ok).toBe(true);

    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.text).toBe("edited");
  });

  it("returns annotation_resolved without force on a resolved annotation", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "starts open" },
      ctx,
    )) as { annotationId: string };
    await dispatchTool("resolve_annotation", { annotationId: add.annotationId }, ctx);

    const upd = (await dispatchTool(
      "update_annotation",
      { annotationId: add.annotationId, body: "tried to edit" },
      ctx,
    )) as { ok: boolean; code?: string; message?: string };
    expect(upd.ok).toBe(false);
    expect(upd.code).toBe("annotation_resolved");
    expect(upd.message).toMatch(/force: true/);

    // The body should NOT have been updated.
    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id, includeResolved: true },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.text).toBe("starts open");
  });

  it("updates a resolved annotation when force: true is supplied", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "starts open" },
      ctx,
    )) as { annotationId: string };
    await dispatchTool("resolve_annotation", { annotationId: add.annotationId }, ctx);

    const upd = (await dispatchTool(
      "update_annotation",
      { annotationId: add.annotationId, body: "after force", force: true },
      ctx,
    )) as { ok: boolean };
    expect(upd.ok).toBe(true);

    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id, includeResolved: true },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.text).toBe("after force");
  });

  it("returns annotation_not_found for a missing id", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const r = (await dispatchTool(
      "update_annotation",
      { annotationId: "ann_NONEXISTENT", body: "x" },
      ctx,
    )) as { ok: boolean; code?: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("annotation_not_found");
  });

  it("returns annotation_not_found when the annotation lives in another workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await makeDiagram(sql, wsA.id);
    const { ctx: ctxA } = makeCtx(sql, wsA.id);
    const { ctx: ctxB } = makeCtx(sql, wsB.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: dA.id, body: "in A" },
      ctxA,
    )) as { annotationId: string };

    const r = (await dispatchTool(
      "update_annotation",
      { annotationId: add.annotationId, body: "from B" },
      ctxB,
    )) as { ok: boolean; code?: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("annotation_not_found");
  });
});

describe("MCP resolve_annotation", () => {
  it("sets resolvedAt and excludes the annotation from get_annotations by default", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "open" },
      ctx,
    )) as { annotationId: string };

    const res = (await dispatchTool(
      "resolve_annotation",
      { annotationId: add.annotationId },
      ctx,
    )) as { ok: boolean; resolvedAt: string };
    expect(res.ok).toBe(true);
    expect(res.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Excluded from default get_annotations
    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations.length).toBe(0);
  });

  it("includes the annotation with includeResolved:true and exposes the resolution text", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "open" },
      ctx,
    )) as { annotationId: string };
    await dispatchTool(
      "resolve_annotation",
      { annotationId: add.annotationId, resolution: "fixed in commit abc123" },
      ctx,
    );

    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id, includeResolved: true },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations.length).toBe(1);
    expect(list.annotations[0]!.resolution).toBe("fixed in commit abc123");
    expect(list.annotations[0]!.resolvedAt).toBeTruthy();
  });

  it("is idempotent — resolving twice just refreshes timestamp / resolution text", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await makeDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const add = (await dispatchTool(
      "add_annotation",
      { diagramId: d.id, body: "x" },
      ctx,
    )) as { annotationId: string };

    const r1 = (await dispatchTool(
      "resolve_annotation",
      { annotationId: add.annotationId, resolution: "first" },
      ctx,
    )) as { ok: boolean; resolvedAt: string };

    // Small delay so the second resolvedAt differs deterministically.
    await new Promise((r) => setTimeout(r, 5));

    const r2 = (await dispatchTool(
      "resolve_annotation",
      { annotationId: add.annotationId, resolution: "second" },
      ctx,
    )) as { ok: boolean; resolvedAt: string };

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Resolution text should be the latest value.
    const list = (await dispatchTool(
      "get_annotations",
      { diagramId: d.id, includeResolved: true },
      ctx,
    )) as { annotations: Annotation[] };
    expect(list.annotations[0]!.resolution).toBe("second");
  });

  it("returns annotation_not_found when given a missing id", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);

    const r = (await dispatchTool(
      "resolve_annotation",
      { annotationId: "ann_MISSING" },
      ctx,
    )) as { ok: boolean; code?: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("annotation_not_found");
  });
});
