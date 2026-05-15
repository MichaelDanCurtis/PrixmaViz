import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { handleApi } from "../../src/http/routes";
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

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

describe("GET /api/diagrams/:id/export.vsdx", () => {
  it("returns stored bytes verbatim for vsdx-engine diagrams", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const original = await buildBasicFlowchartFixture();
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "x", name: "X",
      engine: "vsdx", kind: "binary", bytes: original,
    });
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("application/vnd.ms-visio.drawing");
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got.length).toBe(original.length);
    expect(got[0]).toBe(0x50);
    for (let i = 0; i < Math.min(100, original.length); i++) {
      expect(got[i]).toBe(original[i]);
    }
  });

  it("produces a structured vsdx for a Mermaid graph diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "graph",
      ir: {
        layout: { direction: "TB" },
        nodes: { a: { id: "a", label: "A", shape: "rect" } },
        edges: {},
        groups: {},
      },
    });
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got[0]).toBe(0x50);
  });

  it("404 for non-existent diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const req = new Request(`http://x/api/diagrams/nope/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(404);
  });
});
