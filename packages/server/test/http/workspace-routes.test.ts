import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { handleApi, type RouteDeps } from "../../src/http/routes";
import { KrokiClient } from "../../src/kroki/client";
import { WsHub } from "../../src/ws/broadcast";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
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

describe("HTTP workspace routes (auth + isolation)", () => {
  it("GET /api/health is pre-auth and returns ok", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/api/health");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json();
    expect(body.ok).toBe(true);
  });

  it("POST /api/workspaces is pre-auth and returns a new workspace id", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json();
    expect(typeof body.id).toBe("string");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rejects /api/diagrams without Authorization header", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/api/diagrams");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(401);
    const body = await resp!.json();
    expect(body.error).toBe("unauthorized");
  });

  it("rejects /api/diagrams with bogus Bearer token", async () => {
    const deps = makeDeps();
    const req = new Request("http://x/api/diagrams", {
      headers: { Authorization: "Bearer 00000000-0000-0000-0000-000000000000" },
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(401);
  });

  it("GET /api/diagrams returns only the authenticated workspace's diagrams", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    await createDiagram(sql, { workspaceId: a.id, slug: "alpha", name: "Alpha", engine: "mermaid", kind: "graph" });
    await createDiagram(sql, { workspaceId: b.id, slug: "beta", name: "Beta", engine: "mermaid", kind: "graph" });

    const deps = makeDeps();
    const req = new Request("http://x/api/diagrams", { headers: { Authorization: `Bearer ${a.id}` } });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp!.json();
    expect(Array.isArray(body.diagrams)).toBe(true);
    expect(body.diagrams.length).toBe(1);
    expect(body.diagrams[0].slug).toBe("alpha");
  });

  it("rejects /api/diagrams with foreign workspace's diagram id (no cross-tenant access)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const da = await createDiagram(sql, {
      workspaceId: a.id, slug: "secret", name: "S", engine: "mermaid", kind: "graph",
    });
    const deps = makeDeps();
    // Try to save a's diagram using b's token
    const req = new Request(`http://x/api/diagrams/${da.id}/save`, {
      method: "POST",
      headers: { Authorization: `Bearer ${b.id}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    // 404 (we say "not found" rather than leaking the existence of someone else's diagram)
    // 401 is also acceptable.
    expect(resp?.status === 404 || resp?.status === 401).toBe(true);
  });

  it("rejects /api/annotations POST with foreign workspace's diagramId (annotation isolation)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const da = await createDiagram(sql, { workspaceId: a.id, slug: "secret", name: "S", engine: "mermaid", kind: "graph" });
    const deps = { sql, kroki: new KrokiClient(), hub: new WsHub() };
    // Workspace B tries to add an annotation to workspace A's diagram
    const req = new Request("http://x/api/annotations", {
      method: "POST",
      headers: { Authorization: `Bearer ${b.id}`, "Content-Type": "application/json" },
      body: JSON.stringify({ diagramId: da.id, kind: "tag", text: "hijack" }),
    });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(404); // diagram not found in workspace B's scope
  });
});
