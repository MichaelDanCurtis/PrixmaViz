import JSZip from "jszip";
import type { GraphIR, Node, Edge } from "@prixmaviz/shared";
import { mapShapeToMaster, ALL_MASTERS } from "../vsdx/stencils";
import { buildShapeXml, buildConnectorXml, buildPageXml, xmlEscape } from "../vsdx/xml-builder";
import { getMasterPartXml, getInlineGeometryXml, getConnectorMasterPartXml } from "../vsdx/master-geometry";

export interface WriteVsdxResult {
  bytes: Uint8Array;
  warnings: string[];
}

/**
 * Write a complete .vsdx (OPC ZIP) byte stream from a GraphIR with optional
 * per-node `_x`/`_y` coordinates. Returns the byte buffer alongside any
 * warnings accumulated during writing — e.g. dropped edges that reference
 * missing nodes, or nodes whose shape didn't map to a known master so we
 * fell back to "Process". Callers should surface these to the user or at
 * least log them; silently incomplete diagrams are the worst failure mode.
 */
export async function writeVsdxFromIr(ir: GraphIR): Promise<WriteVsdxResult> {
  const zip = new JSZip();
  const warnings: string[] = [];

  // Assign sequential numeric IDs to nodes and edges (Visio shape IDs).
  const nodeIds = new Map<string, string>();
  let nextShapeId = 1;
  const nodeEntries = Object.entries(ir.nodes) as Array<[string, Node]>;
  for (const [k] of nodeEntries) nodeIds.set(k, String(nextShapeId++));

  // Build shape XML fragments. Each shape includes both:
  //   - Master="N" reference (so Visio can use its stencil library)
  //   - Inline geometry (so LibreOffice can render even when it can't resolve masters)
  const shapeXmls: string[] = [];
  for (const [k, n] of nodeEntries) {
    const mapping = mapShapeToMaster(n.shape);
    if (mapping.fallback) {
      warnings.push(`node '${k}' has unknown shape '${n.shape ?? "(none)"}', falling back to Process`);
    }
    const masterId = String(ALL_MASTERS.indexOf(mapping.master) + 1);
    const w = 1.0;
    const h = 0.75;
    shapeXmls.push(buildShapeXml({
      id: nodeIds.get(k)!,
      master: mapping.master,
      masterId,
      text: n.label ?? "",
      x: n._x ?? 0,
      y: n._y ?? 0,
      w,
      h,
      geometry: getInlineGeometryXml(mapping.master, w, h),
    }));
  }

  // Build connector XML fragments.
  const connectorXmls: string[] = [];
  for (const e of Object.values(ir.edges) as Edge[]) {
    const fromId = nodeIds.get(e.from);
    const toId = nodeIds.get(e.to);
    if (!fromId) {
      warnings.push(`dropped edge ${e.id}: from node '${e.from}' not found`);
      continue;
    }
    if (!toId) {
      warnings.push(`dropped edge ${e.id}: to node '${e.to}' not found`);
      continue;
    }
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
  // page1.xml.rels: required for LibreOffice — links the page back to
  // any masters its shapes reference. Without it, LibreOffice can't
  // resolve Master="N" attributes on page shapes.
  zip.file("visio/pages/_rels/page1.xml.rels", page1RelsXml());
  zip.file("docProps/core.xml", corePropsXml());
  zip.file("docProps/app.xml", appPropsXml());
  zip.file("visio/masters/masters.xml", mastersIndexXml());
  zip.file("visio/masters/_rels/masters.xml.rels", mastersRelsXml());
  // One master<N>.xml part per master, with geometry definitions so
  // LibreOffice (and Visio) know what to actually draw.
  for (let i = 0; i < ALL_MASTERS.length; i++) {
    zip.file(`visio/masters/master${i + 1}.xml`, getMasterPartXml(ALL_MASTERS[i]!));
  }
  // Master 100 = the Dynamic Connector geometry (a simple line shape)
  zip.file("visio/masters/master100.xml", getConnectorMasterPartXml());

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes: buf, warnings };
}

function contentTypesXml(): string {
  const masterOverrides = ALL_MASTERS.map((_, i) =>
    `  <Override PartName="/visio/masters/master${i + 1}.xml" ContentType="application/vnd.ms-visio.master+xml"/>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
  <Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>
${masterOverrides}
  <Override PartName="/visio/masters/master100.xml" ContentType="application/vnd.ms-visio.master+xml"/>
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
  // DocumentSettings with default style refs is required — LibreOffice's
  // vsdx import filter resolves shape `LineStyle="3"` etc. against these.
  // Empty <DocumentSettings/> means LibreOffice falls back to "invisible"
  // styles and renders nothing.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">
  <DocumentSettings TopPage="0" DefaultTextStyle="3" DefaultLineStyle="3" DefaultFillStyle="3" DefaultGuideStyle="4">
    <GlueSettings>9</GlueSettings>
    <SnapSettings>65847</SnapSettings>
    <SnapExtensions>34</SnapExtensions>
    <SnapAngles/>
    <DynamicGridEnabled>1</DynamicGridEnabled>
    <ProtectStyles>0</ProtectStyles>
    <ProtectShapes>0</ProtectShapes>
    <ProtectMasters>0</ProtectMasters>
    <ProtectBkgnds>0</ProtectBkgnds>
  </DocumentSettings>
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
  // Fully-populated PageSheet (PageWidth, PageHeight, all the standard cells)
  // is required for LibreOffice to render shapes on the page. Empty
  // <PageSheet/> = no page extents = nothing drawn.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">
  <Page ID="0" NameU="Page-1" Name="Page-1" ViewScale="1" ViewCenterX="4.25" ViewCenterY="5.5">
    <PageSheet LineStyle="0" FillStyle="0" TextStyle="0">
      <Cell N="PageWidth" V="8.5"/>
      <Cell N="PageHeight" V="11"/>
      <Cell N="ShdwOffsetX" V="0.125"/>
      <Cell N="ShdwOffsetY" V="-0.125"/>
      <Cell N="PageScale" V="1"/>
      <Cell N="DrawingScale" V="1"/>
      <Cell N="DrawingSizeType" V="0"/>
      <Cell N="DrawingScaleType" V="0"/>
      <Cell N="InhibitSnap" V="0"/>
      <Cell N="UIVisibility" V="0"/>
      <Cell N="ShdwType" V="0"/>
      <Cell N="ShdwObliqueAngle" V="0"/>
      <Cell N="ShdwScaleFactor" V="1"/>
      <Cell N="DrawingResizeType" V="1"/>
    </PageSheet>
    <Rel r:id="rId1"/>
  </Page>
</Pages>`;
}

function pagesRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

function page1RelsXml(): string {
  // Page-level relationships: link the page to all masters its shapes
  // might reference. Simplest correct form is to link master1 (Process —
  // the default fallback). LibreOffice requires SOME page→master rel even
  // if the shape uses inline geometry.
  const rels = ALL_MASTERS.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="../masters/master${i + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function mastersIndexXml(): string {
  // masters.xml lists each master and references its geometry part by Rel id.
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">`,
  ];
  for (let i = 0; i < ALL_MASTERS.length; i++) {
    const name = xmlEscape(ALL_MASTERS[i]!);
    lines.push(
      `<Master ID="${i + 1}" NameU="${name}" Name="${name}" Hidden="0">` +
      `<PageSheet><Cell N="PageWidth" V="1"/><Cell N="PageHeight" V="0.75"/></PageSheet>` +
      `<Rel r:id="rId${i + 1}"/>` +
      `</Master>`
    );
  }
  // Dynamic Connector — used by every edge in our writer.
  // The reference vsdx exposes this as a separate master with ID=100.
  const connectorRelId = `rId${ALL_MASTERS.length + 1}`;
  lines.push(
    `<Master ID="100" NameU="Dynamic connector" Name="Dynamic connector" Hidden="0">` +
    `<PageSheet><Cell N="PageWidth" V="1"/><Cell N="PageHeight" V="1"/></PageSheet>` +
    `<Rel r:id="${connectorRelId}"/>` +
    `</Master>`
  );
  lines.push(`</Masters>`);
  return lines.join("");
}

function mastersRelsXml(): string {
  const rels = ALL_MASTERS.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="master${i + 1}.xml"/>`
  ).join("");
  const connectorRel = `<Relationship Id="rId${ALL_MASTERS.length + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="master100.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}${connectorRel}</Relationships>`;
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
