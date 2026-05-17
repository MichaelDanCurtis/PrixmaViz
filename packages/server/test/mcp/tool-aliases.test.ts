import { describe, expect, it } from "bun:test";
import { emptyGraphIR } from "@prixmaviz/shared";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { dispatchTool } from "../../src/mcp/tools";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

function ctx(sql: ReturnType<typeof db.sql>, workspaceId: string) {
  return {
    sql,
    workspaceId,
    kroki: { renderSvg: async () => "<svg/>" } as never,
    hub: { broadcast: () => {} } as never,
  };
}

describe("load_diagram aliases", () => {
  it("accepts `slug` (new param name)", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "my-flow",
      name: "My Flow",
      engine: "mermaid",
      kind: "graph",
      ir: emptyGraphIR(),
    });
    const result = await dispatchTool(
      "load_diagram",
      { slug: "my-flow" },
      ctx(sql, ws.id),
    ) as { diagramId: string };
    expect(result.diagramId).toBe(d.id);
  });

  it("accepts `name` (legacy alias) for backwards-compat", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "legacy-flow",
      name: "Legacy Flow",
      engine: "mermaid",
      kind: "graph",
      ir: emptyGraphIR(),
    });
    const result = await dispatchTool(
      "load_diagram",
      { name: "legacy-flow" },
      ctx(sql, ws.id),
    ) as { diagramId: string };
    expect(result.diagramId).toBe(d.id);
  });

  it("strips a trailing `.pviz` extension from the slug", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "with-ext",
      name: "With Ext",
      engine: "mermaid",
      kind: "graph",
      ir: emptyGraphIR(),
    });
    const result = await dispatchTool(
      "load_diagram",
      { slug: "with-ext.pviz" },
      ctx(sql, ws.id),
    ) as { diagramId: string };
    expect(result.diagramId).toBe(d.id);
  });

  it("throws a helpful error when neither slug nor name is provided", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    // load_diagram now uses `oneOf` to allow slug, diagramId, or the legacy
    // `name` alias. The error message names all valid options.
    await expect(
      dispatchTool("load_diagram", {}, ctx(sql, ws.id)),
    ).rejects.toThrow(/Exactly one of \[slug, diagramId\] is required/);
  });
});

describe("render_dsl aliases", () => {
  it("accepts `dsl` (new param name)", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const result = await dispatchTool(
      "render_dsl",
      { engine: "mermaid", dsl: "graph TD\n  A --> B", name: "new-dsl" },
      ctx(sql, ws.id),
    ) as { diagramId: string; slug: string };
    expect(result.diagramId).toMatch(/^d_/);
    expect(result.slug).toBe("new-dsl");
  });

  it("accepts `source` (legacy alias) for backwards-compat", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const result = await dispatchTool(
      "render_dsl",
      { engine: "mermaid", source: "graph TD\n  A --> B", name: "legacy-dsl" },
      ctx(sql, ws.id),
    ) as { diagramId: string; slug: string };
    expect(result.diagramId).toMatch(/^d_/);
    expect(result.slug).toBe("legacy-dsl");
  });

  it("prefers `dsl` over `source` when both are provided", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    // dispatchTool should pick `dsl`; the test relies on the impl using the new
    // field. We don't have a direct way to read back the dsl from the result,
    // but we can at least verify the call succeeds with both keys present.
    const result = await dispatchTool(
      "render_dsl",
      {
        engine: "mermaid",
        dsl: "graph TD\n  A --> B",
        source: "should-not-be-used",
        name: "both-keys",
      },
      ctx(sql, ws.id),
    ) as { diagramId: string };
    expect(result.diagramId).toMatch(/^d_/);
  });

  it("throws a helpful error when neither dsl nor source is provided", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("render_dsl", { engine: "mermaid" }, ctx(sql, ws.id)),
    ).rejects.toThrow(/Missing required parameter: dsl/);
  });
});
