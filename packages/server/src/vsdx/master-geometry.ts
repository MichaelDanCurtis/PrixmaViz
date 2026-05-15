/**
 * Per-master geometry definitions for the vsdx writer.
 *
 * Coordinate system: **RelMoveTo / RelLineTo / RelEllipticalArcTo** with
 * X and Y in 0..1, normalized to the shape's Width and Height respectively.
 * Visio (and LibreOffice's vsdx import filter) interpret these as
 * "fractions of the shape extent". This is the form LibreOffice actually
 * renders — absolute `MoveTo`/`LineTo` coordinates are silently dropped
 * even when they're inside the shape's bounding box.
 *
 * Found by diffing our writer's output against a reference vsdx
 * (`vsdx==0.6.1` python package's `media/media.vsdx` sample) that
 * LibreOffice rendered successfully.
 */

const NS = `xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve"`;

interface GeomRow {
  t: string;          // RelMoveTo | RelLineTo | RelEllipticalArcTo
  x: number;          // 0..1, fraction of shape Width
  y: number;          // 0..1, fraction of shape Height
  extra?: string;     // additional cells (control points, etc.) for arcs
}

function geometrySection(rows: GeomRow[]): string {
  const head = [
    `<Section N="Geometry" IX="0">`,
    `<Cell N="NoFill" V="0"/>`,
    `<Cell N="NoLine" V="0"/>`,
    `<Cell N="NoShow" V="0"/>`,
    `<Cell N="NoSnap" V="0"/>`,
    `<Cell N="NoQuickDrag" V="0"/>`,
  ];
  rows.forEach((r, i) => {
    const ix = i + 1;
    const cells = [
      `<Cell N="X" V="${r.x}"/>`,
      `<Cell N="Y" V="${r.y}"/>`,
      r.extra ?? "",
    ].join("");
    head.push(`<Row T="${r.t}" IX="${ix}">${cells}</Row>`);
  });
  head.push(`</Section>`);
  return head.join("");
}

function wrap(geometryRows: string, w = 1, h = 0.75): string {
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<MasterContents ${NS}>`,
    `<Shapes>`,
    `<Shape ID="1" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">`,
    `<Cell N="PinX" V="${w / 2}"/>`,
    `<Cell N="PinY" V="${h / 2}"/>`,
    `<Cell N="Width" V="${w}"/>`,
    `<Cell N="Height" V="${h}"/>`,
    `<Cell N="LocPinX" V="${w / 2}" F="Width*0.5"/>`,
    `<Cell N="LocPinY" V="${h / 2}" F="Height*0.5"/>`,
    `<Cell N="Angle" V="0"/>`,
    `<Cell N="FlipX" V="0"/>`,
    `<Cell N="FlipY" V="0"/>`,
    `<Cell N="ResizeMode" V="0"/>`,
    `<Cell N="ObjType" V="1"/>`,
    geometryRows,
    `</Shape>`,
    `</Shapes>`,
    `</MasterContents>`,
  ].join("");
}

// ── Shape geometries (all coords 0..1, normalized over Width × Height) ──

function rect(): string {
  return geometrySection([
    { t: "RelMoveTo", x: 0, y: 0 },
    { t: "RelLineTo", x: 1, y: 0 },
    { t: "RelLineTo", x: 1, y: 1 },
    { t: "RelLineTo", x: 0, y: 1 },
    { t: "RelLineTo", x: 0, y: 0 },
  ]);
}

function diamond(): string {
  return geometrySection([
    { t: "RelMoveTo", x: 0.5, y: 0 },
    { t: "RelLineTo", x: 1,   y: 0.5 },
    { t: "RelLineTo", x: 0.5, y: 1 },
    { t: "RelLineTo", x: 0,   y: 0.5 },
    { t: "RelLineTo", x: 0.5, y: 0 },
  ]);
}

function roundedRect(): string {
  // Stadium-shape terminator: semicircles capping a horizontal rect.
  // Corner radius = half the shape height; arc control point at the corner.
  const arc = (cx: number, cy: number) =>
    `<Cell N="A" V="${cx}"/><Cell N="B" V="${cy}"/><Cell N="C" V="0"/><Cell N="D" V="1"/>`;
  return geometrySection([
    { t: "RelMoveTo",           x: 0.25, y: 0 },
    { t: "RelLineTo",           x: 0.75, y: 0 },
    { t: "RelEllipticalArcTo",  x: 0.75, y: 1,    extra: arc(1, 0.5) },
    { t: "RelLineTo",           x: 0.25, y: 1 },
    { t: "RelEllipticalArcTo",  x: 0.25, y: 0,    extra: arc(0, 0.5) },
  ]);
}

function parallelogram(): string {
  return geometrySection([
    { t: "RelMoveTo", x: 0.2, y: 0 },
    { t: "RelLineTo", x: 1,   y: 0 },
    { t: "RelLineTo", x: 0.8, y: 1 },
    { t: "RelLineTo", x: 0,   y: 1 },
    { t: "RelLineTo", x: 0.2, y: 0 },
  ]);
}

function cylinder(): string {
  // Stored Data: a rectangle with horizontal cap lines suggesting the
  // top/bottom disks of a cylinder. Simplification; real cylinder uses
  // EllipticalArcTo curves for the caps.
  return geometrySection([
    { t: "RelMoveTo", x: 0, y: 0.15 },
    { t: "RelLineTo", x: 0, y: 0.85 },
    { t: "RelLineTo", x: 1, y: 0.85 },
    { t: "RelLineTo", x: 1, y: 0.15 },
    { t: "RelLineTo", x: 0, y: 0.15 },
  ]);
}

function circle(): string {
  const arc = (cx: number, cy: number) =>
    `<Cell N="A" V="${cx}"/><Cell N="B" V="${cy}"/><Cell N="C" V="0"/><Cell N="D" V="1"/>`;
  return geometrySection([
    { t: "RelMoveTo",           x: 0, y: 0.5 },
    { t: "RelEllipticalArcTo",  x: 1, y: 0.5, extra: arc(0.5, 0) },
    { t: "RelEllipticalArcTo",  x: 0, y: 0.5, extra: arc(0.5, 1) },
  ]);
}

function triangle(): string {
  return geometrySection([
    { t: "RelMoveTo", x: 0.5, y: 0 },
    { t: "RelLineTo", x: 1,   y: 1 },
    { t: "RelLineTo", x: 0,   y: 1 },
    { t: "RelLineTo", x: 0.5, y: 0 },
  ]);
}

function hexagon(): string {
  return geometrySection([
    { t: "RelMoveTo", x: 0.25, y: 0 },
    { t: "RelLineTo", x: 0.75, y: 0 },
    { t: "RelLineTo", x: 1,    y: 0.5 },
    { t: "RelLineTo", x: 0.75, y: 1 },
    { t: "RelLineTo", x: 0.25, y: 1 },
    { t: "RelLineTo", x: 0,    y: 0.5 },
    { t: "RelLineTo", x: 0.25, y: 0 },
  ]);
}

function rightArrow(): string {
  return geometrySection([
    { t: "RelMoveTo", x: 0,    y: 0.25 },
    { t: "RelLineTo", x: 0.7,  y: 0.25 },
    { t: "RelLineTo", x: 0.7,  y: 0 },
    { t: "RelLineTo", x: 1,    y: 0.5 },
    { t: "RelLineTo", x: 0.7,  y: 1 },
    { t: "RelLineTo", x: 0.7,  y: 0.75 },
    { t: "RelLineTo", x: 0,    y: 0.75 },
    { t: "RelLineTo", x: 0,    y: 0.25 },
  ]);
}

// ── Master name → geometry XML body ─────────────────────────────────────────

const GEOMETRY: Record<string, () => string> = {
  // Basic Flowchart
  "Process":              rect,
  "Terminator":           roundedRect,
  "Decision":             diamond,
  "Data":                 parallelogram,
  "Document":             rect,
  "Stored Data":          cylinder,
  "Cloud":                rect,
  "Predefined Process":   rect,
  "Manual Input":         parallelogram,
  "Display":              rect,
  "Connector":            circle,
  "Off-page Connector":   hexagon,
  // Basic Shapes
  "Circle":               circle,
  "Ellipse":              circle,
  "Triangle":             triangle,
  "Pentagon":             hexagon,
  "Hexagon":              hexagon,
  "Octagon":              hexagon,
  "5-Point Star":         triangle,
  "Right Arrow":          rightArrow,
};

export function getMasterPartXml(masterName: string): string {
  const fn = GEOMETRY[masterName] ?? rect;
  return wrap(fn());
}

/**
 * Same geometry as the master, returned for inline embedding on a page shape.
 * Coords are already in 0..1 normalized over Width/Height, so no rescaling
 * is needed regardless of the instance shape's actual Width/Height.
 */
export function getInlineGeometryXml(masterName: string, _w: number, _h: number): string {
  const fn = GEOMETRY[masterName] ?? rect;
  return fn();
}

export function getConnectorMasterPartXml(): string {
  // A connector is a 1D shape: just a straight line from (0,0) to (1,1) in
  // normalized space. Visio scales it via BeginX/BeginY/EndX/EndY when
  // instantiated on a page.
  const geom = `<Section N="Geometry" IX="0"><Cell N="NoFill" V="1"/><Cell N="NoLine" V="0"/><Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/><Cell N="NoQuickDrag" V="0"/><Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row><Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row></Section>`;
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<MasterContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">`,
    `<Shapes>`,
    `<Shape ID="100" Type="Shape" LineStyle="3" FillStyle="3" TextStyle="3">`,
    `<Cell N="PinX" V="0.5"/>`,
    `<Cell N="PinY" V="0.5"/>`,
    `<Cell N="Width" V="1"/>`,
    `<Cell N="Height" V="1"/>`,
    `<Cell N="LocPinX" V="0.5" F="Width*0.5"/>`,
    `<Cell N="LocPinY" V="0.5" F="Height*0.5"/>`,
    `<Cell N="BeginX" V="0"/>`,
    `<Cell N="BeginY" V="0"/>`,
    `<Cell N="EndX" V="1"/>`,
    `<Cell N="EndY" V="1"/>`,
    `<Cell N="ObjType" V="2"/>`,        // ObjType=2 means "1D shape" (connector)
    `<Cell N="Angle" V="0"/>`,
    `<Cell N="FlipX" V="0"/>`,
    `<Cell N="FlipY" V="0"/>`,
    `<Cell N="ResizeMode" V="0"/>`,
    geom,
    `</Shape>`,
    `</Shapes>`,
    `</MasterContents>`,
  ].join("");
}
