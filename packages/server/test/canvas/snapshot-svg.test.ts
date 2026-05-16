import { describe, expect, it } from "bun:test";
import {
  composeWorkspaceSvg,
  type SnapshotTile,
} from "../../src/canvas/snapshot-svg";

const tileSvgA = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">
  <defs><marker id="arrow"><path d="M0,0 L10,5 Z"/></marker></defs>
  <g id="root"><rect id="r1" x="0" y="0" width="100" height="80" fill="red"/></g>
  <use href="#r1"/>
  <line marker-end="url(#arrow)" x1="0" y1="0" x2="100" y2="80"/>
</svg>`;

const tileSvgB = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40">
  <g id="root"><circle id="c1" cx="30" cy="20" r="10" fill="blue"/></g>
</svg>`;

describe("composeWorkspaceSvg", () => {
  it("composes two tiles into a single outer svg with the correct overall size", async () => {
    const tiles: SnapshotTile[] = [
      { id: "t1", x: 10, y: 20, w: 100, h: 80 },
      { id: "t2", x: 200, y: 50, w: 60, h: 40 },
    ];
    const out = await composeWorkspaceSvg({
      tiles,
      padding: 40,
      getTileSvg: (t) => (t.id === "t1" ? tileSvgA : tileSvgB),
    });

    // Bounding box: x 10..260, y 20..100 → 250 × 80; + padding(40)*2 on each axis.
    expect(out.width).toBe(250 + 80);
    expect(out.height).toBe(80 + 80);

    // Outer SVG carries the right dims + viewBox.
    expect(out.svg).toContain(`width="${out.width}"`);
    expect(out.svg).toContain(`height="${out.height}"`);
    expect(out.svg).toContain(`viewBox="0 0 ${out.width} ${out.height}"`);
    expect(out.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("emits a nested <svg> per tile with translated x/y", async () => {
    const tiles: SnapshotTile[] = [
      { id: "t1", x: 10, y: 20, w: 100, h: 80 },
      { id: "t2", x: 200, y: 50, w: 60, h: 40 },
    ];
    const out = await composeWorkspaceSvg({
      tiles,
      padding: 40,
      getTileSvg: (t) => (t.id === "t1" ? tileSvgA : tileSvgB),
    });

    // minX=10, minY=20, padding=40 → tile1 at (0+40, 0+40) = (40, 40)
    expect(out.svg).toMatch(/<svg x="40" y="40" width="100" height="80"/);
    // tile2 at (200-10+40, 50-20+40) = (230, 70)
    expect(out.svg).toMatch(/<svg x="230" y="70" width="60" height="40"/);
  });

  it("prefixes ids with t0_/t1_ so cross-tile id collisions cannot occur", async () => {
    const tiles: SnapshotTile[] = [
      { id: "t1", x: 0, y: 0, w: 100, h: 80 },
      { id: "t2", x: 200, y: 0, w: 60, h: 40 },
    ];
    const out = await composeWorkspaceSvg({
      tiles,
      getTileSvg: (t) => (t.id === "t1" ? tileSvgA : tileSvgB),
    });

    // The shared id `root` is namespaced to each tile.
    expect(out.svg).toContain('id="t0_root"');
    expect(out.svg).toContain('id="t1_root"');
    // Inner uses of the same id are rewritten too.
    expect(out.svg).toContain('id="t0_arrow"');
    expect(out.svg).toContain('href="#t0_r1"');
    expect(out.svg).toContain('url(#t0_arrow)');
    // No un-prefixed shared id remains in the composed output.
    expect(out.svg).not.toMatch(/id="root"/);
    expect(out.svg).not.toMatch(/href="#r1"/);
  });

  it("skips tiles whose getTileSvg returns null but keeps positions of remaining tiles", async () => {
    const tiles: SnapshotTile[] = [
      { id: "missing", x: 0, y: 0, w: 100, h: 80 },
      { id: "present", x: 200, y: 0, w: 60, h: 40 },
    ];
    const out = await composeWorkspaceSvg({
      tiles,
      getTileSvg: (t) => (t.id === "missing" ? null : tileSvgB),
    });
    expect(out.svg).not.toContain('id="t0_');
    // The present tile is at index 1 — its prefix is "t1_".
    expect(out.svg).toContain('id="t1_root"');
  });

  it("emits a tiny empty svg when there are zero tiles", async () => {
    const out = await composeWorkspaceSvg({
      tiles: [],
      padding: 40,
      getTileSvg: () => null,
    });
    expect(out.width).toBe(80); // 0 + padding*2
    expect(out.height).toBe(80);
    expect(out.svg).toMatch(/<svg[^>]*><\/svg>/);
  });

  it("renders a solid background rect when background is non-transparent", async () => {
    const out = await composeWorkspaceSvg({
      tiles: [{ id: "t1", x: 0, y: 0, w: 100, h: 80 }],
      background: "#ffffff",
      getTileSvg: () => tileSvgA,
    });
    expect(out.svg).toContain('fill="#ffffff"');
    expect(out.svg).toMatch(/<rect x="0" y="0" width="\d+" height="\d+"/);
  });

  it("omits the background rect when background is 'transparent'", async () => {
    const out = await composeWorkspaceSvg({
      tiles: [{ id: "t1", x: 0, y: 0, w: 100, h: 80 }],
      background: "transparent",
      getTileSvg: () => tileSvgA,
    });
    // No background rect — the outer svg's only direct rect would be inside
    // a nested <svg>, never at the top level.
    expect(out.svg).not.toMatch(/^<svg[^>]*><rect /);
  });
});
