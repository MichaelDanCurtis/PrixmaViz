import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import {
  createWorkspace,
  getWorkspace,
  updateWorkspaceCamera,
  updateWorkspaceTiles,
  deleteWorkspace,
  deleteExpiredWorkspaces,
} from "../../src/db/workspaces";
import { join } from "node:path";

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

beforeEach(reset);
afterEach(closeDb);

describe("workspaces repo", () => {
  it("createWorkspace returns a new workspace with default camera + empty tiles", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    expect(ws.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ws.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(ws.tiles).toEqual([]);
    expect(ws.name).toBeNull();
  });

  it("getWorkspace returns the workspace or null", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched?.id).toBe(ws.id);
    const missing = await getWorkspace(sql, "00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });

  it("updateWorkspaceCamera persists new camera", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await updateWorkspaceCamera(sql, ws.id, { x: 100, y: 50, zoom: 1.5 });
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched?.camera).toEqual({ x: 100, y: 50, zoom: 1.5 });
  });

  it("updateWorkspaceTiles persists new tile array", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const tiles = [{ id: "t_abc", diagramId: "d_xyz", diagramSlug: "test", x: 0, y: 0, w: 600, h: 400, z: 0 }];
    await updateWorkspaceTiles(sql, ws.id, tiles);
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched?.tiles).toEqual(tiles);
  });

  it("deleteWorkspace cascades", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await deleteWorkspace(sql, ws.id);
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched).toBeNull();
  });

  it("deleteExpiredWorkspaces removes workspaces past TTL", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Backdate last_seen_at to 2 hours ago
    await sql`UPDATE workspaces SET last_seen_at = now() - interval '2 hours' WHERE id = ${ws.id}`;
    const deleted = await deleteExpiredWorkspaces(sql, 60);
    expect(deleted).toContain(ws.id);
    const stillThere = await getWorkspace(sql, ws.id);
    expect(stillThere).toBeNull();
  });

  it("deleteExpiredWorkspaces preserves workspaces containing public diagrams", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Need to import createDiagram + setDiagramPublic from db/diagrams at the top of the test file
    const { createDiagram, setDiagramPublic } = await import("../../src/db/diagrams");
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "shared", name: "S", engine: "mermaid", kind: "graph" });
    await setDiagramPublic(sql, ws.id, d.id, true);
    // Backdate so it would normally expire
    await sql`UPDATE workspaces SET last_seen_at = now() - interval '2 hours' WHERE id = ${ws.id}`;
    const deleted = await deleteExpiredWorkspaces(sql, 60);
    expect(deleted).not.toContain(ws.id);
    // Workspace still queryable
    const stillThere = await getWorkspace(sql, ws.id);
    expect(stillThere?.id).toBe(ws.id);
  });
});
