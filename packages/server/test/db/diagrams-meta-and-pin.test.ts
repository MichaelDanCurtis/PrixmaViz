import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import {
  createDiagram,
  dbBumpLastOpenedAt,
  dbListTags,
  dbMoveDiagram,
  dbSetPinned,
  dbUpdateMeta,
  isValidFolderPath,
  listDiagrams,
} from "../../src/db/diagrams";

// Issue #7 / Wave 1A: pin toggle, last_opened_at debounce, meta merge,
// folder path validation, and tag listing. These pin the contracts that
// Wave 1B's HTTP routes + MCP tools will wrap, so the wire-format-ish
// behavior of each helper is asserted explicitly.

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
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

describe("dbSetPinned", () => {
  it("toggles pinned and returns the new state", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "p", name: "P", engine: "mermaid", kind: "graph" });

    // Initial state: false (migration default).
    const list1 = await listDiagrams(sql, ws.id);
    expect(list1[0]?.pinned).toBe(false);

    const after = await dbSetPinned(sql, d.id, true);
    expect(after).toBe(true);

    const list2 = await listDiagrams(sql, ws.id);
    expect(list2[0]?.pinned).toBe(true);

    const afterUnpin = await dbSetPinned(sql, d.id, false);
    expect(afterUnpin).toBe(false);
    const list3 = await listDiagrams(sql, ws.id);
    expect(list3[0]?.pinned).toBe(false);
  });

  it("returns null for a non-existent diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const result = await dbSetPinned(sql, "d_does_not_exist", true);
    expect(result).toBeNull();
  });

  it("bumps updated_at so the action surfaces in by-updated sort", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u", name: "U", engine: "mermaid", kind: "graph" });
    const before = (await listDiagrams(sql, ws.id))[0]!.updatedAt;
    // Force a measurable gap.
    await sql`UPDATE diagrams SET updated_at = updated_at - interval '5 seconds' WHERE id = ${d.id}`;
    await dbSetPinned(sql, d.id, true);
    const after = (await listDiagrams(sql, ws.id))[0]!.updatedAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime() - 6000);
  });
});

describe("dbBumpLastOpenedAt", () => {
  it("sets last_opened_at on first call", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "b", name: "B", engine: "mermaid", kind: "graph" });

    const initial = (await listDiagrams(sql, ws.id))[0]!.lastOpenedAt;
    expect(initial).toBeNull();

    const ts = await dbBumpLastOpenedAt(sql, d.id);
    expect(ts).not.toBeNull();
    expect(new Date(ts!).getTime()).toBeGreaterThan(Date.now() - 5000);

    const persisted = (await listDiagrams(sql, ws.id))[0]!.lastOpenedAt;
    expect(persisted).toBe(ts);
  });

  it("is debounced — a second call within 1s does NOT update the timestamp", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "bd", name: "BD", engine: "mermaid", kind: "graph" });

    const t1 = await dbBumpLastOpenedAt(sql, d.id);
    // Immediate second call — debounce should return the same timestamp.
    const t2 = await dbBumpLastOpenedAt(sql, d.id);
    expect(t2).toBe(t1);
  });

  it("DOES update the timestamp once the 1s debounce window elapses", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "be", name: "BE", engine: "mermaid", kind: "graph" });

    const t1 = await dbBumpLastOpenedAt(sql, d.id);
    // Backdate last_opened_at by 2 seconds so the next bump escapes the
    // debounce window without making the test wait wall-clock time.
    await sql`UPDATE diagrams SET last_opened_at = last_opened_at - interval '2 seconds' WHERE id = ${d.id}`;
    const t2 = await dbBumpLastOpenedAt(sql, d.id);
    expect(t2).not.toBe(t1);
    expect(new Date(t2!).getTime()).toBeGreaterThan(new Date(t1!).getTime());
  });

  it("does NOT bump updated_at (last_opened_at is a read-side event)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "bu", name: "BU", engine: "mermaid", kind: "graph" });
    const updatedBefore = (await listDiagrams(sql, ws.id))[0]!.updatedAt;

    await dbBumpLastOpenedAt(sql, d.id);

    const updatedAfter = (await listDiagrams(sql, ws.id))[0]!.updatedAt;
    expect(updatedAfter).toBe(updatedBefore);
  });

  it("returns null for a non-existent diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const result = await dbBumpLastOpenedAt(sql, "d_does_not_exist");
    expect(result).toBeNull();
  });
});

describe("dbMoveDiagram", () => {
  it("moves a diagram into a folder", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "m", name: "M", engine: "mermaid", kind: "graph" });
    const result = await dbMoveDiagram(sql, d.id, "mercury/wire-format");
    expect(result).toBe("mercury/wire-format");
    const list = await listDiagrams(sql, ws.id);
    expect(list[0]?.parentPath).toBe("mercury/wire-format");
  });

  it("accepts empty string (move to workspace root)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "mr", name: "MR", engine: "mermaid", kind: "graph" });
    await dbMoveDiagram(sql, d.id, "mercury");
    const moved = await dbMoveDiagram(sql, d.id, "");
    expect(moved).toBe("");
    const list = await listDiagrams(sql, ws.id);
    expect(list[0]?.parentPath).toBe("");
  });

  it("rejects path traversal (`..`)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "mt", name: "MT", engine: "mermaid", kind: "graph" });
    await expect(dbMoveDiagram(sql, d.id, "../escape")).rejects.toThrow(/invalid folder path/);
    await expect(dbMoveDiagram(sql, d.id, "foo/..")).rejects.toThrow(/invalid folder path/);
  });

  it("rejects leading / trailing / double slashes", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "ms", name: "MS", engine: "mermaid", kind: "graph" });
    await expect(dbMoveDiagram(sql, d.id, "/leading")).rejects.toThrow(/invalid folder path/);
    await expect(dbMoveDiagram(sql, d.id, "trailing/")).rejects.toThrow(/invalid folder path/);
    await expect(dbMoveDiagram(sql, d.id, "double//slash")).rejects.toThrow(/invalid folder path/);
  });

  it("returns null for a non-existent diagram (after passing validation)", async () => {
    const sql = getDb(TEST_DB_URL);
    const result = await dbMoveDiagram(sql, "d_does_not_exist", "folder");
    expect(result).toBeNull();
  });
});

describe("isValidFolderPath", () => {
  it("accepts the empty string + valid kebab segments", () => {
    expect(isValidFolderPath("")).toBe(true);
    expect(isValidFolderPath("mercury")).toBe(true);
    expect(isValidFolderPath("mercury/wire-format")).toBe(true);
    expect(isValidFolderPath("a/b/c/d")).toBe(true);
    expect(isValidFolderPath("v2")).toBe(true);
    expect(isValidFolderPath("my_folder")).toBe(true);
  });

  it("rejects shapes that could mask SQL or filesystem semantics", () => {
    expect(isValidFolderPath("../escape")).toBe(false);
    expect(isValidFolderPath("..")).toBe(false);
    expect(isValidFolderPath("/leading")).toBe(false);
    expect(isValidFolderPath("trailing/")).toBe(false);
    expect(isValidFolderPath("double//slash")).toBe(false);
    expect(isValidFolderPath("foo%bar")).toBe(false); // wildcard would mask siblings
    expect(isValidFolderPath("foo bar")).toBe(false); // spaces
  });
});

describe("dbUpdateMeta", () => {
  it("merges patch fields and preserves existing keys (e.g. tags)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u", name: "U", engine: "mermaid", kind: "graph" });
    // Seed `tags` directly to simulate a diagram that came in with tags.
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["alpha", "beta"], sourcePaths: ["foo.md"] })} WHERE id = ${d.id}`;

    const merged = await dbUpdateMeta(sql, d.id, {
      description: "Short summary",
      author: "alice",
      notes: "## Heading\n\nSome body.",
    });

    expect(merged).toMatchObject({
      tags: ["alpha", "beta"],          // preserved
      sourcePaths: ["foo.md"],          // preserved
      description: "Short summary",     // new
      author: "alice",                  // new
      notes: "## Heading\n\nSome body.", // new
    });
  });

  it("patches only the provided fields, leaving other meta keys untouched", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u2", name: "U2", engine: "mermaid", kind: "graph" });
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["a"], description: "original", author: "bob" })} WHERE id = ${d.id}`;

    const merged = await dbUpdateMeta(sql, d.id, { notes: "new notes" });

    expect(merged).toMatchObject({
      tags: ["a"],
      description: "original", // not in patch — preserved
      author: "bob",           // not in patch — preserved
      notes: "new notes",      // patched
    });
  });

  it("an explicit empty string DOES clear (caller's intent)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u3", name: "U3", engine: "mermaid", kind: "graph" });
    await sql`UPDATE diagrams SET meta = ${sql.json({ description: "old" })} WHERE id = ${d.id}`;

    const merged = await dbUpdateMeta(sql, d.id, { description: "" });
    expect(merged?.description).toBe("");
  });

  it("an empty patch is a no-op — returns existing meta unchanged", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u4", name: "U4", engine: "mermaid", kind: "graph" });
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["x"], description: "y" })} WHERE id = ${d.id}`;

    const meta = await dbUpdateMeta(sql, d.id, {});
    expect(meta).toMatchObject({ tags: ["x"], description: "y" });
  });

  it("returns null for a non-existent diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const meta = await dbUpdateMeta(sql, "d_does_not_exist", { description: "x" });
    expect(meta).toBeNull();
  });
});

describe("dbListTags", () => {
  it("returns distinct tags across the workspace, alphabetically sorted", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d1 = await createDiagram(sql, { workspaceId: ws.id, slug: "a", name: "A", engine: "mermaid", kind: "graph" });
    const d2 = await createDiagram(sql, { workspaceId: ws.id, slug: "b", name: "B", engine: "mermaid", kind: "graph" });
    const d3 = await createDiagram(sql, { workspaceId: ws.id, slug: "c", name: "C", engine: "mermaid", kind: "graph" });
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["security", "auth"] })} WHERE id = ${d1.id}`;
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["auth", "billing"] })} WHERE id = ${d2.id}`;
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: [] })} WHERE id = ${d3.id}`;

    const tags = await dbListTags(sql, ws.id);
    expect(tags).toEqual(["auth", "billing", "security"]);
  });

  it("scopes by workspace (no cross-tenant leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const da = await createDiagram(sql, { workspaceId: a.id, slug: "a", name: "A", engine: "mermaid", kind: "graph" });
    const db = await createDiagram(sql, { workspaceId: b.id, slug: "b", name: "B", engine: "mermaid", kind: "graph" });
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["alpha-only"] })} WHERE id = ${da.id}`;
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: ["beta-only"] })} WHERE id = ${db.id}`;

    expect(await dbListTags(sql, a.id)).toEqual(["alpha-only"]);
    expect(await dbListTags(sql, b.id)).toEqual(["beta-only"]);
  });

  it("returns empty array when no diagrams have tags", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    expect(await dbListTags(sql, ws.id)).toEqual([]);
  });

  it("tolerates rows where meta.tags is missing or a non-array (resilience)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d1 = await createDiagram(sql, { workspaceId: ws.id, slug: "a", name: "A", engine: "mermaid", kind: "graph" });
    const d2 = await createDiagram(sql, { workspaceId: ws.id, slug: "b", name: "B", engine: "mermaid", kind: "graph" });
    // d1: no tags key at all in meta.
    await sql`UPDATE diagrams SET meta = ${sql.json({ description: "x" })} WHERE id = ${d1.id}`;
    // d2: tags as a string by mistake — should be filtered out, not crash.
    await sql`UPDATE diagrams SET meta = ${sql.json({ tags: "not-an-array" })} WHERE id = ${d2.id}`;

    expect(await dbListTags(sql, ws.id)).toEqual([]);
  });
});

describe("listDiagrams projection (Issue #7)", () => {
  it("projects parentPath / pinned / lastOpenedAt with default values", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    const list = await listDiagrams(sql, ws.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      parentPath: "",
      pinned: false,
      lastOpenedAt: null,
    });
  });

  it("reflects the persisted folder / pin / open state across writes", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await dbMoveDiagram(sql, d.id, "mercury/wire-format");
    await dbSetPinned(sql, d.id, true);
    const ts = await dbBumpLastOpenedAt(sql, d.id);
    const list = await listDiagrams(sql, ws.id);
    expect(list[0]).toMatchObject({
      parentPath: "mercury/wire-format",
      pinned: true,
      lastOpenedAt: ts,
    });
  });
});
