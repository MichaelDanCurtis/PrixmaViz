import type { HitTester, HitResult, RegionHitResult } from "./index";

const ID_RE = /<g[^>]*\sid="flowchart-([^"]+)-\d+"[^>]*>/g;
const TRANSLATE_RE = /transform="translate\(([-\d.]+)\s*,\s*([-\d.]+)\)"/;
const RECT_RE = /<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/;

interface NodeBox {
  id: string;
  cx: number; cy: number;
  x: number; y: number; w: number; h: number;
}

function parseNodes(svg: string): NodeBox[] {
  const out: NodeBox[] = [];
  ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ID_RE.exec(svg)) !== null) {
    const id = m[1]!;
    // Find this <g>'s end index, then read its inner content for transform + rect.
    const start = m.index;
    const tag = m[0];
    const tEnd = svg.indexOf("</g>", start);
    const inner = tEnd > 0 ? svg.slice(start, tEnd) : tag;
    const tr = TRANSLATE_RE.exec(tag) ?? TRANSLATE_RE.exec(inner);
    const rect = RECT_RE.exec(inner);
    if (!tr || !rect) continue;
    const cx = Number(tr[1]!);
    const cy = Number(tr[2]!);
    const rx = Number(rect[1]!);
    const ry = Number(rect[2]!);
    const w = Number(rect[3]!);
    const h = Number(rect[4]!);
    out.push({ id, cx, cy, x: cx + rx, y: cy + ry, w, h });
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
