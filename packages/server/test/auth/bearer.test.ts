import { describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { authenticate } from "../../src/auth/bearer";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

describe("authenticate (Bearer)", () => {
  it("returns the workspace id for a valid Bearer token", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const req = new Request("http://x/api/anything", { headers: { Authorization: `Bearer ${ws.id}` } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workspaceId).toBe(ws.id);
  });

  it("returns 401 result when Authorization header missing", async () => {
    const sql = db.sql();
    const req = new Request("http://x/api/anything");
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 result when token doesn't match any workspace", async () => {
    const sql = db.sql();
    const req = new Request("http://x/api/anything", { headers: { Authorization: "Bearer 00000000-0000-0000-0000-000000000000" } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when Authorization header is malformed", async () => {
    const sql = db.sql();
    const req = new Request("http://x/api/anything", { headers: { Authorization: "not-bearer-format" } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
  });

  it("advances last_seen_at on successful auth", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    // Backdate so any touch is unambiguously detectable.
    await sql`UPDATE workspaces SET last_seen_at = now() - interval '2 hours' WHERE id = ${ws.id}`;
    const before = (await sql`SELECT last_seen_at FROM workspaces WHERE id = ${ws.id}`)[0]!.last_seen_at as Date;

    const req = new Request("http://x/api/anything", { headers: { Authorization: `Bearer ${ws.id}` } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(true);

    const after = (await sql`SELECT last_seen_at FROM workspaces WHERE id = ${ws.id}`)[0]!.last_seen_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
