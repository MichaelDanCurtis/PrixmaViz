import { describe, expect, it } from "bun:test";
import { xmlEscape, buildShapeXml, buildConnectorXml, buildPageXml } from "../../src/vsdx/xml-builder";

describe("xmlEscape", () => {
  it("escapes &, <, >, \", '", () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("buildShapeXml", () => {
  it("emits <Shape> with positional cells", () => {
    const out = buildShapeXml({
      id: "1", master: "Process", masterId: "1", text: "Hello",
      x: 1.5, y: 2.5, w: 1.0, h: 0.75,
    });
    expect(out).toContain('ID="1"');
    expect(out).toContain('Master="1"');
    expect(out).toContain("<Text>Hello</Text>");
    expect(out).toMatch(/N="PinX"\s+V="1\.5"/);
    expect(out).toMatch(/N="PinY"\s+V="2\.5"/);
  });
  it("escapes shape text", () => {
    const out = buildShapeXml({
      id: "1", master: "Process", masterId: "1", text: "A & B",
      x: 0, y: 0, w: 1, h: 1,
    });
    expect(out).toContain("A &amp; B");
  });
});

describe("buildConnectorXml", () => {
  it("emits <Shape> with BeginX/EndX glued to other shape IDs", () => {
    const out = buildConnectorXml({
      id: "3", from: "1", to: "2", text: "go",
    });
    expect(out).toContain("Sheet.1");
    expect(out).toContain("Sheet.2");
    expect(out).toContain("<Text>go</Text>");
  });
});

describe("buildPageXml", () => {
  it("composes shapes + connectors under <PageContents>", () => {
    const shapes = [buildShapeXml({ id: "1", master: "Process", masterId: "1", text: "A", x: 0, y: 0, w: 1, h: 1 })];
    const conns = [buildConnectorXml({ id: "2", from: "1", to: "1" })];
    const xml = buildPageXml(shapes, conns);
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<PageContents");
    expect(xml).toContain("<Shapes>");
    expect(xml.indexOf("Sheet.1")).toBeGreaterThan(0);
  });
});
