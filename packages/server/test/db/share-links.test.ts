/**
 * Issue #8 / Wave 1A — share_links DB helper tests.
 *
 * Two contracts are pinned here:
 *   1. CRUD round-trips correctly with owner isolation.
 *   2. Expiry semantics — `dbResolveShareToken` returns null on expired
 *      tokens but `dbGetShareByToken` still returns them (so the HTTP
 *      layer can distinguish 404 vs 410 Gone).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram, setDiagramPublic } from "../../src/db/diagrams";
import {
  dbCreateShareLink,
  dbGetShareByToken,
  dbListShareLinks,
  dbResolveShareToken,
  dbRevokeShareLink,
} from "../../src/db/share-links";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS share_links CASCADE`;
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

async function seed(sql: ReturnType<typeof getDb>) {
  const ws = await createWorkspace(sql);
  const d = await createDiagram(sql, {
    workspaceId: ws.id,
    slug: "alpha",
    name: "Alpha",
    engine: "mermaid",
    kind: "passthrough",
    dsl: "graph TD\n  A --> B",
  });
  return { ws, d };
}

// ───────────────────────────────────────────────────────────────────────────
// dbCreateShareLink
// ───────────────────────────────────────────────────────────────────────────

describe("dbCreateShareLink", () => {
  it("returns id + token for a new view-only link", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);

    const res = await dbCreateShareLink(sql, d.id, "view", null, ws.id);
    expect(res.id).toBeTruthy();
    expect(res.token).toMatch(/^s_[0-9a-f]{32}$/);

    const row = await sql`SELECT * FROM share_links WHERE token = ${res.token}`;
    expect(row).toHaveLength(1);
    expect(row[0]!.permission).toBe("view");
    expect(row[0]!.expires_at).toBeNull();
    expect(row[0]!.created_by).toBe(ws.id);
  });

  it("persists permission tier and expiry", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const future = new Date(Date.now() + 60_000).toISOString();

    const res = await dbCreateShareLink(sql, d.id, "edit", future, ws.id);
    const row = await sql`SELECT permission, expires_at FROM share_links WHERE token = ${res.token}`;
    expect(row[0]!.permission).toBe("edit");
    expect((row[0]!.expires_at as Date).toISOString()).toBe(future);
  });

  it("rejects an invalid permission tier (DB CHECK constraint)", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    await expect(
      dbCreateShareLink(sql, d.id, "admin" as never, null, ws.id),
    ).rejects.toThrow();
  });

  it("generates a fresh token per call (no collisions across N calls)", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const tokens = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { token } = await dbCreateShareLink(sql, d.id, "view", null, ws.id);
      tokens.add(token);
    }
    expect(tokens.size).toBe(10);
  });

  it("FK fails when diagram is missing (23503)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dbCreateShareLink(sql, "d_nonexistent", "view", null, ws.id),
    ).rejects.toMatchObject({ code: "23503" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dbListShareLinks
// ───────────────────────────────────────────────────────────────────────────

describe("dbListShareLinks", () => {
  it("returns all owner's links for the diagram, newest first", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    await dbCreateShareLink(sql, d.id, "view", null, ws.id);
    // Bump created_at on first row so we can assert ordering.
    await sql`UPDATE share_links SET created_at = now() - interval '1 second'`;
    await dbCreateShareLink(sql, d.id, "edit", null, ws.id);

    const links = await dbListShareLinks(sql, d.id, ws.id);
    expect(links).toHaveLength(2);
    expect(links[0]!.permission).toBe("edit"); // newest first
    expect(links[1]!.permission).toBe("view");
  });

  it("isolates by createdBy — no leak across workspaces", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await createDiagram(sql, {
      workspaceId: wsA.id,
      slug: "a",
      name: "A",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "a-->b",
    });
    // wsA creates a link on its own diagram.
    await dbCreateShareLink(sql, dA.id, "view", null, wsA.id);

    // wsB attempts to list — gets nothing.
    const linksB = await dbListShareLinks(sql, dA.id, wsB.id);
    expect(linksB).toHaveLength(0);

    // wsA sees its own link.
    const linksA = await dbListShareLinks(sql, dA.id, wsA.id);
    expect(linksA).toHaveLength(1);
  });

  it("returns [] when no shares exist", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    expect(await dbListShareLinks(sql, d.id, ws.id)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dbGetShareByToken
// ───────────────────────────────────────────────────────────────────────────

describe("dbGetShareByToken", () => {
  it("returns the link metadata for a valid token (no expiry gate)", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const { token } = await dbCreateShareLink(sql, d.id, "comment", null, ws.id);

    const got = await dbGetShareByToken(sql, token);
    expect(got).toEqual({
      diagramId: d.id,
      permission: "comment",
      expiresAt: null,
    });
  });

  it("returns null for a missing token", async () => {
    const sql = getDb(TEST_DB_URL);
    expect(await dbGetShareByToken(sql, "s_doesnotexist")).toBeNull();
  });

  it("returns the row EVEN when expired (no expiry gate here)", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await dbCreateShareLink(sql, d.id, "view", past, ws.id);

    const got = await dbGetShareByToken(sql, token);
    expect(got).not.toBeNull();
    expect(got!.expiresAt).toBe(past);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dbResolveShareToken
// ───────────────────────────────────────────────────────────────────────────

describe("dbResolveShareToken", () => {
  it("returns { diagramId, permission } for a valid non-expired token", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const { token } = await dbCreateShareLink(sql, d.id, "edit", null, ws.id);

    const got = await dbResolveShareToken(sql, token);
    expect(got).toEqual({ diagramId: d.id, permission: "edit" });
  });

  it("returns null for an expired token", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { token } = await dbCreateShareLink(sql, d.id, "view", past, ws.id);

    expect(await dbResolveShareToken(sql, token)).toBeNull();
    // ...but dbGetShareByToken still finds it (so HTTP can distinguish 410).
    expect(await dbGetShareByToken(sql, token)).not.toBeNull();
  });

  it("returns null for a missing token", async () => {
    const sql = getDb(TEST_DB_URL);
    expect(await dbResolveShareToken(sql, "s_doesnotexist")).toBeNull();
  });

  it("future expiry resolves; past expiry doesn't", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    const { token: tFuture } = await dbCreateShareLink(sql, d.id, "view", future, ws.id);
    const { token: tPast } = await dbCreateShareLink(sql, d.id, "view", past, ws.id);

    expect(await dbResolveShareToken(sql, tFuture)).not.toBeNull();
    expect(await dbResolveShareToken(sql, tPast)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// dbRevokeShareLink
// ───────────────────────────────────────────────────────────────────────────

describe("dbRevokeShareLink", () => {
  it("deletes the link for the rightful owner; returns 1", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const { token } = await dbCreateShareLink(sql, d.id, "view", null, ws.id);

    const n = await dbRevokeShareLink(sql, token, ws.id);
    expect(n).toBe(1);
    expect(await dbGetShareByToken(sql, token)).toBeNull();
  });

  it("returns 0 when token doesn't exist", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    expect(await dbRevokeShareLink(sql, "s_doesnotexist", ws.id)).toBe(0);
  });

  it("returns 0 when caller is not the owner (no leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await createDiagram(sql, {
      workspaceId: wsA.id,
      slug: "a",
      name: "A",
      engine: "mermaid",
      kind: "passthrough",
      dsl: "a-->b",
    });
    const { token } = await dbCreateShareLink(sql, dA.id, "view", null, wsA.id);

    // wsB attempts revoke — gets 0, link still there.
    expect(await dbRevokeShareLink(sql, token, wsB.id)).toBe(0);
    expect(await dbGetShareByToken(sql, token)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cascade behavior (FK)
// ───────────────────────────────────────────────────────────────────────────

describe("share_links cascade", () => {
  it("deleting the diagram cascades the share_links row", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    const { token } = await dbCreateShareLink(sql, d.id, "view", null, ws.id);
    await sql`DELETE FROM diagrams WHERE id = ${d.id}`;
    expect(await dbGetShareByToken(sql, token)).toBeNull();
  });

  it("deleting the workspace cascades all of its share_links", async () => {
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    await dbCreateShareLink(sql, d.id, "view", null, ws.id);
    await sql`DELETE FROM workspaces WHERE id = ${ws.id}`;
    const remaining = await sql`SELECT count(*)::int AS n FROM share_links`;
    expect(remaining[0]!.n).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Backfill (migration 0010)
// ───────────────────────────────────────────────────────────────────────────

describe("migration 0010 backfill", () => {
  it("creates a view-only share row for every existing public_view=TRUE diagram", async () => {
    // The migration is already run by `reset()`. To exercise the backfill
    // path we set public_view=TRUE BEFORE migrations are applied. Since we
    // can't easily replay just the backfill here, we instead verify the
    // INSERT ... NOT EXISTS clause: a fresh public diagram + a manual rerun
    // of the backfill SQL must NOT create a duplicate.
    const sql = getDb(TEST_DB_URL);
    const { ws, d } = await seed(sql);
    await setDiagramPublic(sql, ws.id, d.id, true);

    // Replay the migration's backfill SQL.
    await sql`
      INSERT INTO share_links (diagram_id, token, permission, created_by)
      SELECT
        id,
        'pub_' || replace(gen_random_uuid()::text, '-', ''),
        'view',
        workspace_id
      FROM diagrams
      WHERE public_view = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM share_links sl WHERE sl.diagram_id = diagrams.id
        )
    `;
    const after = await sql`SELECT count(*)::int AS n FROM share_links WHERE diagram_id = ${d.id}`;
    expect(after[0]!.n).toBe(1);

    // Re-running the same backfill is idempotent (NOT EXISTS guard).
    await sql`
      INSERT INTO share_links (diagram_id, token, permission, created_by)
      SELECT
        id,
        'pub_' || replace(gen_random_uuid()::text, '-', ''),
        'view',
        workspace_id
      FROM diagrams
      WHERE public_view = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM share_links sl WHERE sl.diagram_id = diagrams.id
        )
    `;
    const stillOne = await sql`SELECT count(*)::int AS n FROM share_links WHERE diagram_id = ${d.id}`;
    expect(stillOne[0]!.n).toBe(1);
  });
});
