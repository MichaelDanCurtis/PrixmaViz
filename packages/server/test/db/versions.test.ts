import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import {
  snapshotVersion,
  listVersions,
  getVersion,
} from "../../src/db/versions";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

describe("diagram_versions repo", () => {
  it("snapshotVersion + listVersions round-trip", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "v1", name: "V1", engine: "mermaid", kind: "passthrough",
      dsl: "flowchart LR; A-->B",
    });
    await snapshotVersion(sql, {
      diagramId: d.id, engine: d.engine, kind: d.kind, source: "flowchart LR; A-->B",
    });
    await snapshotVersion(sql, {
      diagramId: d.id, engine: d.engine, kind: d.kind, source: "flowchart LR; A-->B-->C",
    });
    const versions = await listVersions(sql, d.id);
    expect(versions.length).toBe(2);
    // newest first
    expect(versions[0]!.source).toBe("flowchart LR; A-->B-->C");
    expect(versions[1]!.source).toBe("flowchart LR; A-->B");
  });

  it("getVersion returns null for unknown id", async () => {
    const sql = getDb(TEST_DB_URL);
    const v = await getVersion(sql, "v_nonexistent");
    expect(v).toBeNull();
  });

  it("ON DELETE CASCADE removes versions when diagram is deleted", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "cas", name: "Cas", engine: "mermaid", kind: "passthrough",
      dsl: "flowchart LR; A-->B",
    });
    await snapshotVersion(sql, {
      diagramId: d.id, engine: d.engine, kind: d.kind, source: "x",
    });
    expect((await listVersions(sql, d.id)).length).toBe(1);
    await sql`DELETE FROM diagrams WHERE id = ${d.id}`;
    expect((await listVersions(sql, d.id)).length).toBe(0);
  });

  it("source can be null for graph-kind snapshots", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "g", name: "G", engine: "mermaid", kind: "graph",
    });
    const v = await snapshotVersion(sql, {
      diagramId: d.id, engine: d.engine, kind: d.kind, source: null,
    });
    expect(v.source).toBeNull();
  });
});
