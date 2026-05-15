import JSZip from "jszip";

/**
 * Build a minimal .vsdx fixture in memory:
 * - 1 page "Page-1"
 * - 2 Process shapes labeled "A" (ID=1) and "B" (ID=2)
 * - 1 connector from A to B labeled "go" (ID=3)
 *
 * The XML structure mirrors what vsdx-parse.ts will read so the parser
 * round-trips this fixture cleanly. Real Visio files have more parts; we emit
 * only what the parser cares about plus the OPC scaffolding.
 */
export async function buildBasicFlowchartFixture(): Promise<Uint8Array> {
  const zip = new JSZip();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve"><DocumentSettings/></VisioDocument>`;

  const pagesIndex = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Page ID="0" Name="Page-1"><PageSheet/></Page>
</Pages>`;

  const page1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Shapes>
    <Shape ID="1" Type="Shape" Master="1" NameU="Process">
      <Cell N="PinX" V="1.5"/>
      <Cell N="PinY" V="5.0"/>
      <Cell N="Width" V="1.0"/>
      <Cell N="Height" V="0.75"/>
      <Text>A</Text>
    </Shape>
    <Shape ID="2" Type="Shape" Master="1" NameU="Process">
      <Cell N="PinX" V="3.5"/>
      <Cell N="PinY" V="5.0"/>
      <Cell N="Width" V="1.0"/>
      <Cell N="Height" V="0.75"/>
      <Text>B</Text>
    </Shape>
    <Shape ID="3" Type="Shape" Master="100">
      <Cell N="BeginX" V="0" F="PAR(PNT(Sheet.1!Connections.X1, Sheet.1!Connections.Y1))"/>
      <Cell N="BeginY" V="0" F="PAR(PNT(Sheet.1!Connections.X1, Sheet.1!Connections.Y1))"/>
      <Cell N="EndX" V="0" F="PAR(PNT(Sheet.2!Connections.X1, Sheet.2!Connections.Y1))"/>
      <Cell N="EndY" V="0" F="PAR(PNT(Sheet.2!Connections.X1, Sheet.2!Connections.Y1))"/>
      <Text>go</Text>
    </Shape>
  </Shapes>
</PageContents>`;

  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Basic Flowchart Fixture</dc:title>
  <dc:creator>PrixmaViz Test Fixture</dc:creator>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("visio/document.xml", documentXml);
  zip.file("visio/pages/pages.xml", pagesIndex);
  zip.file("visio/pages/page1.xml", page1);
  zip.file("docProps/core.xml", coreProps);

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
