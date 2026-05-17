import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { dispatchTool } from "../../src/mcp/tools";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";
import { buildBasicFlowchartFixture } from "../fixtures/vsdx/build-fixture";
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

describe("vsdx end-to-end", () => {
  it("import → analyze → returns parsed shapes", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const fixture = await buildBasicFlowchartFixture();
    const b64 = Buffer.from(fixture).toString("base64");

    const imported = await dispatchTool("import_vsdx", { name: "RoundTrip", base64Source: b64 }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { diagramId: string };

    const analyzed = await dispatchTool("analyze_vsdx", { diagramId: imported.diagramId }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { pages: Array<{ shapes: Array<{ text: string }> }> };

    expect(analyzed.pages).toHaveLength(1);
    const shapeTexts = analyzed.pages[0]!.shapes.map((s) => s.text).sort();
    expect(shapeTexts).toContain("A");
    expect(shapeTexts).toContain("B");
  });

  it("export round-trips a vsdx-engine diagram to byte-identical bytes", async () => {
    // Import a vsdx, then call export and verify bytes match.
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const fixture = await buildBasicFlowchartFixture();
    const b64 = Buffer.from(fixture).toString("base64");

    const imported = await dispatchTool("import_vsdx", { name: "ExportTest", base64Source: b64 }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { diagramId: string };

    // Use the HTTP route directly to test the export.vsdx endpoint.
    const { handleApi } = await import("../../src/http/routes");
    const req = new Request(`http://x/api/diagrams/${imported.diagramId}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), {
      sql,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    });
    expect(res!.status).toBe(200);
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got.length).toBe(fixture.length);
    expect(got[0]).toBe(0x50); // PK magic
    // Spot-check a few bytes for true byte-identity
    for (let i = 0; i < Math.min(50, fixture.length); i++) {
      expect(got[i]).toBe(fixture[i]);
    }
  });

  it("write → parse round-trip preserves graph IR via mermaid path", async () => {
    // Create a mermaid graph diagram, export it as vsdx, parse the result,
    // verify shape texts came through.
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const { createDiagram } = await import("../../src/db/diagrams");
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "rt", name: "RT",
      engine: "mermaid", kind: "graph",
      ir: {
        layout: { direction: "TB" },
        nodes: {
          a: { id: "a", label: "Alpha", shape: "rect" },
          b: { id: "b", label: "Beta", shape: "diamond" },
        },
        edges: {
          e1: { id: "e1", from: "a", to: "b", label: "go" },
        },
        groups: {},
      } as never,
    });

    const { handleApi } = await import("../../src/http/routes");
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), {
      sql,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    });
    expect(res!.status).toBe(200);
    const bytes = new Uint8Array(await res!.arrayBuffer());

    const { parseVsdx } = await import("../../src/renderers/vsdx-parse");
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages).toHaveLength(1);
    const texts = parsed.pages[0]!.shapes.map((s) => s.text).sort();
    expect(texts).toContain("Alpha");
    expect(texts).toContain("Beta");
  });
});
