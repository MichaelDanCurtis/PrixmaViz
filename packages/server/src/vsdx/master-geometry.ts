/**
 * Per-master geometry definitions for the vsdx writer.
 *
 * Each master we expose in `stencils.ts` needs a corresponding
 * `<MasterContents>` XML part (`visio/masters/masterN.xml`) that defines what
 * the shape actually looks like — geometry rows like MoveTo/LineTo/EllipticalArcTo.
 *
 * Without these parts, LibreOffice loads the vsdx but renders an empty SVG
 * because it has no master geometry to draw. Visio itself is more forgiving
 * (falls back to its built-in master library), but cross-tool fidelity
 * requires us to ship the geometry inline.
 *
 * The master's local coordinate space is normalized to (0, 0) → (1, 0.75)
 * — a unit box matching the writer's default shape size. Visio/LibreOffice
 * scales the geometry to fit each instance's Width/Height at render time.
 */

const NS = `xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve"`;

interface GeomRow {
  t: string;          // MoveTo | LineTo | EllipticalArcTo
  x: number;
  y: number;
  extra?: string;     // additional cells (control points, angles) for arcs
}

function geometrySection(rows: GeomRow[]): string {
  const head = [
    `<Section N="Geometry" IX="0">`,
    `<Cell N="NoFill" V="0"/>`,
    `<Cell N="NoLine" V="0"/>`,
    `<Cell N="NoShow" V="0"/>`,
    `<Cell N="NoSnap" V="0"/>`,
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
    `<Cell N="LocPinX" V="${w / 2}"/>`,
    `<Cell N="LocPinY" V="${h / 2}"/>`,
    geometryRows,
    `</Shape>`,
    `</Shapes>`,
    `</MasterContents>`,
  ].join("");
}

// ── Shape geometries ────────────────────────────────────────────────────────

function rect(): string {
  return geometrySection([
    { t: "MoveTo", x: 0,    y: 0 },
    { t: "LineTo", x: 1,    y: 0 },
    { t: "LineTo", x: 1,    y: 0.75 },
    { t: "LineTo", x: 0,    y: 0.75 },
    { t: "LineTo", x: 0,    y: 0 },
  ]);
}

function diamond(): string {
  return geometrySection([
    { t: "MoveTo", x: 0.5,  y: 0 },
    { t: "LineTo", x: 1,    y: 0.375 },
    { t: "LineTo", x: 0.5,  y: 0.75 },
    { t: "LineTo", x: 0,    y: 0.375 },
    { t: "LineTo", x: 0.5,  y: 0 },
  ]);
}

function roundedRect(): string {
  // Stadium-shape terminator: two semicircles capping a horizontal rect.
  // Corner radius = half-height; in this 1×0.75 box that's r = 0.375.
  // Control point C between two arc endpoints sits at the corner.
  // EllipticalArcTo: (X,Y) is end; controls give one mid-arc point + angle.
  const arc = (x: number, y: number, cx: number, cy: number) =>
    `<Cell N="A" V="${cx}"/><Cell N="B" V="${cy}"/><Cell N="C" V="0"/><Cell N="D" V="1"/>`;
  return geometrySection([
    { t: "MoveTo",           x: 0.375, y: 0 },
    { t: "LineTo",           x: 0.625, y: 0 },
    { t: "EllipticalArcTo",  x: 0.625, y: 0.75, extra: arc(0.625, 0.75, 1, 0.375) },
    { t: "LineTo",           x: 0.375, y: 0.75 },
    { t: "EllipticalArcTo",  x: 0.375, y: 0,    extra: arc(0.375, 0,   0, 0.375) },
  ]);
}

function parallelogram(): string {
  // Data shape: slanted parallelogram. Skew offset = 0.1875.
  return geometrySection([
    { t: "MoveTo", x: 0.1875, y: 0 },
    { t: "LineTo", x: 1,      y: 0 },
    { t: "LineTo", x: 0.8125, y: 0.75 },
    { t: "LineTo", x: 0,      y: 0.75 },
    { t: "LineTo", x: 0.1875, y: 0 },
  ]);
}

function cylinder(): string {
  // Stored Data: cylinder with curved top + bottom (drawn as flat for v1).
  // Real cylinder needs two EllipticalArcTo curves; for now use a tall rect
  // with horizontal lines at top/bottom to suggest the open-end disks.
  return geometrySection([
    { t: "MoveTo", x: 0,    y: 0.125 },
    { t: "LineTo", x: 0,    y: 0.625 },
    { t: "LineTo", x: 1,    y: 0.625 },
    { t: "LineTo", x: 1,    y: 0.125 },
    { t: "LineTo", x: 0,    y: 0.125 },
    { t: "MoveTo", x: 0,    y: 0.625 },
    { t: "LineTo", x: 0,    y: 0.125 },
    { t: "MoveTo", x: 1,    y: 0.625 },
    { t: "LineTo", x: 1,    y: 0.125 },
  ]);
}

function circle(): string {
  // Small filled circle for connector shapes.
  const arc = (x: number, y: number, cx: number, cy: number) =>
    `<Cell N="A" V="${cx}"/><Cell N="B" V="${cy}"/><Cell N="C" V="0"/><Cell N="D" V="1"/>`;
  return geometrySection([
    { t: "MoveTo",          x: 0,   y: 0.375 },
    { t: "EllipticalArcTo", x: 1,   y: 0.375, extra: arc(1,   0.375, 0.5, 0) },
    { t: "EllipticalArcTo", x: 0,   y: 0.375, extra: arc(0,   0.375, 0.5, 0.75) },
  ]);
}

function triangle(): string {
  return geometrySection([
    { t: "MoveTo", x: 0.5, y: 0 },
    { t: "LineTo", x: 1,   y: 0.75 },
    { t: "LineTo", x: 0,   y: 0.75 },
    { t: "LineTo", x: 0.5, y: 0 },
  ]);
}

function hexagon(): string {
  return geometrySection([
    { t: "MoveTo", x: 0.25,  y: 0 },
    { t: "LineTo", x: 0.75,  y: 0 },
    { t: "LineTo", x: 1,     y: 0.375 },
    { t: "LineTo", x: 0.75,  y: 0.75 },
    { t: "LineTo", x: 0.25,  y: 0.75 },
    { t: "LineTo", x: 0,     y: 0.375 },
    { t: "LineTo", x: 0.25,  y: 0 },
  ]);
}

function rightArrow(): string {
  return geometrySection([
    { t: "MoveTo", x: 0,     y: 0.1875 },
    { t: "LineTo", x: 0.625, y: 0.1875 },
    { t: "LineTo", x: 0.625, y: 0 },
    { t: "LineTo", x: 1,     y: 0.375 },
    { t: "LineTo", x: 0.625, y: 0.75 },
    { t: "LineTo", x: 0.625, y: 0.5625 },
    { t: "LineTo", x: 0,     y: 0.5625 },
    { t: "LineTo", x: 0,     y: 0.1875 },
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
 * Same geometry as the master, but scaled to the actual shape Width/Height
 * so it can be embedded inline on a page shape. LibreOffice's Visio import
 * reliably renders inline geometry but often skips master resolution.
 */
export function getInlineGeometryXml(masterName: string, w: number, h: number): string {
  const fn = GEOMETRY[masterName] ?? rect;
  const raw = fn();
  // Geometry uses a normalized 1×0.75 box. Scale X by w, Y by (h / 0.75).
  // Find every `V="<number>"` inside `<Cell N="X"...` or `<Cell N="Y"...` and rescale.
  const xScale = w;
  const yScale = h / 0.75;
  return raw.replace(/<Cell N="(X|Y)" V="([0-9.]+)"\/>/g, (_, axis, n) => {
    const scaled = (parseFloat(n) * (axis === "X" ? xScale : yScale)).toFixed(4);
    return `<Cell N="${axis}" V="${scaled}"/>`;
  });
}
