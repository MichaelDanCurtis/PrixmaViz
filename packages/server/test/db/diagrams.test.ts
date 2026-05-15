import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import {
  createDiagram,
  getDiagram,
  listDiagrams,
  updateDiagram,
  deleteDiagram,
  setDiagramPublic,
  getPublicDiagram,
} from "../../src/db/diagrams";
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

describe("diagrams repo", () => {
  it("createDiagram persists a new row scoped to workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "test",
      name: "Test",
      engine: "mermaid",
      kind: "graph",
    });
    expect(d.id).toMatch(/^d_[a-z0-9]+$/);
    expect(d.workspaceId).toBe(ws.id);
    expect(d.slug).toBe("test");
  });

  it("listDiagrams scopes by workspace (cross-tenant isolation)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    await createDiagram(sql, { workspaceId: a.id, slug: "a1", name: "A1", engine: "mermaid", kind: "graph" });
    await createDiagram(sql, { workspaceId: b.id, slug: "b1", name: "B1", engine: "plantuml", kind: "passthrough" });
    const aList = await listDiagrams(sql, a.id);
    const bList = await listDiagrams(sql, b.id);
    expect(aList).toHaveLength(1);
    expect(aList[0]?.slug).toBe("a1");
    expect(bList).toHaveLength(1);
    expect(bList[0]?.slug).toBe("b1");
  });

  it("getDiagram returns null for diagrams in other workspaces (no leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: a.id, slug: "secret", name: "S", engine: "mermaid", kind: "graph" });
    const fetchedFromB = await getDiagram(sql, b.id, d.id);
    expect(fetchedFromB).toBeNull();
  });

  it("updateDiagram patches ir/dsl/svg", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u", name: "U", engine: "mermaid", kind: "graph" });
    await updateDiagram(sql, ws.id, d.id, { dsl: "flowchart LR; A-->B", svg: "<svg/>" });
    const fetched = await getDiagram(sql, ws.id, d.id);
    expect(fetched?.dsl).toBe("flowchart LR; A-->B");
    expect(fetched?.svg).toBe("<svg/>");
  });

  it("updateDiagram returns null for diagrams in other workspaces (no leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: a.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    const result = await updateDiagram(sql, b.id, d.id, { name: "renamed" });
    expect(result).toBeNull();
    // verify original row untouched
    const original = await getDiagram(sql, a.id, d.id);
    expect(original?.name).toBe("X");
  });

  it("setDiagramPublic toggles public_view", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "p", name: "P", engine: "mermaid", kind: "graph" });
    await setDiagramPublic(sql, ws.id, d.id, true);
    const pub = await getPublicDiagram(sql, d.id);
    expect(pub?.id).toBe(d.id);
    await setDiagramPublic(sql, ws.id, d.id, false);
    const stillPub = await getPublicDiagram(sql, d.id);
    expect(stillPub).toBeNull();
  });

  it("deleteDiagram removes the row", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "d", name: "D", engine: "mermaid", kind: "graph" });
    await deleteDiagram(sql, ws.id, d.id);
    expect(await getDiagram(sql, ws.id, d.id)).toBeNull();
  });

  it("createDiagram persists and reads back bytes for a binary diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const sample = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb]);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "v",
      name: "V",
      engine: "vsdx",
      kind: "binary",
      bytes: sample,
    });
    expect(d.bytes).toBeInstanceOf(Uint8Array);
    expect(d.bytes!.length).toBe(6);
    expect(d.bytes![0]).toBe(0x50);

    const fetched = await getDiagram(sql, ws.id, d.id);
    expect(fetched!.bytes!.length).toBe(6);
    expect(fetched!.bytes![3]).toBe(0x04);
  });
});
