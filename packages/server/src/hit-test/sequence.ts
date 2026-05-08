import type { HitTester } from "./index";

const ACTOR_RE = /<g[^>]*class="(?:actor|participant)"[^>]*transform="translate\(([-\d.]+)\s*,\s*([-\d.]+)\)"[^>]*>([\s\S]*?)<\/g>/g;
const TEXT_RE = /<text[^>]*>([^<]+)<\/text>/;
const RECT_RE = /<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/;

interface Box { id: string; x: number; y: number; w: number; h: number; }

function parseActors(svg: string): Box[] {
  const out: Box[] = [];
  ACTOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACTOR_RE.exec(svg)) !== null) {
    const cx = Number(m[1]!), cy = Number(m[2]!);
    const inner = m[3]!;
    const t = TEXT_RE.exec(inner);
    const r = RECT_RE.exec(inner);
    if (!t || !r) continue;
    out.push({
      id: t[1]!.trim(),
      x: cx + Number(r[1]!), y: cy + Number(r[2]!),
      w: Number(r[3]!), h: Number(r[4]!),
    });
  }
  return out;
}

export const sequenceHitTester: HitTester = {
  byPoint(svg, x, y) {
    const boxes = parseActors(svg);
    return { nodes: boxes.filter(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h).map(b => b.id) };
  },
  byRegion(svg, region) {
    const boxes = parseActors(svg);
    return {
      nodes: boxes.filter(b => {
        const x2 = b.x + b.w, y2 = b.y + b.h;
        const rx2 = region.x + region.w, ry2 = region.y + region.h;
        return b.x < rx2 && x2 > region.x && b.y < ry2 && y2 > region.y;
      }).map(b => b.id),
    };
  },
};
