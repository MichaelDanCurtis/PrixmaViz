import type { DiagramEngine, Edge, GraphIR, Node } from "@prixmaviz/shared";

/**
 * Which engines have a graph-IR layout-extraction path that can produce a
 * Visio-editable structured .vsdx (real shapes + connectors). Engines outside
 * this set fall through to the image-embed writer.
 */
export function canStructuredVsdx(engine: DiagramEngine): boolean {
  return engine === "mermaid" || engine === "d2" || engine === "graphviz";
}

/**
 * For graph engines, fetch a laid-out IR with `_x`/`_y` per node so the .vsdx
 * writer can place real shapes at sensible coordinates.
 *
 * - mermaid: original IR has the semantic shapes/labels. Use graphviz ONLY for
 *   layout, then merge `_x`/`_y` back into the original IR so we don't lose
 *   stencil hints across the round-trip.
 * - graphviz: parse the DSL directly via graphviz extractor (gives positions).
 * - d2: parse the DSL directly via the d2 extractor.
 * - anything else: return IR as-is (writer will still emit, but no layout).
 */
export async function maybeExtractLayout(
  engine: DiagramEngine,
  ir: GraphIR,
  dsl: string | null,
): Promise<GraphIR> {
  if (engine === "mermaid") {
    const { extractGraphFromDot } = await import("../renderers/graphviz-extractor");
    const laidOut = await extractGraphFromDot(irToDot(ir));
    return mergeLayoutBack(ir, laidOut);
  }
  if (engine === "graphviz" && dsl) {
    const { extractGraphFromDot } = await import("../renderers/graphviz-extractor");
    return await extractGraphFromDot(dsl);
  }
  if (engine === "d2" && dsl) {
    const { extractGraphFromD2 } = await import("../renderers/d2-extractor");
    return await extractGraphFromD2(dsl);
  }
  return ir;
}

/**
 * Take semantic node fields from `original` and layout coords from `laidOut`,
 * producing a merged IR that preserves stencil hints AND positions.
 */
export function mergeLayoutBack(original: GraphIR, laidOut: GraphIR): GraphIR {
  const nodes: GraphIR["nodes"] = {};
  for (const [id, n] of Object.entries(original.nodes) as Array<[string, Node]>) {
    const laidNode = laidOut.nodes[id];
    nodes[id] = {
      ...n,
      ...(laidNode ? { _x: laidNode._x, _y: laidNode._y } : {}),
    };
  }
  return { ...original, nodes };
}

/**
 * Serialize a GraphIR back to Graphviz DOT for the layout extraction round-trip
 * used by the mermaid → vsdx pipeline. Labels AND IDs are quoted via
 * JSON.stringify so that:
 *   - embedded quotes/unicode in labels survive
 *   - node IDs that collide with DOT reserved keywords (node, edge, graph,
 *     digraph, subgraph, strict) don't blow up the parser
 *   - IDs containing special chars (hyphens, dots, spaces — common in
 *     hand-written Mermaid) parse correctly
 */
export function irToDot(ir: GraphIR): string {
  const lines = ["digraph G { rankdir=" + (ir.layout?.direction ?? "TB") + ";"];
  for (const n of Object.values(ir.nodes) as Node[]) {
    const shape = n.shape ?? "box";
    lines.push(`  ${JSON.stringify(n.id)} [label=${JSON.stringify(n.label ?? n.id)}, shape="${shape}"];`);
  }
  for (const e of Object.values(ir.edges) as Edge[]) {
    const lbl = e.label ? ` [label=${JSON.stringify(e.label)}]` : "";
    lines.push(`  ${JSON.stringify(e.from)} -> ${JSON.stringify(e.to)}${lbl};`);
  }
  lines.push("}");
  return lines.join("\n");
}
