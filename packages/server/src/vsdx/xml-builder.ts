/**
 * Minimal Visio XML emission. We don't try to cover every cell — just
 * enough for shapes with position/size/text and connectors with glue refs.
 */

export interface ShapeXmlInput {
  id: string;
  master: string;       // human-readable; informational
  masterId: string;     // numeric ID matching the masters/ part
  text: string;
  x: number;            // PinX (page coords, inches)
  y: number;            // PinY
  w: number;            // Width
  h: number;            // Height
}

export interface ConnectorXmlInput {
  id: string;
  from: string;         // source shape ID
  to: string;           // sink shape ID
  text?: string;        // edge label
}

const VISIO_NS = "http://schemas.microsoft.com/office/visio/2012/main";

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cell(n: string, v: number | string, f?: string): string {
  const fAttr = f ? ` F="${xmlEscape(f)}"` : "";
  return `<Cell N="${n}" V="${typeof v === "number" ? v : xmlEscape(String(v))}"${fAttr}/>`;
}

export function buildShapeXml(s: ShapeXmlInput): string {
  return [
    `<Shape ID="${xmlEscape(s.id)}" Type="Shape" Master="${xmlEscape(s.masterId)}">`,
    cell("PinX", s.x),
    cell("PinY", s.y),
    cell("Width", s.w),
    cell("Height", s.h),
    cell("LocPinX", s.w / 2),
    cell("LocPinY", s.h / 2),
    `<Text>${xmlEscape(s.text)}</Text>`,
    `</Shape>`,
  ].join("");
}

export function buildConnectorXml(c: ConnectorXmlInput): string {
  return [
    `<Shape ID="${xmlEscape(c.id)}" Type="Shape" Master="100">`, // Master 100 = generic Dynamic Connector
    cell("BeginX", 0, `PAR(PNT(Sheet.${c.from}!Connections.X1, Sheet.${c.from}!Connections.Y1))`),
    cell("BeginY", 0, `PAR(PNT(Sheet.${c.from}!Connections.X1, Sheet.${c.from}!Connections.Y1))`),
    cell("EndX",   0, `PAR(PNT(Sheet.${c.to}!Connections.X1, Sheet.${c.to}!Connections.Y1))`),
    cell("EndY",   0, `PAR(PNT(Sheet.${c.to}!Connections.X1, Sheet.${c.to}!Connections.Y1))`),
    c.text ? `<Text>${xmlEscape(c.text)}</Text>` : "",
    `</Shape>`,
  ].join("");
}

export function buildPageXml(shapeXmls: string[], connectorXmls: string[]): string {
  const all = [...shapeXmls, ...connectorXmls].join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<PageContents xmlns="${VISIO_NS}" xml:space="preserve">`,
    `<Shapes>${all}</Shapes>`,
    `</PageContents>`,
  ].join("");
}
