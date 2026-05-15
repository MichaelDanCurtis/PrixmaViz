import JSZip from "jszip";

/**
 * Build a minimal vsdx containing exactly one page with a single image shape
 * (the rasterized SVG). This is the catch-all for engines without a graph IR.
 */
export async function writeVsdxFromSvg(svg: string): Promise<Uint8Array> {
  const pngBytes = await rasterizeSvgToPng(svg);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes());
  zip.file("_rels/.rels", rootRels());
  zip.file("visio/document.xml", documentXml());
  zip.file("visio/_rels/document.xml.rels", documentRels());
  zip.file("visio/pages/pages.xml", pagesIndex());
  zip.file("visio/pages/_rels/pages.xml.rels", pagesRels());
  zip.file("visio/pages/page1.xml", pageWithImageXml());
  zip.file("visio/media/image1.png", pngBytes);
  zip.file("visio/pages/_rels/page1.xml.rels", pageRels());

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function rasterizeSvgToPng(svg: string): Promise<Uint8Array> {
  const proc = Bun.spawn(["rsvg-convert", "-f", "png"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(svg);
  await proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`rsvg-convert failed: ${stderr.slice(0, 200)}`);
  return new Uint8Array(stdout);
}

function contentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
</Types>`;
}

function rootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`;
}

function documentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve"><DocumentSettings/></VisioDocument>`;
}

function documentRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`;
}

function pagesIndex(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Page ID="0" Name="Page-1"><PageSheet/></Page>
</Pages>`;
}

function pagesRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

function pageRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;
}

function pageWithImageXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
              xml:space="preserve">
  <Shapes>
    <Shape ID="1" Type="Foreign">
      <Cell N="PinX" V="4.25"/>
      <Cell N="PinY" V="5.5"/>
      <Cell N="Width" V="8.5"/>
      <Cell N="Height" V="11"/>
      <Cell N="LocPinX" V="4.25"/>
      <Cell N="LocPinY" V="5.5"/>
      <ForeignData ForeignType="Bitmap" CompressionType="PNG">
        <Rel r:id="rId1"/>
      </ForeignData>
    </Shape>
  </Shapes>
</PageContents>`;
}
