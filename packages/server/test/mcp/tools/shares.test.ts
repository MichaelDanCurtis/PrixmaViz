/**
 * Issue #8 / Wave 1A — MCP share-link tool tests.
 *
 * Three tools, each asserted on three contracts:
 *   1. Happy path — DB row lands AND response is correct.
 *   2. Ownership — foreign workspace can't touch another's diagram/token.
 *   3. WS broadcast — the canonical `library:share-*` event fires.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import type { ServerToClient } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace } from "../../../src/db/workspaces";
import { createDiagram } from "../../../src/db/diagrams";
import {
  dbCreateShareLink,
  dbGetShareByToken,
} from "../../../src/db/share-links";
import { dispatchTool } from "../../../src/mcp/tools";

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
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

interface BroadcastEvent {
  workspaceId: string | null;
  msg: ServerToClient;
}

function makeCtx(sql: ReturnType<typeof getDb>, workspaceId: string) {
  const broadcasts: BroadcastEvent[] = [];
  const ctx = {
    sql,
    workspaceId,
    kroki: { renderSvg: async () => "<svg/>" } as never,
    hub: {
      broadcast(wsId: string | null, msg: ServerToClient) {
        broadcasts.push({ workspaceId: wsId, msg });
      },
    } as never,
  };
  return { ctx, broadcasts };
}

async function seedDiagram(sql: ReturnType<typeof getDb>, workspaceId: string) {
  return createDiagram(sql, {
    workspaceId,
    slug: "alpha",
    name: "Alpha",
    engine: "mermaid",
    kind: "passthrough",
    dsl: "graph TD\n  A --> B",
  });
}

// ───────────────────────────────────────────────────────────────────────────
// create_share_link
// ───────────────────────────────────────────────────────────────────────────

describe("create_share_link", () => {
  it("creates a view link, returns token + url, broadcasts library:share-created", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const result = await dispatchTool(
      "create_share_link",
      { diagramId: d.id, permission: "view" },
      ctx,
    ) as { token: string; url: string };

    expect(result.token).toMatch(/^s_[0-9a-f]{32}$/);
    expect(result.url).toContain(result.token);

    const got = await dbGetShareByToken(sql, result.token);
    expect(got?.diagramId).toBe(d.id);
    expect(got?.permission).toBe("view");

    const created = broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:share-created",
    );
    expect(created.length).toBe(1);
    expect((created[0]!.msg as { token?: string }).token).toBe(result.token);
    expect((created[0]!.msg as { permission?: string }).permission).toBe("view");
  });

  it("persists expiresAt when provided", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);
    const future = new Date(Date.now() + 60_000).toISOString();

    const result = await dispatchTool(
      "create_share_link",
      { diagramId: d.id, permission: "edit", expiresAt: future },
      ctx,
    ) as { token: string };

    const got = await dbGetShareByToken(sql, result.token);
    expect(got?.expiresAt).toBe(future);
    expect(got?.permission).toBe("edit");
  });

  it("rejects an invalid permission tier", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    // The validator catches enum violation BEFORE the impl runs — code is
    // `invalid_parameter_value`.
    await expect(
      dispatchTool("create_share_link", { diagramId: d.id, permission: "admin" }, ctx),
    ).rejects.toThrow();
  });

  it("rejects an unparseable expiresAt", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await expect(
      dispatchTool(
        "create_share_link",
        { diagramId: d.id, permission: "view", expiresAt: "not a date" },
        ctx,
      ),
    ).rejects.toThrow(/expiresAt/);
  });

  it("rejects when caller does not own the diagram (foreign workspace)", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await seedDiagram(sql, wsA.id);
    const { ctx } = makeCtx(sql, wsB.id);

    await expect(
      dispatchTool("create_share_link", { diagramId: dA.id, permission: "view" }, ctx),
    ).rejects.toThrow(/diagram not found/);

    const row = await sql`SELECT count(*)::int AS n FROM share_links WHERE diagram_id = ${dA.id}`;
    expect(row[0]!.n).toBe(0);
  });

  it("validation rejects missing diagramId / permission", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(dispatchTool("create_share_link", { permission: "view" }, ctx)).rejects.toThrow();
    await expect(dispatchTool("create_share_link", { diagramId: "x" }, ctx)).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// list_share_links
// ───────────────────────────────────────────────────────────────────────────

describe("list_share_links", () => {
  it("lists the caller's links for the diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    await dbCreateShareLink(sql, d.id, "view", null, ws.id);
    await dbCreateShareLink(sql, d.id, "edit", null, ws.id);

    const { ctx } = makeCtx(sql, ws.id);
    const result = await dispatchTool(
      "list_share_links",
      { diagramId: d.id },
      ctx,
    ) as { links: Array<{ token: string; permission: string; url: string }> };

    expect(result.links).toHaveLength(2);
    expect(result.links.every((l) => l.token.startsWith("s_"))).toBe(true);
    expect(result.links.every((l) => l.url.endsWith(l.token))).toBe(true);
  });

  it("404 ('diagram not found') for a foreign workspace's diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await seedDiagram(sql, wsA.id);
    await dbCreateShareLink(sql, dA.id, "view", null, wsA.id);

    const { ctx } = makeCtx(sql, wsB.id);
    await expect(
      dispatchTool("list_share_links", { diagramId: dA.id }, ctx),
    ).rejects.toThrow(/diagram not found/);
  });

  it("returns empty links array when no shares exist", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    const result = await dispatchTool(
      "list_share_links",
      { diagramId: d.id },
      ctx,
    ) as { links: unknown[] };
    expect(result.links).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// revoke_share_link
// ───────────────────────────────────────────────────────────────────────────

describe("revoke_share_link", () => {
  it("revokes the link, returns ok, broadcasts library:share-revoked", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { token } = await dbCreateShareLink(sql, d.id, "view", null, ws.id);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const result = await dispatchTool(
      "revoke_share_link",
      { token },
      ctx,
    ) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(await dbGetShareByToken(sql, token)).toBeNull();

    const revoked = broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:share-revoked",
    );
    expect(revoked.length).toBe(1);
    expect((revoked[0]!.msg as { token?: string }).token).toBe(token);
  });

  it("throws 'share not found' for a missing token", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("revoke_share_link", { token: "s_doesnotexist" }, ctx),
    ).rejects.toThrow(/share not found/);
  });

  it("throws 'share not found' for a non-owner (no existence leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const wsA = await createWorkspace(sql);
    const wsB = await createWorkspace(sql);
    const dA = await seedDiagram(sql, wsA.id);
    const { token } = await dbCreateShareLink(sql, dA.id, "view", null, wsA.id);

    const { ctx, broadcasts } = makeCtx(sql, wsB.id);
    await expect(
      dispatchTool("revoke_share_link", { token }, ctx),
    ).rejects.toThrow(/share not found/);

    // Link still exists.
    expect(await dbGetShareByToken(sql, token)).not.toBeNull();

    // No broadcast on failure.
    const revoked = broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:share-revoked",
    );
    expect(revoked.length).toBe(0);
  });

  it("validation rejects missing token", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(dispatchTool("revoke_share_link", {}, ctx)).rejects.toThrow();
  });
});
