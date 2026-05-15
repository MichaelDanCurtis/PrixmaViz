import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface VsdxShape {
  id: string;
  master: string; // e.g. "Process", "Decision" — empty string if unknown
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VsdxConnector {
  id: string;
  from: string; // source shape id
  to: string; // sink shape id
  text?: string;
}

export interface VsdxPage {
  name: string;
  shapes: VsdxShape[];
  connectors: VsdxConnector[];
}

export interface VsdxDocument {
  pages: VsdxPage[];
  metadata: {
    title?: string;
    author?: string;
    lastSaved?: string;
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  trimValues: true,
});

export async function parseVsdx(bytes: Uint8Array): Promise<VsdxDocument> {
  const zip = await JSZip.loadAsync(bytes);

  const pagesXmlEntry = zip.file("visio/pages/pages.xml");
  if (!pagesXmlEntry) {
    throw new Error("invalid .vsdx: missing visio/pages/pages.xml");
  }
  const pagesXml = await pagesXmlEntry.async("string");
  const pagesDoc = xmlParser.parse(pagesXml) as Record<string, unknown>;

  const pagesNode = (pagesDoc.Pages as Record<string, unknown>)?.Page;
  const pageList = Array.isArray(pagesNode) ? pagesNode : pagesNode ? [pagesNode] : [];

  const pages: VsdxPage[] = [];
  for (let i = 0; i < pageList.length; i++) {
    const pNode = pageList[i] as Record<string, unknown>;
    const name = (pNode["@_Name"] as string | undefined) ?? `Page-${i + 1}`;
    const pageNum = i + 1;
    const pageXmlEntry = zip.file(`visio/pages/page${pageNum}.xml`);
    if (!pageXmlEntry) continue;
    const pageXml = await pageXmlEntry.async("string");
    const page = parsePage(name, pageXml);
    pages.push(page);
  }

  const metadata: VsdxDocument["metadata"] = {};
  const docEntry = zip.file("docProps/core.xml") ?? zip.file("visio/document.xml");
  if (docEntry) {
    const docXml = await docEntry.async("string");
    const titleMatch = docXml.match(/<dc:title>([^<]+)<\/dc:title>/);
    const authorMatch = docXml.match(/<dc:creator>([^<]+)<\/dc:creator>/);
    const modifiedMatch = docXml.match(/<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/);
    if (titleMatch) metadata.title = titleMatch[1];
    if (authorMatch) metadata.author = authorMatch[1];
    if (modifiedMatch) metadata.lastSaved = modifiedMatch[1];
  }

  return { pages, metadata };
}

function parsePage(name: string, xml: string): VsdxPage {
  const doc = xmlParser.parse(xml) as Record<string, unknown>;
  const pageContents = doc.PageContents as Record<string, unknown> | undefined;
  const shapesNode = (pageContents?.Shapes as Record<string, unknown>)?.Shape;
  const shapeList = Array.isArray(shapesNode) ? shapesNode : shapesNode ? [shapesNode] : [];

  const shapes: VsdxShape[] = [];
  const connectors: VsdxConnector[] = [];

  for (const s of shapeList) {
    const node = s as Record<string, unknown>;
    const id = String(node["@_ID"] ?? "");
    const masterName = String(node["@_NameU"] ?? node["@_Master"] ?? "");
    const text = extractText(node);
    const cells = extractCells(node);

    const beginRef = findGlueRef(node, "BeginX");
    const endRef = findGlueRef(node, "EndX");
    if (beginRef && endRef) {
      connectors.push({ id, from: beginRef, to: endRef, text: text || undefined });
      continue;
    }

    shapes.push({
      id,
      master: masterName,
      text,
      x: cells.PinX ?? 0,
      y: cells.PinY ?? 0,
      w: cells.Width ?? 0,
      h: cells.Height ?? 0,
    });
  }

  return { name, shapes, connectors };
}

function extractText(node: Record<string, unknown>): string {
  const text = node.Text;
  if (typeof text === "string") return text.trim();
  if (typeof text === "number") return String(text);
  return "";
}

function extractCells(node: Record<string, unknown>): Record<string, number> {
  const cellsNode = node.Cell;
  const list = Array.isArray(cellsNode) ? cellsNode : cellsNode ? [cellsNode] : [];
  const out: Record<string, number> = {};
  for (const c of list) {
    const obj = c as Record<string, unknown>;
    const n = String(obj["@_N"] ?? "");
    const v = obj["@_V"];
    const num = typeof v === "number" ? v : Number(v);
    if (n && !Number.isNaN(num)) out[n] = num;
  }
  return out;
}

function findGlueRef(node: Record<string, unknown>, axis: "BeginX" | "EndX"): string | undefined {
  const cellsNode = node.Cell;
  const list = Array.isArray(cellsNode) ? cellsNode : cellsNode ? [cellsNode] : [];
  for (const c of list) {
    const obj = c as Record<string, unknown>;
    if (String(obj["@_N"]) !== axis) continue;
    const f = String(obj["@_F"] ?? "");
    const m = f.match(/Sheet\.(\d+)/);
    if (m) return m[1];
  }
  return undefined;
}
