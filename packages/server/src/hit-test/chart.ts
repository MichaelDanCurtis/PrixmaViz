import type { HitTester } from "./index";

const SPEC_RE = /<!--prixmaviz-spec:([A-Za-z0-9+/=]+)-->/;

interface VegaSpec {
  data?: { values?: Array<Record<string, unknown>> };
  encoding?: {
    x?: { field?: string; type?: string };
    y?: { field?: string; type?: string };
  };
  width?: number;
  height?: number;
}

function readSpec(svg: string): VegaSpec | null {
  const m = SPEC_RE.exec(svg);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8")) as VegaSpec;
  } catch { return null; }
}

function invertOrdinal(spec: VegaSpec, axis: "x" | "y", pxStart: number, pxEnd: number): unknown[] {
  const enc = spec.encoding?.[axis];
  if (!enc?.field || enc.type !== "nominal") return [];
  const values = spec.data?.values ?? [];
  const uniq = Array.from(new Set(values.map(v => String(v[enc.field!]))));
  if (!uniq.length) return [];
  const len = axis === "x" ? (spec.width ?? 0) : (spec.height ?? 0);
  if (!len) return uniq;
  const startIdx = Math.max(0, Math.floor(pxStart / len * uniq.length));
  const endIdx = Math.min(uniq.length, Math.ceil(pxEnd / len * uniq.length));
  return uniq.slice(startIdx, endIdx);
}

function invertQuantitative(spec: VegaSpec, axis: "x" | "y", pxStart: number, pxEnd: number): [number, number] | undefined {
  const enc = spec.encoding?.[axis];
  if (!enc?.field || enc.type !== "quantitative") return undefined;
  const values = spec.data?.values ?? [];
  const ns = values.map(v => Number(v[enc.field!])).filter(Number.isFinite);
  if (!ns.length) return undefined;
  const min = Math.min(...ns), max = Math.max(...ns);
  const len = axis === "x" ? (spec.width ?? 0) : (spec.height ?? 0);
  if (!len) return [min, max];
  const span = max - min;
  // Vega y axis is flipped: pxStart=top, but data max at top
  if (axis === "y") {
    const dStart = max - (pxEnd / len) * span;
    const dEnd = max - (pxStart / len) * span;
    return [dStart, dEnd];
  }
  return [min + (pxStart / len) * span, min + (pxEnd / len) * span];
}

export const chartHitTester: HitTester = {
  byPoint(svg, x, y) {
    const spec = readSpec(svg);
    if (!spec) return { nodes: [] };
    const xv = invertOrdinal(spec, "x", x, x).length
      ? invertOrdinal(spec, "x", x, x)
      : invertQuantitative(spec, "x", x, x);
    const yv = invertOrdinal(spec, "y", y, y).length
      ? invertOrdinal(spec, "y", y, y)
      : invertQuantitative(spec, "y", y, y);
    return { nodes: [], data: { x: xv, y: yv } };
  },
  byRegion(svg, region) {
    const spec = readSpec(svg);
    if (!spec) return { nodes: [] };
    const xv = invertOrdinal(spec, "x", region.x, region.x + region.w).length
      ? invertOrdinal(spec, "x", region.x, region.x + region.w)
      : invertQuantitative(spec, "x", region.x, region.x + region.w);
    const yv = invertOrdinal(spec, "y", region.y, region.y + region.h).length
      ? invertOrdinal(spec, "y", region.y, region.y + region.h)
      : invertQuantitative(spec, "y", region.y, region.y + region.h);
    return { nodes: [], dataRange: { x: xv, y: yv } };
  },
};
