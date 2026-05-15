/**
 * Map PrixmaViz IR node shape hints to Visio stencil masters.
 * Coverage: Basic Flowchart + Basic Shapes stencils (Visio built-in).
 */

export interface MasterMapping {
  master: string;
  /** True if the IR shape was not recognized and we fell back to a default. */
  fallback: boolean;
}

const FLOWCHART: Record<string, string> = {
  rect: "Process",
  process: "Process",
  roundedRect: "Terminator",
  round: "Terminator",
  terminator: "Terminator",
  diamond: "Decision",
  decision: "Decision",
  parallelogram: "Data",
  data: "Data",
  document: "Document",
  cylinder: "Stored Data",
  database: "Stored Data",
  cloud: "Cloud",
  subroutine: "Predefined Process",
  predefined: "Predefined Process",
  manualInput: "Manual Input",
  display: "Display",
  connector: "Connector",
  offPageConnector: "Off-page Connector",
};

const BASIC_SHAPES: Record<string, string> = {
  circle: "Circle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
  octagon: "Octagon",
  star: "5-Point Star",
  arrow: "Right Arrow",
};

const ALL_MAP: Record<string, string> = { ...FLOWCHART, ...BASIC_SHAPES };

export const ALL_MASTERS: string[] = Array.from(new Set(Object.values(ALL_MAP)));

export function mapShapeToMaster(irShape: string | undefined): MasterMapping {
  if (!irShape) return { master: "Process", fallback: true };
  const m = ALL_MAP[irShape];
  if (m) return { master: m, fallback: false };
  return { master: "Process", fallback: true };
}
