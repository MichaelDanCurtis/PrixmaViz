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

  it("resolves pages via _rels (not positional)", async () => {
    // Build a vsdx with a page part named `mypage.xml` (non-canonical name)
    // referenced via rels. The old positional approach would miss it.
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    );
    zip.file(
      "visio/pages/pages.xml",
      `<?xml version="1.0"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Page ID="0" Name="Custom Page Name">
    <PageSheet/>
    <Rel r:id="rIdCustom"/>
  </Page>
</Pages>`,
    );
    zip.file(
      "visio/pages/_rels/pages.xml.rels",
      `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdCustom" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="mypage.xml"/>
</Relationships>`,
    );
    zip.file(
      "visio/pages/mypage.xml",
      `<?xml version="1.0"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
  <Shapes>
    <Shape ID="1" Type="Shape" NameU="Process">
      <Cell N="PinX" V="1"/><Cell N="PinY" V="1"/>
      <Cell N="Width" V="1"/><Cell N="Height" V="0.75"/>
      <Text>From rels</Text>
    </Shape>
  </Shapes>
</PageContents>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages.length).toBe(1);
    expect(parsed.pages[0]!.name).toBe("Custom Page Name");
    expect(parsed.pages[0]!.shapes.length).toBe(1);
    expect(parsed.pages[0]!.shapes[0]!.text).toBe("From rels");
  });
});
