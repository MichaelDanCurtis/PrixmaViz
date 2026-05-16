import type { Tile } from "@prixmaviz/shared";

export interface SnapshotTile extends Pick<Tile, "id" | "x" | "y" | "w" | "h"> {
  /** Optional — passed straight through to `getTileSvg`. */
  diagramId?: string;
}

export interface ComposeSvgInput {
  tiles: SnapshotTile[];
  /**
   * Outer padding around the bounding box of all tiles, in canvas units.
   * Applied uniformly on every side. Default 40 matches D3's input schema.
   */
  padding?: number;
  /**
   * CSS color for the outer rect, or `"transparent"` to omit the rect
   * entirely. Default `"transparent"`.
   */
  background?: string;
  /**
   * Pure function that returns the cached SVG for a tile. Injected so the
   * helper can be unit-tested against synthetic SVGs without going through
   * the real DB and Kroki cache.
   *
   * Return `null` for a tile that has no cached SVG; the composer will
   * skip it and continue (the caller's `tileCount` should still include
   * those tiles so callers can detect partial composition).
   */
  getTileSvg: (tile: SnapshotTile) => string | null | Promise<string | null>;
}

export interface ComposeSvgOutput {
  /** The composed outer SVG as a serialized string. */
  svg: string;
  /** Pixel width of the outer SVG (includes padding on both sides). */
  width: number;
  /** Pixel height of the outer SVG (includes padding on both sides). */
  height: number;
}

/**
 * Compose a workspace into a single SVG. Each tile is wrapped in an inner
 * `<svg x="..." y="..." width="..." height="..." viewBox="...">` element
 * so per-tile coordinate systems stay independent, and every `id="..."` /
 * `href="#..."` / `url(#...)` reference inside that tile is prefixed with
 * `t${index}_` so SVGs that share id names (e.g. multiple mermaid renders
 * with `id="flowchart-A-0"`) don't collide.
 *
 * The composition runs in one pass per tile and uses no SVG parser — the
 * regex-based id rewrite is good enough for typical Kroki output and
 * keeps the helper dependency-free and synchronous (apart from the
 * `getTileSvg` lookup).
 *
 * `getTileSvg` is injected so callers can swap in a mock for tests; the
 * helper makes no assumption about where the per-tile SVG comes from
 * (cached column on `diagrams.svg`, fresh render, in-memory fixture).
 */
export async function composeWorkspaceSvg(
  input: ComposeSvgInput,
): Promise<ComposeSvgOutput> {
  const padding = input.padding ?? 40;
  const background = input.background ?? "transparent";

  // 1. Compute the bounding box of all tiles.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of input.tiles) {
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x + t.w > maxX) maxX = t.x + t.w;
    if (t.y + t.h > maxY) maxY = t.y + t.h;
  }
  if (!Number.isFinite(minX)) {
    // No tiles → emit a tiny empty canvas so the output is still valid SVG.
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  const innerWidth = maxX - minX;
  const innerHeight = maxY - minY;
  const width = innerWidth + padding * 2;
  const height = innerHeight + padding * 2;

  // 2. Emit per-tile inner SVGs, translated into the outer coordinate space.
  const tileBlocks: string[] = [];
  for (let i = 0; i < input.tiles.length; i++) {
    const tile = input.tiles[i]!;
    const tileSvg = await input.getTileSvg(tile);
    if (tileSvg == null) continue;

    const prefix = `t${i}_`;
    const prefixed = prefixSvgIds(tileSvg, prefix);
    const inner = unwrapSvg(prefixed);

    const x = tile.x - minX + padding;
    const y = tile.y - minY + padding;
    tileBlocks.push(
      `<svg x="${x}" y="${y}" width="${tile.w}" height="${tile.h}" ` +
        `viewBox="${inner.viewBox}" overflow="visible">` +
        inner.content +
        `</svg>`,
    );
  }

  const bgRect =
    background === "transparent"
      ? ""
      : `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(background)}"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    bgRect +
    tileBlocks.join("") +
    `</svg>`;

  return { svg, width, height };
}

// ───────────────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────────────

/**
 * Strip the outer `<svg ...>...</svg>` wrapper, returning the inner content
 * and the original viewBox (so we can preserve coordinate-space scaling
 * when we re-wrap the content in our own placed `<svg>`).
 *
 * If no `<svg ...>` open tag is found (e.g. a plain `<g>` fragment from a
 * custom renderer), the input is returned verbatim and the viewBox falls
 * back to "0 0 <bestguess>".
 */
function unwrapSvg(svg: string): { content: string; viewBox: string } {
  const openMatch = /<svg\b([^>]*)>/i.exec(svg);
  if (!openMatch) {
    return { content: svg, viewBox: "0 0 100 100" };
  }
  const openEnd = openMatch.index + openMatch[0].length;
  const closeMatch = /<\/svg\s*>/i.exec(svg.slice(openEnd));
  if (!closeMatch) {
    return { content: svg.slice(openEnd), viewBox: "0 0 100 100" };
  }
  const content = svg.slice(openEnd, openEnd + closeMatch.index);

  // Try the viewBox first; fall back to width/height if absent.
  const attrs = openMatch[1] ?? "";
  const vbMatch = /\bviewBox\s*=\s*"([^"]+)"/i.exec(attrs);
  if (vbMatch) return { content, viewBox: vbMatch[1]!.trim() };

  const wMatch = /\bwidth\s*=\s*"([\d.]+)(?:px)?"/i.exec(attrs);
  const hMatch = /\bheight\s*=\s*"([\d.]+)(?:px)?"/i.exec(attrs);
  if (wMatch && hMatch) {
    return { content, viewBox: `0 0 ${wMatch[1]} ${hMatch[1]}` };
  }
  return { content, viewBox: "0 0 100 100" };
}

/**
 * Prefix every `id="..."`, `href="#..."`, `xlink:href="#..."`, and
 * `url(#...)` reference in the input SVG string with the supplied
 * `prefix`. One pass per attribute kind.
 *
 * This collapses id-collision risk to zero across all tile renders that
 * share the same id namespace (mermaid is the worst offender — every
 * generated flowchart re-uses `id="flowchart-A-0"`).
 */
function prefixSvgIds(svg: string, prefix: string): string {
  // id="foo" → id="t0_foo"
  let out = svg.replace(/(\bid\s*=\s*")([^"]+)(")/g, (_, lead, id, tail) => {
    return `${lead}${prefix}${id}${tail}`;
  });
  // href="#foo" / xlink:href="#foo" → href="#t0_foo"
  out = out.replace(
    /((?:xlink:)?href\s*=\s*")#([^"]+)(")/g,
    (_, lead, id, tail) => `${lead}#${prefix}${id}${tail}`,
  );
  // url(#foo) → url(#t0_foo) — both in attributes and inline CSS.
  out = out.replace(
    /url\(\s*#([^)\s]+)\s*\)/g,
    (_, id) => `url(#${prefix}${id})`,
  );
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
