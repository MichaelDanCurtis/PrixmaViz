import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import {
  createDiagram,
  dbMoveDiagram,
  listDiagrams,
} from "../../src/db/diagrams";
import {
  FOLDER_RENAME_ROW_CAP,
  dbDeleteFolder,
  dbListEmptyFolders,
  dbRenameFolder,
  dbSetEmptyFolders,
} from "../../src/db/folders";

// Issue #7 / Wave 1A: folder rename / delete / empty-folder tracking.
// Two security-critical contracts are pinned here:
//   1. Rename uses starts_with(), NOT LIKE — a folder name containing
//      `%` or `_` must NOT silently match siblings.
//   2. Delete without cascade fails clearly when diagrams exist.
//
// Plus the empty-folder list round-trip used by F2's "New folder"
// inline-input flow.

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

async function seedTree(sql: ReturnType<typeof getDb>, workspaceId: string) {
  // Build a 3-level deep folder layout:
  //   mercury/
  //     wire-format/
  //       packet-anatomy
  //     overview
  //   auth-flows/
  //     oauth-dance
  //   (root-level) ungrouped
  const d1 = await createDiagram(sql, { workspaceId, slug: "packet", name: "Packet", engine: "mermaid", kind: "graph" });
  const d2 = await createDiagram(sql, { workspaceId, slug: "overview", name: "Overview", engine: "mermaid", kind: "graph" });
  const d3 = await createDiagram(sql, { workspaceId, slug: "oauth", name: "OAuth", engine: "mermaid", kind: "graph" });
  const d4 = await createDiagram(sql, { workspaceId, slug: "ungrouped", name: "Ungrouped", engine: "mermaid", kind: "graph" });
  await dbMoveDiagram(sql, d1.id, "mercury/wire-format");
  await dbMoveDiagram(sql, d2.id, "mercury");
  await dbMoveDiagram(sql, d3.id, "auth-flows");
  // d4 stays at root (parent_path = '')
  return { d1, d2, d3, d4 };
}

describe("dbRenameFolder — happy path", () => {
  it("renames a folder and ALL descendants in a single transaction (3 levels)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);

    // Rename mercury → solar/v2 — touches the wire-format descendant too.
    const n = await dbRenameFolder(sql, ws.id, "mercury", "solar/v2");
    expect(n).toBe(2); // mercury/wire-format/packet + mercury/overview

    const list = await listDiagrams(sql, ws.id);
    const byName = Object.fromEntries(list.map((d) => [d.name, d.parentPath]));
    expect(byName.Packet).toBe("solar/v2/wire-format");
    expect(byName.Overview).toBe("solar/v2");
    expect(byName.OAuth).toBe("auth-flows");   // unaffected sibling
    expect(byName.Ungrouped).toBe("");         // unaffected root
  });

  it("renaming a leaf folder only moves its direct children, not unrelated paths", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);

    const n = await dbRenameFolder(sql, ws.id, "mercury/wire-format", "mercury/wire");
    expect(n).toBe(1); // just packet

    const list = await listDiagrams(sql, ws.id);
    const byName = Object.fromEntries(list.map((d) => [d.name, d.parentPath]));
    expect(byName.Packet).toBe("mercury/wire");
    expect(byName.Overview).toBe("mercury"); // sibling NOT rewritten
  });

  it("renaming a non-existent folder is a no-op (0 rows)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);
    const n = await dbRenameFolder(sql, ws.id, "no-such-folder", "still-no-such-folder");
    expect(n).toBe(0);
  });

  it("renaming where from === to is a no-op (0 rows, no UPDATE issued)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);
    const n = await dbRenameFolder(sql, ws.id, "mercury", "mercury");
    expect(n).toBe(0);
  });
});

describe("dbRenameFolder — security regression (starts_with, not LIKE)", () => {
  // The critical contract: a folder name containing `%` is rejected by
  // the validator AT ALL, and even if it weren't, starts_with() treats
  // it literally. We assert BOTH layers — even if one regresses (e.g.
  // someone loosens the validator), the SQL layer still doesn't silently
  // glob siblings.
  it("rejects a `%` in the folder name at the validation layer", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(dbRenameFolder(sql, ws.id, "foo%bar", "x")).rejects.toThrow(/invalid source folder/);
    await expect(dbRenameFolder(sql, ws.id, "foo", "foo%bar")).rejects.toThrow(/invalid target folder/);
  });

  it("starts_with treats a literal `_` (which IS allowed by the validator) as a single char, NOT as a LIKE wildcard", async () => {
    // `_` is a valid char in the validator regex (underscore segments
    // like "my_folder" are common). Under LIKE it would match ANY one
    // character. starts_with treats it literally.
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Two siblings whose names would collide under LIKE-with-_-wildcard:
    //   "my_folder/a" — what we WANT to rename
    //   "myXfolder/b" — what LIKE would also match (`my_folder/%`)
    const a = await createDiagram(sql, { workspaceId: ws.id, slug: "a", name: "A", engine: "mermaid", kind: "graph" });
    const b = await createDiagram(sql, { workspaceId: ws.id, slug: "b", name: "B", engine: "mermaid", kind: "graph" });
    await dbMoveDiagram(sql, a.id, "my_folder");
    // Write the LIKE-collision sibling directly — the validator rejects
    // it on the public path, but it's a perfectly valid stored value
    // for the regression check (the bug case would be a workspace that
    // somehow ended up with such a folder via a prior tool version).
    await sql`UPDATE diagrams SET parent_path = 'myXfolder' WHERE id = ${b.id}`;

    const n = await dbRenameFolder(sql, ws.id, "my_folder", "yours");
    expect(n).toBe(1); // ONLY a, never b

    const list = await listDiagrams(sql, ws.id);
    const byName = Object.fromEntries(list.map((d) => [d.name, d.parentPath]));
    expect(byName.A).toBe("yours");
    expect(byName.B).toBe("myXfolder"); // untouched — LIKE would have hit it
  });
});

describe("dbRenameFolder — row cap", () => {
  it("throws a structured error when the rename would touch more than FOLDER_RENAME_ROW_CAP rows", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Stuff the diagrams table directly to bypass per-row helper overhead.
    // FOLDER_RENAME_ROW_CAP is 500; we need >500 rows in the source folder.
    const insertCount = FOLDER_RENAME_ROW_CAP + 5;
    // Single multi-VALUES INSERT — keeps the test fast.
    const ids = Array.from({ length: insertCount }, (_, i) => [
      `d_bulk_${i.toString(36).padStart(8, "0")}`,
      ws.id,
      `bulk-${i}`,
      `Bulk ${i}`,
      "mermaid",
      "graph",
      "big-folder",
    ] as const);
    await sql`
      INSERT INTO diagrams (id, workspace_id, slug, name, engine, kind, parent_path)
      VALUES ${sql(ids)}
    `;

    try {
      await dbRenameFolder(sql, ws.id, "big-folder", "renamed");
      throw new Error("expected dbRenameFolder to throw");
    } catch (e) {
      const err = e as { error?: string; rows?: number; cap?: number; message?: string };
      expect(err.error).toBe("folder rename touches too many rows");
      expect(err.rows).toBe(insertCount);
      expect(err.cap).toBe(FOLDER_RENAME_ROW_CAP);
    }

    // CRITICAL: the throw must happen INSIDE the transaction so NOTHING
    // gets rewritten — partial rename is the worst possible failure
    // mode (half the diagrams in one folder, half in another).
    const list = await listDiagrams(sql, ws.id);
    const stillInOriginal = list.filter((d) => d.parentPath === "big-folder");
    expect(stillInOriginal).toHaveLength(insertCount);
  }, 30_000);
});

describe("dbDeleteFolder", () => {
  it("cascade=true deletes the folder + ALL descendants and returns the count", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);

    const n = await dbDeleteFolder(sql, ws.id, "mercury", true);
    expect(n).toBe(2); // mercury/wire-format/packet + mercury/overview

    const list = await listDiagrams(sql, ws.id);
    const names = list.map((d) => d.name).sort();
    expect(names).toEqual(["OAuth", "Ungrouped"]);
  });

  it("cascade=false throws { error: 'folder has N diagrams', count } when diagrams exist", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);

    try {
      await dbDeleteFolder(sql, ws.id, "mercury", false);
      throw new Error("expected dbDeleteFolder to throw");
    } catch (e) {
      const err = e as { error?: string; count?: number };
      expect(err.error).toBe("folder has N diagrams");
      expect(err.count).toBe(2);
    }

    // Diagrams still there (no partial delete).
    const list = await listDiagrams(sql, ws.id);
    expect(list).toHaveLength(4);
  });

  it("cascade=false succeeds (and returns 0) when the folder is empty", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Empty folder via the empty-folder list — no diagrams inside.
    await dbSetEmptyFolders(sql, ws.id, ["new-empty"]);
    const n = await dbDeleteFolder(sql, ws.id, "new-empty", false);
    expect(n).toBe(0);
    // And the empty-folder entry was removed too.
    const remaining = await dbListEmptyFolders(sql, ws.id);
    expect(remaining).toEqual([]);
  });

  it("removes nested empty-folder entries when cascading", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await seedTree(sql, ws.id);
    await dbSetEmptyFolders(sql, ws.id, ["mercury/empty-sub", "unrelated"]);

    await dbDeleteFolder(sql, ws.id, "mercury", true);

    const remaining = await dbListEmptyFolders(sql, ws.id);
    expect(remaining).toEqual(["unrelated"]); // descendant emptyFolders entry purged
  });

  it("uses starts_with — a folder with `_` doesn't accidentally delete siblings", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const a = await createDiagram(sql, { workspaceId: ws.id, slug: "a", name: "A", engine: "mermaid", kind: "graph" });
    const b = await createDiagram(sql, { workspaceId: ws.id, slug: "b", name: "B", engine: "mermaid", kind: "graph" });
    await dbMoveDiagram(sql, a.id, "my_folder");
    await sql`UPDATE diagrams SET parent_path = 'myXfolder' WHERE id = ${b.id}`;

    const n = await dbDeleteFolder(sql, ws.id, "my_folder", true);
    expect(n).toBe(1);

    const list = await listDiagrams(sql, ws.id);
    expect(list.map((d) => d.name)).toEqual(["B"]); // sibling preserved
  });

  it("rejects invalid folder paths (validation layer)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(dbDeleteFolder(sql, ws.id, "", true)).rejects.toThrow(/invalid folder/);
    await expect(dbDeleteFolder(sql, ws.id, "../escape", true)).rejects.toThrow(/invalid folder/);
  });
});

describe("dbListEmptyFolders + dbSetEmptyFolders round-trip", () => {
  it("starts empty on a fresh workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    expect(await dbListEmptyFolders(sql, ws.id)).toEqual([]);
  });

  it("set then list returns the list (preserves order)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await dbSetEmptyFolders(sql, ws.id, ["alpha", "beta/v2", "gamma"]);
    expect(await dbListEmptyFolders(sql, ws.id)).toEqual(["alpha", "beta/v2", "gamma"]);
  });

  it("deduplicates on write", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await dbSetEmptyFolders(sql, ws.id, ["alpha", "alpha", "beta", "alpha"]);
    expect(await dbListEmptyFolders(sql, ws.id)).toEqual(["alpha", "beta"]);
  });

  it("rejects an invalid path inside the list (atomic: no partial write)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await dbSetEmptyFolders(sql, ws.id, ["existing"]);
    await expect(
      dbSetEmptyFolders(sql, ws.id, ["valid", "../escape", "alsovalid"]),
    ).rejects.toThrow(/invalid folder in emptyFolders/);
    // Untouched.
    expect(await dbListEmptyFolders(sql, ws.id)).toEqual(["existing"]);
  });

  it("preserves other keys in workspaces.settings (doesn't clobber)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Seed an unrelated settings key directly.
    await sql`UPDATE workspaces SET settings = ${sql.json({ theme: "dark", unrelated: { keep: true } })} WHERE id = ${ws.id}`;
    await dbSetEmptyFolders(sql, ws.id, ["new"]);
    const row = await sql`SELECT settings FROM workspaces WHERE id = ${ws.id}`;
    const settings = row[0]!.settings as Record<string, unknown>;
    expect(settings.theme).toBe("dark");
    expect(settings.unrelated).toEqual({ keep: true });
    expect(settings.emptyFolders).toEqual(["new"]);
  });

  it("set to empty array clears the list", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await dbSetEmptyFolders(sql, ws.id, ["a", "b"]);
    await dbSetEmptyFolders(sql, ws.id, []);
    expect(await dbListEmptyFolders(sql, ws.id)).toEqual([]);
  });
});
