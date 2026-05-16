// Issue #6: HTTP routes for the inline-editor version history feature.
//
// These tests exercise the read-path (GET /source, GET /versions) and the
// failure paths of the write-path (POST /source, restore) — the parts that
// don't need a working Kroki upstream. The full save+render round-trip is
// covered by the renderer's existing integration tests in e2e/.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { snapshotVersion } from "../../src/db/versions";
import { handleApi, type RouteDeps } from "../../src/http/routes";
import { KrokiClient } from "../../src/kroki/client";
import { WsHub } from "../../src/ws/broadcast";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

function makeDeps(): RouteDeps {
  return {
    sql: getDb(TEST_DB_URL),
    kroki: new KrokiClient(),
    hub: new WsHub(),
  };
}

beforeEach(reset);
afterEach(closeDb);

describe("HTTP /api/diagrams/:id/source + /versions", () => {
  it("GET /source returns current DSL for the editor", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "s", name: "S", engine: "mermaid", kind: "passthrough",
      dsl: "flowchart LR\n  A-->B",
    });
    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/${d.id}/source`, {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json();
    expect(body.engine).toBe("mermaid");
    expect(body.kind).toBe("passthrough");
    expect(body.source).toBe("flowchart LR\n  A-->B");
  });

  it("GET /source 404 for unknown diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/d_nope/source`, {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("GET /source 404 across workspaces (no leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: a.id, slug: "secret", name: "S", engine: "mermaid", kind: "passthrough",
      dsl: "flowchart LR; A-->B",
    });
    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/${d.id}/source`, {
      headers: { Authorization: `Bearer ${b.id}` },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });

  it("GET /versions lists snapshots newest-first", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "v", name: "V", engine: "mermaid", kind: "passthrough",
      dsl: "v2",
    });
    // Seed: two versions (simulating two prior edits before "current").
    await snapshotVersion(sql, {
      diagramId: d.id, engine: d.engine, kind: d.kind, source: "v0",
    });
    // small delay so created_at differs deterministically
    await new Promise((r) => setTimeout(r, 5));
    await snapshotVersion(sql, {
      diagramId: d.id, engine: d.engine, kind: d.kind, source: "v1",
    });

    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/${d.id}/versions`, {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json();
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].source).toBe("v1");
    expect(body.versions[1].source).toBe("v0");
  });

  it("GET /versions empty list when no snapshots taken", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "e", name: "E", engine: "mermaid", kind: "passthrough",
      dsl: "x",
    });
    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/${d.id}/versions`, {
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    expect((await resp!.json()).versions).toEqual([]);
  });

  it("POST /source rejects graph-kind diagrams with 400", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "g", name: "G", engine: "mermaid", kind: "graph",
    });
    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/${d.id}/source`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ws.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "anything" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(400);
    expect((await resp!.json()).error).toContain("passthrough");
  });

  it("POST /versions/:vid/restore 404 for foreign version id", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d1 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "d1", name: "D1", engine: "mermaid", kind: "passthrough",
      dsl: "a",
    });
    const d2 = await createDiagram(sql, {
      workspaceId: ws.id, slug: "d2", name: "D2", engine: "mermaid", kind: "passthrough",
      dsl: "b",
    });
    const v = await snapshotVersion(sql, {
      diagramId: d2.id, engine: d2.engine, kind: d2.kind, source: "old",
    });
    // Try to restore d2's version onto d1 — must 404.
    const deps = makeDeps();
    const req = new Request(`http://x/api/diagrams/${d1.id}/versions/${v.id}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404);
  });
});
