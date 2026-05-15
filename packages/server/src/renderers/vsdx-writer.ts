import JSZip from "jszip";
import type { GraphIR, Node, Edge } from "@prixmaviz/shared";
import { mapShapeToMaster, ALL_MASTERS } from "../vsdx/stencils";
import { buildShapeXml, buildConnectorXml, buildPageXml, xmlEscape } from "../vsdx/xml-builder";
import { getMasterPartXml, getInlineGeometryXml, getConnectorMasterPartXml } from "../vsdx/master-geometry";
import {
  contentTypesXml,
  rootRelsXml,
  documentXml,
  documentRelsXml,
  pagesIndexXml,
  pagesRelsXml,
  corePropsXml,
  appPropsXml,
} from "../vsdx/opc-templates";

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
  // [Content_Types].xml needs Override entries for every master part plus the
  // masters index. Order matches the existing emitted output: masters.xml,
  // then master1..masterN (the standard stencils), then master100 (the
  // Dynamic Connector).
  const masterOverrides: string[] = [
    `<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>`,
    ...ALL_MASTERS.map((_, i) =>
      `<Override PartName="/visio/masters/master${i + 1}.xml" ContentType="application/vnd.ms-visio.master+xml"/>`
    ),
    `<Override PartName="/visio/masters/master100.xml" ContentType="application/vnd.ms-visio.master+xml"/>`,
  ];
  zip.file("[Content_Types].xml", contentTypesXml({ overrides: masterOverrides }));
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("visio/document.xml", documentXml());
  zip.file("visio/_rels/document.xml.rels", documentRelsXml({ withMasters: true }));
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
