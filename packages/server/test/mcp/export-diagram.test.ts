import { describe, expect, it } from "bun:test";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram, updateDiagram } from "../../src/db/diagrams";
import { dispatchTool } from "../../src/mcp/tools";
import { setupTestDb } from "../helpers/db";

const db = setupTestDb();

// Magic-number fixtures returned by the stubbed Kroki client. These match
// the real format signatures the test assertions check for.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const SVG_BYTES = new TextEncoder().encode("<svg/>");

const fakeKroki = {
  renderSvg: async () => "<svg/>",
  renderBinary: async (_engine: string, _dsl: string, format: "svg" | "png" | "jpeg") => {
    if (format === "png") return PNG_BYTES;
    if (format === "jpeg") return JPEG_BYTES;
    return SVG_BYTES;
  },
} as never;

const fakeCtx = (sql: ReturnType<typeof db.sql>, wsId: string) => ({
  sql,
  workspaceId: wsId,
  kroki: fakeKroki,
  hub: { broadcast: () => {} } as never,
});

type ExportResult = {
  diagramId: string;
  format: string;
  mimeType: string;
  base64: string;
  byteCount: number;
  suggestedFilename: string;
};

describe("MCP export_diagram", () => {
  it("returns SVG bytes for a passthrough (plantuml) diagram", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "seq",
      name: "Sequence",
      engine: "plantuml",
      kind: "passthrough",
      dsl: "@startuml\nAlice -> Bob: hi\n@enduml",
    });
    const result = (await dispatchTool(
      "export_diagram",
      { diagramId: d.id, format: "svg" },
      fakeCtx(sql, ws.id),
    )) as ExportResult;
    expect(result.format).toBe("svg");
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.suggestedFilename).toBe("seq.svg");
    const decoded = new TextDecoder().decode(Buffer.from(result.base64, "base64"));
    expect(decoded.startsWith("<svg") || decoded.startsWith("<?xml")).toBe(true);
  });

  it("returns PNG bytes with the PNG magic prefix", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "seq",
      name: "Sequence",
      engine: "plantuml",
      kind: "passthrough",
      dsl: "@startuml\nAlice -> Bob: hi\n@enduml",
    });
    const result = (await dispatchTool(
      "export_diagram",
      { diagramId: d.id, format: "png" },
      fakeCtx(sql, ws.id),
    )) as ExportResult;
    expect(result.format).toBe("png");
    expect(result.mimeType).toBe("image/png");
    expect(result.suggestedFilename).toBe("seq.png");
    const decoded = Buffer.from(result.base64, "base64");
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
    expect(decoded[2]).toBe(0x4e);
    expect(decoded[3]).toBe(0x47);
  });

  it("returns JPEG bytes with the JPEG magic prefix and .jpg extension", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "seq",
      name: "Sequence",
      engine: "plantuml",
      kind: "passthrough",
      dsl: "@startuml\nAlice -> Bob: hi\n@enduml",
    });
    const result = (await dispatchTool(
      "export_diagram",
      { diagramId: d.id, format: "jpeg" },
      fakeCtx(sql, ws.id),
    )) as ExportResult;
    expect(result.format).toBe("jpeg");
    expect(result.mimeType).toBe("image/jpeg");
    // .jpeg -> .jpg per convention
    expect(result.suggestedFilename).toBe("seq.jpg");
    expect(result.suggestedFilename.endsWith(".jpeg")).toBe(false);
    const decoded = Buffer.from(result.base64, "base64");
    expect(decoded[0]).toBe(0xff);
    expect(decoded[1]).toBe(0xd8);
    expect(decoded[2]).toBe(0xff);
  });

  it("exports a graph (mermaid) diagram by re-emitting DSL via the IR renderer", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "m",
      name: "M",
      engine: "mermaid",
      kind: "graph",
      ir: {
        layout: { direction: "TB" },
        nodes: { a: { id: "a", label: "A", shape: "rect" } },
        edges: {},
        groups: {},
      } as never,
    });
    const result = (await dispatchTool(
      "export_diagram",
      { diagramId: d.id, format: "png" },
      fakeCtx(sql, ws.id),
    )) as ExportResult;
    expect(result.format).toBe("png");
    expect(result.suggestedFilename).toBe("m.png");
    const decoded = Buffer.from(result.base64, "base64");
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
  });

  it("returns the stored svg for a vsdx-engine diagram when format is svg", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const sample = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc]);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "v",
      name: "V",
      engine: "vsdx",
      kind: "binary",
      bytes: sample,
    });
    await updateDiagram(sql, ws.id, d.id, { svg: "<svg id='vsdx-cached'/>" });
    const result = (await dispatchTool(
      "export_diagram",
      { diagramId: d.id, format: "svg" },
      fakeCtx(sql, ws.id),
    )) as ExportResult;
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.suggestedFilename).toBe("v.svg");
    const decoded = new TextDecoder().decode(Buffer.from(result.base64, "base64"));
    expect(decoded).toContain("vsdx-cached");
  });

  it("refuses to export a vsdx-engine diagram as png/jpeg (directs to export_vsdx)", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const sample = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc]);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "v",
      name: "V",
      engine: "vsdx",
      kind: "binary",
      bytes: sample,
    });
    await expect(
      dispatchTool(
        "export_diagram",
        { diagramId: d.id, format: "png" },
        fakeCtx(sql, ws.id),
      ),
    ).rejects.toThrow(/vsdx-engine diagrams only support svg/);
  });

  it("throws on unknown diagramId", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool(
        "export_diagram",
        { diagramId: "nope", format: "svg" },
        fakeCtx(sql, ws.id),
      ),
    ).rejects.toThrow(/diagram not found/);
  });

  it("rejects an unsupported format value", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "seq",
      name: "Sequence",
      engine: "plantuml",
      kind: "passthrough",
      dsl: "@startuml\nAlice -> Bob: hi\n@enduml",
    });
    await expect(
      dispatchTool(
        "export_diagram",
        { diagramId: d.id, format: "pdf" },
        fakeCtx(sql, ws.id),
      ),
    ).rejects.toThrow(/Invalid value for format/);
  });
});
