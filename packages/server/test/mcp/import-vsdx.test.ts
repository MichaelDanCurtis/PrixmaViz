import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { dispatchTool } from "../../src/mcp/tools";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";

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

beforeEach(async () => {
  await reset();
  setVsdxRendererForTests(new VsdxRenderer({
    baseUrl: "http://stub",
    fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
  }));
});
afterEach(() => {
  setVsdxRendererForTests(undefined);
  closeDb();
});

const VSDX_B64 = Buffer.from(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc])).toString("base64");

describe("MCP import_vsdx", () => {
  it("creates a vsdx diagram from base64 input", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const result = await dispatchTool("import_vsdx", {
      name: "Sample",
      base64Source: VSDX_B64,
    }, {
      sql,
      workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { diagramId: string; slug: string };
    expect(result.diagramId).toMatch(/^d_/);
    expect(result.slug).toBe("sample");
  });

  it("rejects base64 that decodes to non-vsdx bytes", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const notVsdx = Buffer.from(new Uint8Array([0, 0, 0, 0])).toString("base64");
    await expect(
      dispatchTool("import_vsdx", { name: "X", base64Source: notVsdx }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/not a valid .vsdx/);
  });
});
