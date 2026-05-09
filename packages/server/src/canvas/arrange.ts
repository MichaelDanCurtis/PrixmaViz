import type { Tile } from "@prixmaviz/shared";

export type ArrangeStyle = "grid" | "horizontal" | "vertical";

export function arrange(tiles: Tile[], style: ArrangeStyle, padding: number = 20): Tile[] {
  if (style === "horizontal") {
    let x = 0;
    return tiles.map(t => {
      const out = { ...t, x, y: 0 };
      x += t.w + padding;
      return out;
    });
  }
  if (style === "vertical") {
    let y = 0;
    return tiles.map(t => {
      const out = { ...t, x: 0, y };
      y += t.h + padding;
      return out;
    });
  }
  // grid: square-ish
  const cols = Math.ceil(Math.sqrt(tiles.length));
  const w = Math.max(...tiles.map(t => t.w), 1);
  const h = Math.max(...tiles.map(t => t.h), 1);
  return tiles.map((t, i) => ({
    ...t,
    x: (i % cols) * (w + padding),
    y: Math.floor(i / cols) * (h + padding),
  }));
}
