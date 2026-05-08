import type { HitTester, HitResult, RegionHitResult } from "./index";

const ID_RE = /<g[^>]*\sid="flowchart-([^"]+)-\d+"[^>]*>/g;
const TRANSLATE_RE = /transform="translate\(([-\d.]+)\s*,\s*([-\d.]+)\)"/;
// Path-based bbox: first M(-X, -Y) pair gives half-dimensions (Mermaid outer-path nodes)
const PATH_M_RE = /<path[^>]*\sd="M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/;
// Rect-based bbox (fallback for contrived fixtures and rect-container real nodes)
const RECT_RE = /<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/;

interface NodeBox {
  id: string;
  x: number; y: number; w: number; h: number;
}

function parseNodes(svg: string): NodeBox[] {
  const out: NodeBox[] = [];
  ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ID_RE.exec(svg)) !== null) {
    const id = m[1]!;
    const start = m.index;
    const tag = m[0];
    // Slice up to the first </g> after this node's open tag.
    // For nested structures (outer-path nodes) this captures the full node subtree;
    // for simple nodes it captures just the node content before the closing tag.
    const tEnd = svg.indexOf("</g>", start);
    const inner = tEnd > 0 ? svg.slice(start, tEnd) : tag;

    const tr = TRANSLATE_RE.exec(tag) ?? TRANSLATE_RE.exec(inner);
    if (!tr) continue;
    const cx = Number(tr[1]!);
    const cy = Number(tr[2]!);

    // Strategy 1: path-based (real Kroki Mermaid SVGs use outer-path nodes)
    // The first M(-X, -Y) in the path d attribute encodes half-width and half-height.
    // Skip degenerate paths where hx==0 (cylindrical/elliptic shapes with M 0 Y).
    const pathM = PATH_M_RE.exec(inner);
    if (pathM) {
      const halfW = Math.abs(Number(pathM[1]!));
      const halfH = Math.abs(Number(pathM[2]!));
      if (halfW > 0 && halfH > 0) {
        out.push({ id, x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 });
        continue;
      }
    }

    // Strategy 2: rect-based (fallback for contrived fixtures and rect-container real nodes)
    const rect = RECT_RE.exec(inner);
    if (rect) {
      const rx = Number(rect[1]!);
      const ry = Number(rect[2]!);
      const w = Number(rect[3]!);
      const h = Number(rect[4]!);
      out.push({ id, x: cx + rx, y: cy + ry, w, h });
      continue;
    }
    // No match: skip (e.g. circle, polygon, cylinder node shapes)
  }
  return out;
}

export const graphHitTester: HitTester = {
  byPoint(svg, x, y): HitResult {
    const boxes = parseNodes(svg);
    const hits: string[] = [];
    for (const b of boxes) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        hits.push(b.id);
      }
    }
    return { nodes: hits };
  },
  byRegion(svg, region): RegionHitResult {
    const boxes = parseNodes(svg);
    const hits: string[] = [];
    for (const b of boxes) {
      const x2 = b.x + b.w;
      const y2 = b.y + b.h;
      const rx2 = region.x + region.w;
      const ry2 = region.y + region.h;
      // AABB intersect
      if (b.x < rx2 && x2 > region.x && b.y < ry2 && y2 > region.y) {
        hits.push(b.id);
      }
    }
    return { nodes: hits };
  },
};
