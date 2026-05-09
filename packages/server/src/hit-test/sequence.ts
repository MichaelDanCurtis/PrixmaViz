import type { HitTester } from "./index";

// Strategy 1: real PlantUML lifelines (Kroki output)
//   <g class="...participant-lifeline..." data-qualified-name="NAME">
//     <g><title>NAME</title><rect ... x="X" y="Y" width="W" height="H" /> (attributes any order)
const LIFELINE_RE = /<g[^>]*\bclass="[^"]*\bparticipant-lifeline\b[^"]*"[^>]*\bdata-qualified-name="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g;

// Strategy 2: contrived/legacy actor+participant g-tag with translate
//   <g class="actor|participant" transform="translate(cx, cy)">
const ACTOR_RE = /<g[^>]*\bclass="[^"]*\b(?:actor|participant)\b[^"]*"[^>]*\btransform="translate\(([-\d.]+)\s*,\s*([-\d.]+)\)"[^>]*>([\s\S]*?)<\/g>/g;

// Attribute-order-agnostic rect bbox extractor — handles both self-closing and open rect tags
function extractRectBox(s: string): { x: number; y: number; w: number; h: number } | null {
  const rectMatch = /<rect\b[^>]*>/.exec(s);
  if (!rectMatch) return null;
  const tag = rectMatch[0];
  const x = /\bx="([-\d.]+)"/.exec(tag);
  const y = /\by="([-\d.]+)"/.exec(tag);
  const w = /\bwidth="([\d.]+)"/.exec(tag);
  const h = /\bheight="([\d.]+)"/.exec(tag);
  if (!x || !y || !w || !h) return null;
  return { x: Number(x[1]), y: Number(y[1]), w: Number(w[1]), h: Number(h[1]) };
}

const TEXT_RE = /<text[^>]*>([^<]+)<\/text>/;

interface Box { id: string; x: number; y: number; w: number; h: number; }

function parseActors(svg: string): Box[] {
  const out: Box[] = [];

  // Strategy 1: real PlantUML lifelines (use absolute rect coords; expand thin strip
  // horizontally for clickability in the participant's column).
  LIFELINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIFELINE_RE.exec(svg)) !== null) {
    const id = m[1]!.trim();
    const inner = m[2]!;
    const r = extractRectBox(inner);
    if (!r) continue;
    // Expand the thin lifeline strip (typically 8px wide) by PAD on each side so
    // clicks anywhere within the participant's column register.
    const PAD = 28;
    out.push({ id, x: r.x - PAD, y: r.y, w: r.w + PAD * 2, h: r.h });
  }

  // Strategy 2: legacy/contrived actor or participant box with translate transform
  ACTOR_RE.lastIndex = 0;
  while ((m = ACTOR_RE.exec(svg)) !== null) {
    const cx = Number(m[1]!), cy = Number(m[2]!);
    const inner = m[3]!;
    const t = TEXT_RE.exec(inner);
    const r = extractRectBox(inner);
    if (!t || !r) continue;
    out.push({ id: t[1]!.trim(), x: cx + r.x, y: cy + r.y, w: r.w, h: r.h });
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
