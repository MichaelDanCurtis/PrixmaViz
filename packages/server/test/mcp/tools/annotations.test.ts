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
