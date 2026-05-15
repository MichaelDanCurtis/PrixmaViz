import { describe, expect, it } from "bun:test";
import { parseVsdx } from "../../src/renderers/vsdx-parse";
import { buildBasicFlowchartFixture } from "../fixtures/vsdx/build-fixture";

describe("parseVsdx", () => {
  it("extracts pages, shapes, connectors from basic flowchart", async () => {
    const bytes = await buildBasicFlowchartFixture();
    const result = await parseVsdx(bytes);
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0]!;
    expect(page.shapes).toHaveLength(2);
    const a = page.shapes.find((s) => s.text === "A")!;
    const b = page.shapes.find((s) => s.text === "B")!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.master).toBe("Process");
    expect(b.master).toBe("Process");
    expect(page.connectors).toHaveLength(1);
    const conn = page.connectors[0]!;
    expect(conn.from).toBe(a.id);
    expect(conn.to).toBe(b.id);
    expect(conn.text).toBe("go");
  });

  it("returns metadata title from docProps/core.xml", async () => {
    const bytes = await buildBasicFlowchartFixture();
    const result = await parseVsdx(bytes);
    expect(result.metadata.title).toBe("Basic Flowchart Fixture");
  });

  it("throws on non-zip input", async () => {
    await expect(parseVsdx(new Uint8Array([0, 0, 0]))).rejects.toThrow();
  });

  it("throws on zip missing visio/pages/pages.xml", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("readme.txt", "not a vsdx");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(parseVsdx(bytes)).rejects.toThrow(/missing visio\/pages/);
  });
});
