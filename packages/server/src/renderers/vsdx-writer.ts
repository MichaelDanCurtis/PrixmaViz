import JSZip from "jszip";
import type { GraphIR, Node, Edge } from "@prixmaviz/shared";
import { mapShapeToMaster, ALL_MASTERS } from "../vsdx/stencils";
import { buildShapeXml, buildConnectorXml, buildPageXml, xmlEscape } from "../vsdx/xml-builder";

type NodeWithPos = Node & { _x?: number; _y?: number };

/**
 * Write a complete .vsdx (OPC ZIP) byte stream from a GraphIR with optional
 * per-node `_x`/`_y` coordinates. Returns a Uint8Array suitable for stuffing
 * into Postgres or sending as a response body.
 */
export async function writeVsdxFromIr(ir: GraphIR): Promise<Uint8Array> {
  const zip = new JSZip();

  // Assign sequential numeric IDs to nodes and edges (Visio shape IDs).
  const nodeIds = new Map<string, string>();
  let nextShapeId = 1;
  const nodeEntries = Object.entries(ir.nodes) as Array<[string, NodeWithPos]>;
  for (const [k] of nodeEntries) nodeIds.set(k, String(nextShapeId++));

  // Build shape XML fragments.
  const shapeXmls: string[] = [];
  for (const [k, n] of nodeEntries) {
    const mapping = mapShapeToMaster(n.shape);
    const masterId = String(ALL_MASTERS.indexOf(mapping.master) + 1);
    shapeXmls.push(buildShapeXml({
      id: nodeIds.get(k)!,
      master: mapping.master,
      masterId,
      text: n.label ?? "",
      x: n._x ?? 0,
      y: n._y ?? 0,
      w: 1.0,
      h: 0.75,
    }));
  }

  // Build connector XML fragments.
  const connectorXmls: string[] = [];
  for (const e of Object.values(ir.edges) as Edge[]) {
    const fromId = nodeIds.get(e.from);
    const toId = nodeIds.get(e.to);
    if (!fromId || !toId) continue;
    connectorXmls.push(buildConnectorXml({
      id: String(nextShapeId++),
      from: fromId,
      to: toId,
      text: e.label,
    }));
  }

  // OPC parts (minimal skeleton, mirrors the parser's expected structure).
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("visio/document.xml", documentXml());
  zip.file("visio/_rels/document.xml.rels", documentRelsXml());
  zip.file("visio/pages/pages.xml", pagesIndexXml());
  zip.file("visio/pages/_rels/pages.xml.rels", pagesRelsXml());
  zip.file("visio/pages/page1.xml", buildPageXml(shapeXmls, connectorXmls));
  zip.file("docProps/core.xml", corePropsXml());
  zip.file("docProps/app.xml", appPropsXml());
  zip.file("visio/masters/masters.xml", mastersIndexXml());

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return buf;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
  <Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function documentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <DocumentSettings/>
</VisioDocument>`;
}

function documentRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>
</Relationships>`;
}

function pagesIndexXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Page ID="0" Name="Page-1">
    <PageSheet/>
  </Page>
</Pages>`;
}

function pagesRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

function mastersIndexXml(): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">`,
  ];
  for (let i = 0; i < ALL_MASTERS.length; i++) {
    lines.push(`<Master ID="${i + 1}" NameU="${xmlEscape(ALL_MASTERS[i]!)}" Name="${xmlEscape(ALL_MASTERS[i]!)}"/>`);
  }
  lines.push(`</Masters>`);
  return lines.join("");
}

function corePropsXml(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>PrixmaViz</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>PrixmaViz</Application>
</Properties>`;
}
