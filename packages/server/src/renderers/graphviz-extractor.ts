import type { Edge, GraphIR, NodeShape } from "@prixmaviz/shared";

// Hard cap on how long `dot` may run before we kill it. Pathological DOT input
// (e.g. a degenerate graph from a malicious or buggy upstream extractor) can
// otherwise hang the request indefinitely.
const DOT_TIMEOUT_MS = Number(process.env.PRIXMAVIZ_DOT_TIMEOUT_MS) || 10_000;

/**
 * Run `dot -Tjson` on the input DOT string and translate the layout
 * into a GraphIR with positions attached on each node as `_x`/`_y`.
 *
 * Consumed by:
 *   - D2 extractor (D2 → DOT → here)
 *   - vsdx writer (uses `_x` / `_y` to place Visio shapes)
 */
export async function extractGraphFromDot(dot: string): Promise<GraphIR> {
  const signal = AbortSignal.timeout(DOT_TIMEOUT_MS);
  const proc = Bun.spawn(["dot", "-Tjson"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    proc.stdin.write(dot);
    await proc.stdin.end();
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    exitCode = await proc.exited;
  } catch (e) {
    if (signal.aborted) {
      throw new Error(`dot timed out after ${DOT_TIMEOUT_MS}ms`);
    }
    if (e instanceof Error && (e.name === "AbortError" || /aborted|timed out/i.test(e.message))) {
      throw new Error(`dot timed out after ${DOT_TIMEOUT_MS}ms`);
    }
    throw e;
  }
  if (signal.aborted) {
    throw new Error(`dot timed out after ${DOT_TIMEOUT_MS}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(`dot failed (${exitCode}): ${stderr.slice(0, 200)}`);
  }
  let layout: DotJson;
  try {
    layout = JSON.parse(stdout) as DotJson;
  } catch {
    throw new Error(`dot produced non-JSON output: ${stdout.slice(0, 200)}`);
  }

  const ir: GraphIR = {
    nodes: {},
    edges: {},
    groups: {},
    layout: { direction: "TB" },
  };

  for (const obj of layout.objects ?? []) {
    if (!obj.name || obj.name.startsWith("cluster_")) continue;
    const [x, y] = parsePos(obj.pos);
    const shape = mapDotShapeToIr(obj.shape ?? "box");
    ir.nodes[obj.name] = {
      id: obj.name,
      label: obj.label ?? obj.name,
      shape,
      _x: x,
      _y: y,
    };
  }

  let eIdx = 0;
  for (const e of layout.edges ?? []) {
    const fromObj = layout.objects?.[e.tail];
    const toObj = layout.objects?.[e.head];
    if (!fromObj?.name || !toObj?.name) continue;
    const eid = `e${++eIdx}`;
    const edge: Edge = {
      id: eid,
      from: fromObj.name,
      to: toObj.name,
      label: e.label,
    };
    ir.edges[eid] = edge;
  }

  return ir;
}

interface DotJson {
  objects?: Array<{
    _gvid?: number;
    name?: string;
    label?: string;
    shape?: string;
    pos?: string; // "x,y"
  }>;
  edges?: Array<{
    tail: number; // index into objects
    head: number;
    label?: string;
  }>;
}

// Graphviz `pos` is "x,y" in POINTS (1/72 inch). Visio uses inches.
// Convert here so consumers (vsdx writer in particular) get sensible values.
const POINTS_PER_INCH = 72;

function parsePos(pos?: string): [number, number] {
  if (!pos) return [0, 0];
  const [x, y] = pos.split(",").map(Number);
  return [(x ?? 0) / POINTS_PER_INCH, (y ?? 0) / POINTS_PER_INCH];
}

function mapDotShapeToIr(dotShape: string): NodeShape {
  switch (dotShape) {
    case "box":
    case "rectangle":
      return "rect";
    case "diamond":
      return "diamond";
    case "ellipse":
      return "ellipse";
    case "circle":
      return "circle";
    case "parallelogram":
      return "parallelogram";
    case "cylinder":
      return "cylinder";
    case "triangle":
      return "triangle";
    case "hexagon":
      return "hexagon";
    case "octagon":
      return "octagon";
    case "star":
      return "star";
    default:
      return "rect";
  }
}
