import JSZip from "jszip";
import {
  contentTypesXml,
  rootRelsXml,
  documentXml,
  documentRelsXml,
  pagesIndexXml,
  pagesRelsXml,
} from "../vsdx/opc-templates";

// Hard cap on how long `rsvg-convert` may run before we kill it. Image
// rasterization is generally slower than DOT layout, but a pathological SVG
// could still hang the request indefinitely.
const RSVG_TIMEOUT_MS = Number(process.env.PRIXMAVIZ_RSVG_TIMEOUT_MS) || 15_000;

/**
 * Build a minimal vsdx containing exactly one page with a single image shape
 * (the rasterized SVG). This is the catch-all for engines without a graph IR.
 */
export async function writeVsdxFromSvg(svg: string): Promise<Uint8Array> {
  const pngBytes = await rasterizeSvgToPng(svg);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml({
    defaultExtensions: [{ ext: "png", type: "image/png" }],
  }));
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("visio/document.xml", documentXml());
  zip.file("visio/_rels/document.xml.rels", documentRelsXml());
  zip.file("visio/pages/pages.xml", pagesIndexXml());
  zip.file("visio/pages/_rels/pages.xml.rels", pagesRelsXml());
  zip.file("visio/pages/page1.xml", pageWithImageXml());
  zip.file("visio/media/image1.png", pngBytes);
  zip.file("visio/pages/_rels/page1.xml.rels", pageRels());

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function rasterizeSvgToPng(svg: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(RSVG_TIMEOUT_MS);
  const proc = Bun.spawn(["rsvg-convert", "-f", "png"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  let stdout: ArrayBuffer;
  let stderr: string;
  let exit: number;
  try {
    proc.stdin.write(svg);
    await proc.stdin.end();
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
    ]);
    exit = await proc.exited;
  } catch (e) {
    if (signal.aborted) {
      throw new Error(`rsvg-convert timed out after ${RSVG_TIMEOUT_MS}ms`);
    }
    if (e instanceof Error && (e.name === "AbortError" || /aborted|timed out/i.test(e.message))) {
      throw new Error(`rsvg-convert timed out after ${RSVG_TIMEOUT_MS}ms`);
    }
    throw e;
  }
  if (signal.aborted) {
    throw new Error(`rsvg-convert timed out after ${RSVG_TIMEOUT_MS}ms`);
  }
  if (exit !== 0) throw new Error(`rsvg-convert failed: ${stderr.slice(0, 200)}`);
  return new Uint8Array(stdout);
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
