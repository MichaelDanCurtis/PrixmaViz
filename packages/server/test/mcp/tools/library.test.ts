/**
 * Issue #7 Wave 1B — MCP library tools tests.
 *
 * Each tool has three required assertions:
 *   1. Happy path — the mutation lands in the DB and the response
 *      reflects the new state.
 *   2. Ownership check — calling against a foreign workspace's
 *      diagramId is rejected (we do NOT leak whether the row exists,
 *      so the message is the generic "diagram not found").
 *   3. WS broadcast — the canonical `library:diagram-updated` event
 *      fires with the right `change` discriminator.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import type { ServerToClient } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace } from "../../../src/db/workspaces";
import { createDiagram, getDiagram, updateDiagram } from "../../../src/db/diagrams";
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
// pin_diagram
// ───────────────────────────────────────────────────────────────────────────

describe("pin_diagram", () => {
  it("toggles pinned=true and persists; broadcasts library:diagram-updated", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const result = (await dispatchTool(
      "pin_diagram",
      { diagramId: d.id, pinned: true },
      ctx,
    )) as { ok: boolean; pinned: boolean };

    expect(result.ok).toBe(true);
    expect(result.pinned).toBe(true);

    const after = await getDiagram(sql, ws.id, d.id);
    expect(after?.pinned).toBe(true);

    // Broadcast happened with the right discriminator.
    const updated = broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:diagram-updated",
    );
    expect(updated.length).toBe(1);
    expect((updated[0]!.msg as { change?: string }).change).toBe("pinned");
    expect((updated[0]!.msg as { diagramId?: string }).diagramId).toBe(d.id);
    expect(updated[0]!.workspaceId).toBe(ws.id);
  });

  it("toggles pinned=false (round-trip)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await dispatchTool("pin_diagram", { diagramId: d.id, pinned: true }, ctx);
    const result = (await dispatchTool(
      "pin_diagram",
      { diagramId: d.id, pinned: false },
      ctx,
    )) as { pinned: boolean };
    expect(result.pinned).toBe(false);
    const after = await getDiagram(sql, ws.id, d.id);
    expect(after?.pinned).toBe(false);
  });

  it("ownership check — refuses to pin a foreign workspace's diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: a.id, slug: "secret", name: "S", engine: "mermaid", kind: "passthrough", dsl: "a-->b",
    });
    const { ctx } = makeCtx(sql, b.id);

    await expect(
      dispatchTool("pin_diagram", { diagramId: d.id, pinned: true }, ctx),
    ).rejects.toThrow(/diagram not found/);

    // The diagram in workspace A is untouched.
    const after = await getDiagram(sql, a.id, d.id);
    expect(after?.pinned).toBe(false);
  });

  it("rejects non-boolean pinned (validator)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("pin_diagram", { diagramId: d.id, pinned: "yes" }, ctx),
    ).rejects.toThrow();
  });

  it("404-style error for an unknown diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("pin_diagram", { diagramId: "d_nope", pinned: true }, ctx),
    ).rejects.toThrow(/diagram not found/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// move_diagram
// ───────────────────────────────────────────────────────────────────────────

describe("move_diagram", () => {
  it("sets parent_path, persists, and broadcasts change=moved", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const result = (await dispatchTool(
      "move_diagram",
      { diagramId: d.id, parentPath: "mercury/wire-format" },
      ctx,
    )) as { ok: boolean; parentPath: string };

    expect(result.ok).toBe(true);
    expect(result.parentPath).toBe("mercury/wire-format");

    const after = await getDiagram(sql, ws.id, d.id);
    expect(after?.parentPath).toBe("mercury/wire-format");

    const updated = broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:diagram-updated",
    );
    expect(updated.length).toBe(1);
    expect((updated[0]!.msg as { change?: string }).change).toBe("moved");
  });

  it("empty parentPath moves to workspace root", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    // First move into a folder.
    await dispatchTool("move_diagram", { diagramId: d.id, parentPath: "folder" }, ctx);
    // Then back to root.
    const result = (await dispatchTool(
      "move_diagram",
      { diagramId: d.id, parentPath: "" },
      ctx,
    )) as { parentPath: string };
    expect(result.parentPath).toBe("");
    const after = await getDiagram(sql, ws.id, d.id);
    expect(after?.parentPath).toBe("");
  });

  it("rejects path traversal (..)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await expect(
      dispatchTool("move_diagram", { diagramId: d.id, parentPath: "../escape" }, ctx),
    ).rejects.toThrow(/invalid folder path/);

    // Diagram stays at root.
    const after = await getDiagram(sql, ws.id, d.id);
    expect(after?.parentPath).toBe("");
  });

  it("rejects leading slash, trailing slash, double slash", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    for (const bad of ["/leading", "trailing/", "double//slash"]) {
      await expect(
        dispatchTool("move_diagram", { diagramId: d.id, parentPath: bad }, ctx),
      ).rejects.toThrow(/invalid folder path/);
    }
  });

  it("ownership check — refuses to move a foreign workspace's diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: a.id, slug: "x", name: "X", engine: "mermaid", kind: "passthrough", dsl: "a-->b",
    });
    const { ctx } = makeCtx(sql, b.id);

    await expect(
      dispatchTool("move_diagram", { diagramId: d.id, parentPath: "hijack" }, ctx),
    ).rejects.toThrow(/diagram not found/);

    const after = await getDiagram(sql, a.id, d.id);
    expect(after?.parentPath).toBe("");
  });

  it("404-style error for an unknown diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const { ctx } = makeCtx(sql, ws.id);
    await expect(
      dispatchTool("move_diagram", { diagramId: "d_nope", parentPath: "folder" }, ctx),
    ).rejects.toThrow(/diagram not found/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// update_diagram_meta
// ───────────────────────────────────────────────────────────────────────────

describe("update_diagram_meta", () => {
  it("patches description / author / notes and merges with existing meta", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    // Seed with some tags so we can verify they survive the patch.
    await updateDiagram(sql, ws.id, d.id, { meta: { tags: ["original"], sourcePaths: ["a.md"] } });
    const { ctx, broadcasts } = makeCtx(sql, ws.id);

    const result = (await dispatchTool(
      "update_diagram_meta",
      {
        diagramId: d.id,
        description: "the alpha diagram",
        author: "alice",
        notes: "## Notes\nmarkdown content",
      },
      ctx,
    )) as { ok: boolean; meta: Record<string, unknown> };

    expect(result.ok).toBe(true);
    expect(result.meta.description).toBe("the alpha diagram");
    expect(result.meta.author).toBe("alice");
    expect(result.meta.notes).toBe("## Notes\nmarkdown content");
    // Critical: tags and sourcePaths preserved.
    expect(result.meta.tags).toEqual(["original"]);
    expect(result.meta.sourcePaths).toEqual(["a.md"]);

    const updated = broadcasts.filter(
      (b) => (b.msg as { type?: string }).type === "library:diagram-updated",
    );
    expect(updated.length).toBe(1);
    expect((updated[0]!.msg as { change?: string }).change).toBe("meta");
  });

  it("patches a single field without clobbering the others", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await dispatchTool(
      "update_diagram_meta",
      { diagramId: d.id, description: "first", author: "alice" },
      ctx,
    );
    const second = (await dispatchTool(
      "update_diagram_meta",
      { diagramId: d.id, notes: "added later" },
      ctx,
    )) as { meta: Record<string, unknown> };

    // All three keys present in the final meta.
    expect(second.meta.description).toBe("first");
    expect(second.meta.author).toBe("alice");
    expect(second.meta.notes).toBe("added later");
  });

  it("accepts explicit empty string to clear a field", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await dispatchTool(
      "update_diagram_meta",
      { diagramId: d.id, description: "to-be-cleared" },
      ctx,
    );
    const cleared = (await dispatchTool(
      "update_diagram_meta",
      { diagramId: d.id, description: "" },
      ctx,
    )) as { meta: Record<string, unknown> };

    expect(cleared.meta.description).toBe("");
  });

  it("rejects empty patch (no description / author / notes)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await seedDiagram(sql, ws.id);
    const { ctx } = makeCtx(sql, ws.id);

    await expect(
      dispatchTool("update_diagram_meta", { diagramId: d.id }, ctx),
    ).rejects.toThrow(/at least one of description, author, or notes/);
  });

  it("ownership check — refuses to mutate a foreign workspace's meta", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: a.id, slug: "y", name: "Y", engine: "mermaid", kind: "passthrough", dsl: "a-->b",
    });
    const { ctx } = makeCtx(sql, b.id);

    await expect(
      dispatchTool(
        "update_diagram_meta",
        { diagramId: d.id, description: "hijack" },
        ctx,
      ),
    ).rejects.toThrow(/diagram not found/);

    const after = await getDiagram(sql, a.id, d.id);
    expect((after?.meta as { description?: string }).description).toBeUndefined();
  });
});
