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

function realCylinder(): string {
  // Cylinder: vertical sides + half-ellipse on top (slightly visible front
  // arc) + half-ellipse on bottom. Ellipse ratio: y-radius = 0.08, so the
  // top ellipse spans y=0.0..0.16 (centered at 0.08), bottom y=0.84..1.0.
  const arc = (cx: number, cy: number) =>
    `<Cell N="A" V="${cx}"/><Cell N="B" V="${cy}"/><Cell N="C" V="0"/><Cell N="D" V="1"/>`;
  return geometrySection([
    // Top ellipse — full ellipse so it reads as a disk seen edge-on
    { t: "RelMoveTo",          x: 0,    y: 0.08 },
    { t: "RelEllipticalArcTo", x: 1,    y: 0.08, extra: arc(0.5, 0) },
    { t: "RelEllipticalArcTo", x: 0,    y: 0.08, extra: arc(0.5, 0.16) },
    // Right side down
    { t: "RelMoveTo",          x: 1,    y: 0.08 },
    { t: "RelLineTo",          x: 1,    y: 0.92 },
    // Bottom ellipse (front arc visible — just the bottom half)
    { t: "RelEllipticalArcTo", x: 0,    y: 0.92, extra: arc(0.5, 1) },
    // Left side up
    { t: "RelLineTo",          x: 0,    y: 0.08 },
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

function pentagon(): string {
  // Regular pentagon, one vertex pointing up (toward y=0 since y increases
  // downward in our normalized space).
  // Vertices at angles 270°, 342°, 54°, 126°, 198° (top, upper-right,
  // lower-right, lower-left, upper-left) — scaled to fit unit box.
  return geometrySection([
    { t: "RelMoveTo", x: 0.5,    y: 0    },     // top
    { t: "RelLineTo", x: 1,      y: 0.38 },     // upper-right
    { t: "RelLineTo", x: 0.82,   y: 1    },     // lower-right
    { t: "RelLineTo", x: 0.18,   y: 1    },     // lower-left
    { t: "RelLineTo", x: 0,      y: 0.38 },     // upper-left
    { t: "RelLineTo", x: 0.5,    y: 0    },     // close
  ]);
}

function octagon(): string {
  // 8-sided. Vertices at the 8 octant angles, with corners cut off a
  // square at fraction `c` of the side.
  const c = 0.29;  // ~tan(22.5°)/2; standard regular-octagon cut
  return geometrySection([
    { t: "RelMoveTo", x: c,       y: 0 },
    { t: "RelLineTo", x: 1 - c,   y: 0 },
    { t: "RelLineTo", x: 1,       y: c },
    { t: "RelLineTo", x: 1,       y: 1 - c },
    { t: "RelLineTo", x: 1 - c,   y: 1 },
    { t: "RelLineTo", x: c,       y: 1 },
    { t: "RelLineTo", x: 0,       y: 1 - c },
    { t: "RelLineTo", x: 0,       y: c },
    { t: "RelLineTo", x: c,       y: 0 },
  ]);
}

function fivePointStar(): string {
  // Star with 5 outer points (radius=0.5) and 5 inner points (radius=0.5*sin(18°)/sin(54°) ≈ 0.191).
  // Coordinates pre-computed: outer at angles 270, 342, 54, 126, 198 degrees;
  // inner at 306, 18, 90, 162, 234. Centered at (0.5, 0.5).
  return geometrySection([
    { t: "RelMoveTo", x: 0.5,    y: 0    },      // top point
    { t: "RelLineTo", x: 0.612,  y: 0.345 },     // inner-right-upper
    { t: "RelLineTo", x: 0.976,  y: 0.345 },     // upper-right point
    { t: "RelLineTo", x: 0.682,  y: 0.559 },     // inner-right-lower
    { t: "RelLineTo", x: 0.794,  y: 0.905 },     // lower-right point
    { t: "RelLineTo", x: 0.5,    y: 0.691 },     // inner-bottom
    { t: "RelLineTo", x: 0.206,  y: 0.905 },     // lower-left point
    { t: "RelLineTo", x: 0.318,  y: 0.559 },     // inner-left-lower
    { t: "RelLineTo", x: 0.024,  y: 0.345 },     // upper-left point
    { t: "RelLineTo", x: 0.388,  y: 0.345 },     // inner-left-upper
    { t: "RelLineTo", x: 0.5,    y: 0    },      // close
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
  "Stored Data":          realCylinder,
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
  "Pentagon":             pentagon,
  "Hexagon":              hexagon,
  "Octagon":              octagon,
  "5-Point Star":         fivePointStar,
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
