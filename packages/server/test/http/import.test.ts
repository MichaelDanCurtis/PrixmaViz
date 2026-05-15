import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { handleApi } from "../../src/http/routes";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";
import { join } from "node:path";

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

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

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

describe("POST /api/import", () => {
  it("creates a vsdx diagram from valid .vsdx upload", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const body = new FormData();
    body.set("file", new Blob([VSDX_MAGIC, new Uint8Array(100)], { type: "application/vnd.ms-visio.drawing" }), "test.vsdx");
    body.set("name", "Test Visio");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const url = new URL(req.url);
    const res = await handleApi(req, url, { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    const json = await res!.json() as { diagramId: string; slug: string };
    expect(json.diagramId).toMatch(/^d_/);
    expect(json.slug).toBe("test-visio");
  });

  it("rejects upload missing vsdx magic bytes (400)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const body = new FormData();
    body.set("file", new Blob([new Uint8Array([0, 0, 0, 0])]), "fake.vsdx");
    body.set("name", "Fake");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(400);
  });

  it("rejects upload exceeding VSDX_MAX_BYTES (413)", async () => {
    process.env.VSDX_MAX_BYTES = "100";
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const body = new FormData();
    const big = new Uint8Array(200);
    big.set(VSDX_MAGIC, 0);
    body.set("file", new Blob([big]), "big.vsdx");
    body.set("name", "Big");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(413);
    delete process.env.VSDX_MAX_BYTES;
  });
});
