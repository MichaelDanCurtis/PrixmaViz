import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { emptyGraphIR, type Tile } from "@prixmaviz/shared";
import { runMigrations } from "../../../src/db/migrate";
import { closeDb, getDb } from "../../../src/db/client";
import { createWorkspace, getWorkspace, updateWorkspaceTiles } from "../../../src/db/workspaces";
import { addAnnotation, listAnnotations } from "../../../src/db/annotations";
import { createDiagram, getDiagram, getDiagramBySlug, updateDiagram } from "../../../src/db/diagrams";
import { dispatchTool } from "../../../src/mcp/tools";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS diagram_versions CASCADE`;
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

// Captures every payload broadcast — lets tests assert that mutating ops
// emit a workspace update even with no live web clients connected.
function makeRecordingHub() {
  const events: { workspaceId: string | null; msg: unknown }[] = [];
  return {
    hub: {
      broadcast: (workspaceId: string | null, msg: unknown) => {
        events.push({ workspaceId, msg });
      },
    } as never,
    events,
  };
}

function ctx(sql: ReturnType<typeof getDb>, workspaceId: string, hub?: never) {
  return {
    sql,
    workspaceId,
    kroki: {
      renderSvg: async () => "<svg/>",
      renderBinary: async () => new Uint8Array(),
    } as never,
    hub: hub ?? ({ broadcast: () => {} } as never),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// delete_diagram
// ───────────────────────────────────────────────────────────────────────────

describe("delete_diagram", () => {
  it("cascade:true (default) removes the diagram, its annotations, and its tiles in one operation", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "to-delete",
      name: "To Delete",
      engine: "mermaid",
      kind: "graph",
      ir: emptyGraphIR(),
    });

    // Seed 3 annotations.
    await addAnnotation(sql, d.id, {
      id: "ann_1", kind: "comment", text: "first", createdAt: new Date().toISOString(),
    } as never);
    await addAnnotation(sql, d.id, {
      id: "ann_2", kind: "comment", text: "second", createdAt: new Date().toISOString(),
    } as never);
    await addAnnotation(sql, d.id, {
      id: "ann_3", kind: "comment", text: "third", createdAt: new Date().toISOString(),
    } as never);

    // Seed 2 tiles referencing the diagram + 1 tile referencing an unrelated diagram.
    const otherDiagram = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "other", name: "Other", engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    const tiles: Tile[] = [
      { id: "t_a", diagramId: d.id, diagramSlug: d.slug, x: 0, y: 0, w: 200, h: 100, z: 1 },
      { id: "t_b", diagramId: d.id, diagramSlug: d.slug, x: 250, y: 0, w: 200, h: 100, z: 2 },
      { id: "t_c", diagramId: otherDiagram.id, diagramSlug: otherDiagram.slug, x: 0, y: 200, w: 200, h: 100, z: 3 },
    ];
    await updateWorkspaceTiles(sql, ws.id, tiles);

    const { hub, events } = makeRecordingHub();
    const result = await dispatchTool(
      "delete_diagram",
      { slug: "to-delete" },
      ctx(sql, ws.id, hub),
    ) as {
      ok: boolean;
      deletedId: string;
      deletedTileIds: string[];
      deletedAnnotationIds: string[];
    };

    expect(result.ok).toBe(true);
    expect(result.deletedId).toBe(d.id);
    expect(result.deletedTileIds.sort()).toEqual(["t_a", "t_b"]);
    expect(result.deletedAnnotationIds.sort()).toEqual(["ann_1", "ann_2", "ann_3"]);

    // Diagram + annotations gone from DB.
    expect(await getDiagram(sql, ws.id, d.id)).toBeNull();
    expect(await listAnnotations(sql, d.id, { includeResolved: true })).toEqual([]);

    // Only the unrelated tile survives in the workspace.
    const after = await getWorkspace(sql, ws.id);
    expect(after?.tiles.map((t) => t.id)).toEqual(["t_c"]);

    // Workspace broadcast went out.
    const wsEvents = events.filter((e) => (e.msg as { type?: string }).type === "workspace");
    expect(wsEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("by diagramId resolves and deletes the same way slug does", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "by-id", name: "By Id", engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "delete_diagram",
      { diagramId: d.id },
      ctx(sql, ws.id),
    ) as { ok: boolean; deletedId: string };

    expect(result.ok).toBe(true);
    expect(result.deletedId).toBe(d.id);
    expect(await getDiagram(sql, ws.id, d.id)).toBeNull();
  });

  it("cascade:false with NO orphans deletes cleanly", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "orphan-free", name: "Orphan-free", engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    const result = await dispatchTool(
      "delete_diagram",
      { slug: "orphan-free", cascade: false },
      ctx(sql, ws.id),
    ) as { ok: boolean; deletedTileIds: string[]; deletedAnnotationIds: string[] };
    expect(result.ok).toBe(true);
    expect(result.deletedTileIds).toEqual([]);
    expect(result.deletedAnnotationIds).toEqual([]);
    expect(await getDiagram(sql, ws.id, d.id)).toBeNull();
  });

  it("cascade:false WITH orphans refuses to delete and returns a structured error", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "has-orphans", name: "Has Orphans", engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    await addAnnotation(sql, d.id, {
      id: "ann_x", kind: "comment", text: "blocker", createdAt: new Date().toISOString(),
    } as never);

    await expect(
      dispatchTool("delete_diagram", { slug: "has-orphans", cascade: false }, ctx(sql, ws.id)),
    ).rejects.toThrow(/cascade: true/);

    // Diagram still exists; refusal must be atomic.
    expect(await getDiagram(sql, ws.id, d.id)).not.toBeNull();
  });

  it("returns 404-style error for an unknown diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("delete_diagram", { slug: "does-not-exist" }, ctx(sql, ws.id)),
    ).rejects.toThrow(/diagram not found/);
    await expect(
      dispatchTool("delete_diagram", { diagramId: "d_nopenope" }, ctx(sql, ws.id)),
    ).rejects.toThrow(/diagram not found/);
  });

  it("rejects calls that supply neither slug nor diagramId (oneOf gate)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("delete_diagram", {}, ctx(sql, ws.id)),
    ).rejects.toThrow(/exactly one of slug, diagramId/);
  });

  it("rejects calls that supply BOTH slug and diagramId (oneOf gate)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "both", name: "Both", engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    await expect(
      dispatchTool("delete_diagram", { slug: d.slug, diagramId: d.id }, ctx(sql, ws.id)),
    ).rejects.toThrow(/Conflicting parameters/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// duplicate_diagram
// ───────────────────────────────────────────────────────────────────────────

describe("duplicate_diagram", () => {
  it("clones a graph diagram with a fresh ID + slug but identical IR/DSL", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const ir = {
      ...emptyGraphIR(),
      nodes: { n1: { id: "n1", label: "Source", shape: "rect" } },
    };
    const source = await createDiagram(sql, {
      workspaceId: ws.id, slug: "source", name: "Source", engine: "mermaid", kind: "graph",
      ir,
      dsl: undefined,
    });
    // Tag the source so we can verify tag merging.
    await updateDiagram(sql, ws.id, source.id, { meta: { tags: ["original"] } });

    const result = await dispatchTool(
      "duplicate_diagram",
      { sourceSlug: "source", newName: "Source Copy", tags: ["copy"] },
      ctx(sql, ws.id),
    ) as { diagramId: string; slug: string; name: string };

    expect(result.diagramId).not.toBe(source.id);
    expect(result.slug).toBe("source-copy");
    expect(result.name).toBe("Source Copy");

    // IR matches the source.
    const clone = await getDiagram(sql, ws.id, result.diagramId);
    expect(clone).not.toBeNull();
    expect(clone!.ir).toEqual(ir);
    expect(clone!.engine).toBe(source.engine);
    expect(clone!.kind).toBe(source.kind);

    // Tags are the union of source ∪ caller-supplied.
    expect((clone!.meta as { tags?: string[] }).tags).toEqual(["original", "copy"]);

    // SVG was freshly rendered (got a new value, not pointer-copied).
    expect(clone!.svg).toBe("<svg/>");
  });

  it("by sourceDiagramId resolves the same way sourceSlug does", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const source = await createDiagram(sql, {
      workspaceId: ws.id, slug: "via-id", name: "Via Id", engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    const result = await dispatchTool(
      "duplicate_diagram",
      { sourceDiagramId: source.id, newName: "Via Id Clone" },
      ctx(sql, ws.id),
    ) as { diagramId: string; slug: string };
    expect(result.diagramId).not.toBe(source.id);
    expect(result.slug).toBe("via-id-clone");
  });

  it("preserveAnnotations:true copies annotation rows with fresh IDs", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const source = await createDiagram(sql, {
      workspaceId: ws.id, slug: "ann-source", name: "Ann Source",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    await addAnnotation(sql, source.id, {
      id: "ann_keep1", kind: "comment", text: "alpha",
      createdAt: new Date().toISOString(),
    } as never);
    await addAnnotation(sql, source.id, {
      id: "ann_keep2", kind: "highlight", text: "beta", color: "#ff0",
      createdAt: new Date().toISOString(),
    } as never);

    const result = await dispatchTool(
      "duplicate_diagram",
      { sourceSlug: "ann-source", newName: "Ann Copy", preserveAnnotations: true },
      ctx(sql, ws.id),
    ) as { diagramId: string };

    const cloneAnns = await listAnnotations(sql, result.diagramId, { includeResolved: true });
    expect(cloneAnns.length).toBe(2);
    // Fresh IDs — NEVER the source IDs.
    const cloneIds = cloneAnns.map((a) => a.id).sort();
    expect(cloneIds).not.toContain("ann_keep1");
    expect(cloneIds).not.toContain("ann_keep2");
    // But the content carried over.
    const texts = cloneAnns.map((a) => a.text).sort();
    expect(texts).toEqual(["alpha", "beta"]);

    // Source annotations are untouched.
    const sourceAnns = await listAnnotations(sql, source.id, { includeResolved: true });
    expect(sourceAnns.map((a) => a.id).sort()).toEqual(["ann_keep1", "ann_keep2"]);
  });

  it("preserveAnnotations:false (default) leaves the clone with zero annotations", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const source = await createDiagram(sql, {
      workspaceId: ws.id, slug: "no-ann-source", name: "No Ann Source",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    await addAnnotation(sql, source.id, {
      id: "ann_skip", kind: "comment", text: "drop me",
      createdAt: new Date().toISOString(),
    } as never);

    const result = await dispatchTool(
      "duplicate_diagram",
      { sourceSlug: "no-ann-source", newName: "No Ann Copy" },
      ctx(sql, ws.id),
    ) as { diagramId: string };

    expect(await listAnnotations(sql, result.diagramId, { includeResolved: true })).toEqual([]);
  });

  it("auto-suffixes the slug on collision (createDiagramWithUniqueSlug)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    // Pre-seed a diagram whose slug matches what `slugify(newName)` would
    // produce; the duplicate must avoid the collision via random suffix.
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "clash", name: "Clash",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    const source = await createDiagram(sql, {
      workspaceId: ws.id, slug: "src", name: "Src",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "duplicate_diagram",
      { sourceSlug: "src", newName: "Clash" },
      ctx(sql, ws.id),
    ) as { slug: string; diagramId: string };

    // Either the slug got a suffix or matched the source by some other path.
    // The contract is: the call succeeds AND the new slug differs from the
    // pre-existing "clash".
    expect(result.slug.startsWith("clash")).toBe(true);
    expect(result.slug).not.toBe("clash");
    expect(await getDiagramBySlug(sql, ws.id, "clash")).not.toBeNull(); // original survives
  });

  it("404s when the source can't be resolved", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool(
        "duplicate_diagram",
        { sourceSlug: "ghost", newName: "Ghost Copy" },
        ctx(sql, ws.id),
      ),
    ).rejects.toThrow(/source diagram not found/);
  });

  it("rejects calls with neither sourceSlug nor sourceDiagramId", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("duplicate_diagram", { newName: "Anon" }, ctx(sql, ws.id)),
    ).rejects.toThrow(/exactly one of sourceSlug, sourceDiagramId/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// load_diagram extension (A3-folded)
// ───────────────────────────────────────────────────────────────────────────

describe("load_diagram (extended)", () => {
  it("loads by `diagramId` (new path)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "by-id", name: "By Id",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "load_diagram",
      { diagramId: d.id },
      ctx(sql, ws.id),
    ) as { diagramId: string; slug: string };
    expect(result.diagramId).toBe(d.id);
    expect(result.slug).toBe("by-id");
  });

  it("loads by `slug` (existing path)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "by-slug", name: "By Slug",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "load_diagram",
      { slug: "by-slug" },
      ctx(sql, ws.id),
    ) as { diagramId: string };
    expect(result.diagramId).toBe(d.id);
  });

  it("still accepts the legacy `name` alias for slug (PR #22 compat)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "legacy", name: "Legacy",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "load_diagram",
      { name: "legacy" },
      ctx(sql, ws.id),
    ) as { diagramId: string };
    expect(result.diagramId).toBe(d.id);
  });

  it("`includeSvg: false` (default) omits the svg from the render payload", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "lean", name: "Lean",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "load_diagram",
      { slug: "lean" },
      ctx(sql, ws.id),
    ) as { render: { svg?: string; dsl: string } };
    expect(result.render.svg).toBeUndefined();
    // dsl is still returned so the response is useful.
    expect(typeof result.render.dsl).toBe("string");
  });

  it("`includeSvg: true` returns the rendered svg", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await createDiagram(sql, {
      workspaceId: ws.id, slug: "fat", name: "Fat",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });

    const result = await dispatchTool(
      "load_diagram",
      { slug: "fat", includeSvg: true },
      ctx(sql, ws.id),
    ) as { render: { svg: string } };
    expect(typeof result.render.svg).toBe("string");
    expect(result.render.svg.length).toBeGreaterThan(0);
  });

  it("rejects calls with NEITHER slug nor diagramId", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("load_diagram", {}, ctx(sql, ws.id)),
    ).rejects.toThrow(/Missing required parameter/);
  });

  it("rejects calls with BOTH slug AND diagramId (oneOf gate)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "both", name: "Both",
      engine: "mermaid", kind: "graph", ir: emptyGraphIR(),
    });
    await expect(
      dispatchTool(
        "load_diagram",
        { slug: d.slug, diagramId: d.id },
        ctx(sql, ws.id),
      ),
    ).rejects.toThrow(/Conflicting parameters/);
  });
});
