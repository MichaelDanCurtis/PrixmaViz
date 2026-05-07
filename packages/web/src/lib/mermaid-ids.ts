const NODE_RE = /^flowchart-(.+)-\d+$/;
const EDGE_RE = /^L-(.+)-(.+)-\d+$/;

export function extractMermaidNodeId(svgId: string): string | null {
  const m = svgId.match(NODE_RE);
  return m ? m[1]! : null;
}

export function extractMermaidEdgeId(svgId: string): { from: string; to: string } | null {
  const m = svgId.match(EDGE_RE);
  if (!m) return null;
  return { from: m[1]!, to: m[2]! };
}
