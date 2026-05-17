import { describe, expect, it } from "bun:test";
import { setupTestDb } from "../helpers/db";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import {
  addAnnotation,
  listAnnotations,
  updateAnnotation,
  deleteAnnotation,
} from "../../src/db/annotations";

const db = setupTestDb();

describe("annotations repo", () => {
  it("addAnnotation + listAnnotations", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, {
      id: "ann_test1",
      kind: "tag",
      text: "rename",
      targetNodes: ["a"],
      createdAt: new Date().toISOString(),
    });
    const list = await listAnnotations(sql, d.id, { includeResolved: true });
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("rename");
  });

  it("listAnnotations defaults to excluding resolved", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, { id: "ann_r", kind: "tag", createdAt: "2026-01-01", resolvedAt: "2026-01-02" });
    await addAnnotation(sql, d.id, { id: "ann_open", kind: "tag", createdAt: "2026-01-01" });
    const open = await listAnnotations(sql, d.id, { includeResolved: false });
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBe("ann_open");
  });

  it("updateAnnotation patches fields, kind+createdAt locked", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, { id: "ann_u", kind: "tag", text: "old", createdAt: "2026-01-01" });
    await updateAnnotation(sql, d.id, "ann_u", {
      text: "new",
      kind: "pin" as never,
      createdAt: "1970-01-01" as never,
    });
    const list = await listAnnotations(sql, d.id, { includeResolved: true });
    expect(list[0]?.text).toBe("new");
    expect(list[0]?.kind).toBe("tag");
    expect(list[0]?.createdAt.slice(0, 10)).toBe("2026-01-01");
  });

  it("deleteAnnotation removes", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, { id: "ann_d", kind: "tag", createdAt: "2026-01-01" });
    await deleteAnnotation(sql, d.id, "ann_d");
    expect(await listAnnotations(sql, d.id, { includeResolved: true })).toEqual([]);
  });
});
