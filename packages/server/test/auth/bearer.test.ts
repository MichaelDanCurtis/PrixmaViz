import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { authenticate } from "../../src/auth/bearer";
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

describe("authenticate (Bearer)", () => {
  it("returns the workspace id for a valid Bearer token", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const req = new Request("http://x/api/anything", { headers: { Authorization: `Bearer ${ws.id}` } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workspaceId).toBe(ws.id);
  });

  it("returns 401 result when Authorization header missing", async () => {
    const sql = getDb(TEST_DB_URL);
    const req = new Request("http://x/api/anything");
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 result when token doesn't match any workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const req = new Request("http://x/api/anything", { headers: { Authorization: "Bearer 00000000-0000-0000-0000-000000000000" } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when Authorization header is malformed", async () => {
    const sql = getDb(TEST_DB_URL);
    const req = new Request("http://x/api/anything", { headers: { Authorization: "not-bearer-format" } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
  });
});
