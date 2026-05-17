import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { dispatchTool } from "../../src/mcp/tools";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

beforeEach(() => {
  setVsdxRendererForTests(new VsdxRenderer({
    baseUrl: "http://stub",
    fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
  }));
});
afterEach(() => {
  setVsdxRendererForTests(undefined);
});

const VSDX_B64 = Buffer.from(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc])).toString("base64");

describe("MCP import_vsdx", () => {
  it("creates a vsdx diagram from base64 input", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const result = await dispatchTool("import_vsdx", {
      name: "Sample",
      base64Source: VSDX_B64,
    }, {
      sql,
      workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { diagramId: string; slug: string };
    expect(result.diagramId).toMatch(/^d_/);
    expect(result.slug).toBe("sample");
  });

  it("rejects base64 that decodes to non-vsdx bytes", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const notVsdx = Buffer.from(new Uint8Array([0, 0, 0, 0])).toString("base64");
    await expect(
      dispatchTool("import_vsdx", { name: "X", base64Source: notVsdx }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/not a valid .vsdx/);
  });
});
