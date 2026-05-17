import { describe, expect, it } from "bun:test";
import { setupTestDb } from "../helpers/db";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import {
  snapshotVersion,
  listVersions,
  getVersion,
} from "../../src/db/versions";

const db = setupTestDb();

describe("diagram_versions repo", () => {
  it("snapshotVersion + listVersions round-trip", async () => {
    const sql = db.sql();
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
    expect(versions[0]!.source).toBe("flowchart LR; A-->B-->C");
    expect(versions[1]!.source).toBe("flowchart LR; A-->B");
  });

  it("getVersion returns null for unknown id", async () => {
    const sql = db.sql();
    const v = await getVersion(sql, "v_nonexistent");
    expect(v).toBeNull();
  });

  it("ON DELETE CASCADE removes versions when diagram is deleted", async () => {
    const sql = db.sql();
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
    const sql = db.sql();
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
