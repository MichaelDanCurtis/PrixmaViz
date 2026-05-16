import { describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { dispatchTool } from "../../src/mcp/tools";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

const fakeCtx = (sql: ReturnType<typeof db.sql>, wsId: string) => ({
  sql, workspaceId: wsId,
  kroki: { renderSvg: async () => "<svg/>" } as never,
  hub: { broadcast: () => {} } as never,
});

describe("MCP export_vsdx", () => {
  it("returns base64 vsdx for a graph (mermaid) diagram", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "graph",
      ir: {
        layout: { direction: "TB" },
        nodes: { a: { id: "a", label: "A", shape: "rect" } },
        edges: {},
        groups: {},
      } as never,
    });
    const result = await dispatchTool("export_vsdx", { diagramId: d.id }, fakeCtx(sql, ws.id)) as {
      base64Source: string;
      byteCount: number;
      suggestedFilename: string;
      strategy: string;
    };
    expect(result.byteCount).toBeGreaterThan(0);
    expect(result.suggestedFilename).toBe("m.vsdx");
    expect(result.strategy).toBe("structured");
    // PK ZIP magic in the first 4 decoded bytes
    const decoded = Buffer.from(result.base64Source, "base64");
    expect(decoded[0]).toBe(0x50);
    expect(decoded[1]).toBe(0x4b);
  });

  it("returns verbatim bytes for a vsdx-engine diagram", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const sample = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc]);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "v", name: "V",
      engine: "vsdx", kind: "binary", bytes: sample,
    });
    const result = await dispatchTool("export_vsdx", { diagramId: d.id }, fakeCtx(sql, ws.id)) as {
      base64Source: string;
      byteCount: number;
      strategy: string;
    };
    expect(result.strategy).toBe("verbatim");
    expect(result.byteCount).toBe(sample.length);
  });

  it("throws if diagram not found", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("export_vsdx", { diagramId: "nope" }, fakeCtx(sql, ws.id))
    ).rejects.toThrow(/diagram not found/);
  });
});
