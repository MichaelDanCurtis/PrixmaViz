/**
 * Shared OPC (Open Packaging Convention) part templates used by both
 * vsdx writers. Each function takes whatever parameters that part needs
 * and returns the XML string.
 *
 * These templates are extracted from `renderers/vsdx-writer.ts` (the
 * structured GraphIR-driven writer) and `renderers/vsdx-writer-fallback.ts`
 * (the image-embed fallback). The structured writer's fully-populated
 * DocumentSettings/PageSheet shape is what LibreOffice needs to render the
 * vsdx, so it's the canonical form here — the fallback writer adopts the
 * same shape when it uses these helpers.
 */

export function contentTypesXml(opts: {
  /** Additional <Override> elements specific to the writer (master parts, etc.) */
  overrides?: string[];
  /** Extra Default Extension entries (e.g. for the image-embed fallback's png) */
  defaultExtensions?: Array<{ ext: string; type: string }>;
} = {}): string {
  // Each line gets a 2-space leading indent to match the surrounding template
  // literal's formatting. We assemble the lines and `.join("\n")` so empty
  // sections (no extras, no overrides) don't leave whitespace artifacts.
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `  <Default Extension="xml" ContentType="application/xml"/>`,
  ];
  for (const d of opts.defaultExtensions ?? []) {
    lines.push(`  <Default Extension="${d.ext}" ContentType="${d.type}"/>`);
  }
  lines.push(`  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>`);
  lines.push(`  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>`);
  lines.push(`  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>`);
  for (const o of opts.overrides ?? []) {
    lines.push(`  ${o}`);
  }
  lines.push(`  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`);
  lines.push(`  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`);
  lines.push(`</Types>`);
  return lines.join("\n");
}

export function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

export function documentXml(): string {
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

export function documentRelsXml(opts?: { withMasters?: boolean }): string {
  const mastersRel = opts?.withMasters
    ? `\n  <Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>${mastersRel}
</Relationships>`;
}

export function pagesIndexXml(): string {
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

export function pagesRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

export function corePropsXml(): string {
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

export function appPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>PrixmaViz</Application>
</Properties>`;
}
