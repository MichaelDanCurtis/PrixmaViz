/**
 * Group E — workspace lifecycle MCP tool tests.
 *
 * Covers:
 *   - create_workspace returns id+name+createdAt and stores `owner_token_hash`
 *   - list_workspaces returns only workspaces owned by the caller
 *   - list_workspaces excludes workspaces owned by a different token
 *   - claim-on-first-call promotes the caller's primary anonymous workspace
 *   - diagramCount is accurate
 *
 * Tests use a real Postgres (per the existing test convention) so the
 * `owner_token_hash` column behavior is exercised against the real schema.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace, hashOwnerToken } from "../../../src/db/workspaces";
import { createDiagram } from "../../../src/db/diagrams";
import { emptyGraphIR } from "@prixmaviz/shared";
import { dispatchTool } from "../../../src/mcp/tools";

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

function ctx(sql: ReturnType<typeof getDb>, workspaceId: string) {
  return {
    sql,
    workspaceId,
    kroki: {
      renderSvg: async () => "<svg/>",
      renderBinary: async () => new Uint8Array(),
    } as never,
    hub: { broadcast: () => {} } as never,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// hashOwnerToken (sanity)
// ───────────────────────────────────────────────────────────────────────────

describe("hashOwnerToken", () => {
  it("returns the standard hex sha256 of the input", () => {
    const ws = "550e8400-e29b-41d4-a716-446655440000";
    const expected = createHash("sha256").update(ws).digest("hex");
    expect(hashOwnerToken(ws)).toBe(expected);
  });

  it("is deterministic", () => {
    expect(hashOwnerToken("abc")).toBe(hashOwnerToken("abc"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// create_workspace
// ───────────────────────────────────────────────────────────────────────────

describe("create_workspace", () => {
  it("returns workspaceId + name + createdAt for a default-named workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql);

    const result = (await dispatchTool(
      "create_workspace",
      {},
      ctx(sql, caller.id),
    )) as { workspaceId: string; name: string; createdAt: string };

    expect(typeof result.workspaceId).toBe("string");
    expect(result.workspaceId.length).toBeGreaterThan(0);
    expect(result.workspaceId).not.toBe(caller.id); // distinct from caller
    expect(result.name).toBe("Untitled workspace");
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("honors the supplied name", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql);

    const result = (await dispatchTool(
      "create_workspace",
      { name: "My Project" },
      ctx(sql, caller.id),
    )) as { workspaceId: string; name: string };

    expect(result.name).toBe("My Project");
  });

  it("stores owner_token_hash = sha256(callerToken) on the new row", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql);

    const result = (await dispatchTool(
      "create_workspace",
      { name: "Owned" },
      ctx(sql, caller.id),
    )) as { workspaceId: string };

    const rows = await sql<{ owner_token_hash: string | null }[]>`
      SELECT owner_token_hash FROM workspaces WHERE id = ${result.workspaceId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.owner_token_hash).toBe(hashOwnerToken(caller.id));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// list_workspaces
// ───────────────────────────────────────────────────────────────────────────

describe("list_workspaces", () => {
  it("returns the caller's primary workspace on first call (claim-on-first-call)", async () => {
    const sql = getDb(TEST_DB_URL);
    // Caller's primary workspace exists from before migration 0005 — i.e.
    // its `owner_token_hash` is NULL. The first list_workspaces call must
    // claim it.
    const caller = await createWorkspace(sql, "Caller Primary");

    // Verify start state — primary is anonymous.
    const before = await sql<{ owner_token_hash: string | null }[]>`
      SELECT owner_token_hash FROM workspaces WHERE id = ${caller.id}
    `;
    expect(before[0]!.owner_token_hash).toBeNull();

    const result = (await dispatchTool(
      "list_workspaces",
      {},
      ctx(sql, caller.id),
    )) as {
      workspaces: Array<{
        id: string;
        name: string | null;
        diagramCount: number;
        createdAt: string;
        updatedAt: string;
      }>;
    };

    expect(result.workspaces.length).toBe(1);
    expect(result.workspaces[0]!.id).toBe(caller.id);
    expect(result.workspaces[0]!.name).toBe("Caller Primary");

    // And the claim took effect in the DB.
    const after = await sql<{ owner_token_hash: string | null }[]>`
      SELECT owner_token_hash FROM workspaces WHERE id = ${caller.id}
    `;
    expect(after[0]!.owner_token_hash).toBe(hashOwnerToken(caller.id));
  });

  it("returns every workspace owned by the caller (caller's primary + any created via create_workspace)", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql, "Primary");

    const a = (await dispatchTool(
      "create_workspace",
      { name: "Project A" },
      ctx(sql, caller.id),
    )) as { workspaceId: string };
    const b = (await dispatchTool(
      "create_workspace",
      { name: "Project B" },
      ctx(sql, caller.id),
    )) as { workspaceId: string };

    const result = (await dispatchTool(
      "list_workspaces",
      {},
      ctx(sql, caller.id),
    )) as { workspaces: Array<{ id: string; name: string | null }> };

    const ids = result.workspaces.map((w) => w.id).sort();
    expect(ids).toEqual([caller.id, a.workspaceId, b.workspaceId].sort());
    const names = new Set(result.workspaces.map((w) => w.name));
    expect(names.has("Primary")).toBe(true);
    expect(names.has("Project A")).toBe(true);
    expect(names.has("Project B")).toBe(true);
  });

  it("excludes workspaces owned by a different token", async () => {
    const sql = getDb(TEST_DB_URL);
    const alice = await createWorkspace(sql, "Alice Primary");
    const bob = await createWorkspace(sql, "Bob Primary");

    // Alice creates a workspace; Bob shouldn't see it.
    const aliceProj = (await dispatchTool(
      "create_workspace",
      { name: "Alice Project" },
      ctx(sql, alice.id),
    )) as { workspaceId: string };

    // Bob's list_workspaces should return only Bob's primary (claim-on-first-call).
    const bobList = (await dispatchTool(
      "list_workspaces",
      {},
      ctx(sql, bob.id),
    )) as { workspaces: Array<{ id: string }> };

    const bobIds = bobList.workspaces.map((w) => w.id);
    expect(bobIds).toContain(bob.id);
    expect(bobIds).not.toContain(alice.id);
    expect(bobIds).not.toContain(aliceProj.workspaceId);

    // Alice can still see hers.
    const aliceList = (await dispatchTool(
      "list_workspaces",
      {},
      ctx(sql, alice.id),
    )) as { workspaces: Array<{ id: string }> };
    const aliceIds = aliceList.workspaces.map((w) => w.id);
    expect(aliceIds).toContain(alice.id);
    expect(aliceIds).toContain(aliceProj.workspaceId);
    expect(aliceIds).not.toContain(bob.id);
  });

  it("returns an accurate diagramCount per workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const caller = await createWorkspace(sql, "Caller");

    // Seed 3 diagrams in caller's workspace.
    for (let i = 0; i < 3; i++) {
      await createDiagram(sql, {
        workspaceId: caller.id,
        slug: `diag-${i}`,
        name: `Diag ${i}`,
        engine: "mermaid",
        kind: "graph",
        ir: emptyGraphIR(),
      });
    }

    // Create another empty workspace owned by caller.
    const empty = (await dispatchTool(
      "create_workspace",
      { name: "Empty" },
      ctx(sql, caller.id),
    )) as { workspaceId: string };

    const list = (await dispatchTool(
      "list_workspaces",
      {},
      ctx(sql, caller.id),
    )) as {
      workspaces: Array<{ id: string; diagramCount: number }>;
    };

    const byId = new Map(list.workspaces.map((w) => [w.id, w.diagramCount]));
    expect(byId.get(caller.id)).toBe(3);
    expect(byId.get(empty.workspaceId)).toBe(0);
  });

  it("does not claim a workspace already owned by another token", async () => {
    const sql = getDb(TEST_DB_URL);
    const alice = await createWorkspace(sql, "Alice");
    const bob = await createWorkspace(sql, "Bob");

    // Alice claims her workspace first.
    await dispatchTool("list_workspaces", {}, ctx(sql, alice.id));

    // Bob calls list_workspaces. He should ONLY get Bob's primary; he
    // must NOT claim Alice's anonymous-looking workspace, because Alice
    // already owns it.
    await dispatchTool("list_workspaces", {}, ctx(sql, bob.id));

    const aliceHashRow = await sql<{ owner_token_hash: string | null }[]>`
      SELECT owner_token_hash FROM workspaces WHERE id = ${alice.id}
    `;
    expect(aliceHashRow[0]!.owner_token_hash).toBe(hashOwnerToken(alice.id));
  });
});
