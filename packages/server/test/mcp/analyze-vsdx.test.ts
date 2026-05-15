import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { dispatchTool } from "../../src/mcp/tools";
import { buildBasicFlowchartFixture } from "../fixtures/vsdx/build-fixture";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

describe("MCP analyze_vsdx", () => {
  it("returns structured pages from a stored vsdx diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const bytes = await buildBasicFlowchartFixture();
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "x", name: "X",
      engine: "vsdx", kind: "binary",
      bytes,
    });
    const result = await dispatchTool("analyze_vsdx", { diagramId: d.id }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { pages: Array<{ shapes: unknown[] }> };
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages[0]!.shapes.length).toBeGreaterThan(0);
  });

  it("throws if diagram not found", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("analyze_vsdx", { diagramId: "nonexistent" }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/diagram not found/);
  });

  it("throws if diagram is not a vsdx engine", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "graph",
    });
    await expect(
      dispatchTool("analyze_vsdx", { diagramId: d.id }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/not a vsdx/);
  });
});
