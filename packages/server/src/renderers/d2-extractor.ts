import type { GraphIR } from "@prixmaviz/shared";
import { extractGraphFromDot } from "./graphviz-extractor";

/**
 * Convert a D2 source into a GraphIR with layout coordinates by:
 *   1. line-parsing the D2 to extract nodes and edges
 *   2. translating to equivalent DOT
 *   3. feeding through graphviz-extractor for layout
 *
 * This is intentionally narrow — only handles "id: label" node lines and
 * "id -> id: label" edge lines. Containers, classes, and shapes are out of
 * scope for v1.
 */
export async function extractGraphFromD2(source: string): Promise<GraphIR> {
  // Strip /* ... */ block comments first.
  const sanitized = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = sanitized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nodes: Record<string, { label: string }> = {};
  const edges: Array<{ from: string; to: string; label?: string }> = [];

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const edgeMatch = line.match(/^(\S+)\s*->\s*(\S+)(?::\s*(.+))?$/);
    if (edgeMatch) {
      const [, from, to, lbl] = edgeMatch;
      edges.push({ from: from!, to: to!, label: lbl?.trim() });
      nodes[from!] ??= { label: from! };
      nodes[to!] ??= { label: to! };
      continue;
    }
    const nodeMatch = line.match(/^(\S+):\s*(.+)$/);
    if (nodeMatch) {
      const [, id, lbl] = nodeMatch;
      nodes[id!] = { label: lbl!.trim() };
    }
  }

  const dotLines: string[] = ["digraph G {"];
  for (const [id, n] of Object.entries(nodes)) {
    dotLines.push(`  ${id} [label=${JSON.stringify(n.label)}];`);
  }
  for (const e of edges) {
    const lbl = e.label ? ` [label=${JSON.stringify(e.label)}]` : "";
    dotLines.push(`  ${e.from} -> ${e.to}${lbl};`);
  }
  dotLines.push("}");
  return extractGraphFromDot(dotLines.join("\n"));
}
