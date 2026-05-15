import { describe, expect, it } from "vitest";
import { svgToBlob, getExportFilename } from "../../src/lib/export";

describe("export utilities", () => {
  it("svgToBlob produces an SVG blob", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    const blob = await svgToBlob(svg, "svg");
    expect(blob.type).toBe("image/svg+xml");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("getExportFilename produces sane names", () => {
    expect(getExportFilename("auth-sequence", "png")).toBe("auth-sequence.png");
    expect(getExportFilename("system-architecture", "svg")).toBe("system-architecture.svg");
    expect(getExportFilename("untitled", "jpeg")).toBe("untitled.jpg");
  });

  it("getExportFilename handles vsdx", () => {
    expect(getExportFilename("flow", "vsdx")).toBe("flow.vsdx");
  });
});
