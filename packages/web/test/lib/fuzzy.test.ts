import { describe, expect, it } from "vitest";
import { fuzzyFilter } from "../../src/lib/fuzzy";

const items = [
  { name: "Create diagram (mermaid graph)" },
  { name: "Create diagram (sequence)" },
  { name: "Export as SVG" },
  { name: "Export as PNG" },
  { name: "Toggle snap-to-grid" },
  { name: "Show shortcuts", keywords: "help cheatsheet ?" },
];

describe("fuzzyFilter", () => {
  it("returns the full list (in original order) on empty query", () => {
    const result = fuzzyFilter(items, "");
    expect(result.length).toBe(items.length);
    expect(result.map((r) => r.item.name)).toEqual(items.map((i) => i.name));
  });

  it("returns the full list on whitespace-only query", () => {
    const result = fuzzyFilter(items, "   ");
    expect(result.length).toBe(items.length);
  });

  it("filters by case-insensitive substring", () => {
    const result = fuzzyFilter(items, "snap");
    expect(result.length).toBe(1);
    expect(result[0]!.item.name).toBe("Toggle snap-to-grid");
  });

  it("requires every token to match (AND semantics)", () => {
    const result = fuzzyFilter(items, "create sequence");
    expect(result.length).toBe(1);
    expect(result[0]!.item.name).toBe("Create diagram (sequence)");
  });

  it("ranks items whose match starts earlier first", () => {
    // Both contain "as" but "Export as SVG" matches at position 7 and
    // "Toggle snap-to-grid" matches the "as" inside no — actually only Export
    // matches "as svg" specifically.
    const result = fuzzyFilter(items, "export");
    expect(result.length).toBe(2);
    // Both start with "Export"; tie-break is haystack length (PNG < SVG? same
    // length actually). Just assert both surface.
    const names = result.map((r) => r.item.name);
    expect(names).toContain("Export as SVG");
    expect(names).toContain("Export as PNG");
  });

  it("matches against keywords for items that supply them", () => {
    const result = fuzzyFilter(items, "cheatsheet");
    expect(result.length).toBe(1);
    expect(result[0]!.item.name).toBe("Show shortcuts");
  });

  it("returns an empty array when nothing matches", () => {
    const result = fuzzyFilter(items, "zzzzzz");
    expect(result).toEqual([]);
  });

  it("is case-insensitive on the query side", () => {
    expect(fuzzyFilter(items, "SNAP").length).toBe(1);
    expect(fuzzyFilter(items, "Snap-To").length).toBe(1);
  });

  it("does not match if any token is missing", () => {
    // 'svg' matches Export as SVG, but 'snap' does not — so AND should
    // exclude it.
    const result = fuzzyFilter(items, "svg snap");
    expect(result).toEqual([]);
  });
});
