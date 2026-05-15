import { describe, expect, it } from "bun:test";
import { writeVsdxFromSvg } from "../../src/renderers/vsdx-writer-fallback";
import { parseVsdx } from "../../src/renderers/vsdx-parse";

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';

describe("writeVsdxFromSvg", () => {
  it("produces a valid vsdx containing one page with embedded image", async () => {
    const bytes = await writeVsdxFromSvg(SAMPLE_SVG);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages.length).toBe(1);
    expect(parsed.pages[0]!.shapes.length).toBeGreaterThan(0);
  });
});
