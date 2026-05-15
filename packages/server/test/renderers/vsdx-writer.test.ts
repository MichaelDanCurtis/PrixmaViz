import { describe, expect, it } from "bun:test";
import { writeVsdxFromIr } from "../../src/renderers/vsdx-writer";
import { parseVsdx } from "../../src/renderers/vsdx-parse";
import type { GraphIR, Node } from "@prixmaviz/shared";

function sampleIr(): GraphIR {
  return {
    layout: { direction: "TB" },
    nodes: {
      a: { id: "a", label: "Alpha", shape: "rect",    _x: 1.0, _y: 5.0 } as unknown as GraphIR["nodes"][string],
      b: { id: "b", label: "Beta",  shape: "diamond", _x: 3.0, _y: 5.0 } as unknown as GraphIR["nodes"][string],
    },
    edges: {
      e1: { id: "e1", from: "a", to: "b", label: "go" },
    },
    groups: {},
  };
}

describe("writeVsdxFromIr", () => {
  it("produces a valid ZIP (PK magic)", async () => {
    const { bytes } = await writeVsdxFromIr(sampleIr());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it("round-trips through parser to the same shape/connector graph", async () => {
    const ir = sampleIr();
    const { bytes } = await writeVsdxFromIr(ir);
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages).toHaveLength(1);
    const page = parsed.pages[0]!;
    expect(page.shapes).toHaveLength(2);
    const a = page.shapes.find((s) => s.text === "Alpha")!;
    const b = page.shapes.find((s) => s.text === "Beta")!;
    expect(a.master).toBe("Process");
    expect(b.master).toBe("Decision");
    expect(page.connectors).toHaveLength(1);
    expect(page.connectors[0]!.text).toBe("go");
  });

  it("emits master100.xml for the Dynamic Connector reference", async () => {
    const { bytes } = await writeVsdxFromIr(sampleIr());
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const master100 = zip.file("visio/masters/master100.xml");
    expect(master100).not.toBeNull();
    const content = await master100!.async("string");
    expect(content).toContain("ObjType");
    // mastersIndexXml() exposes ID=100 as "Dynamic connector" — the masters
    // index references this part, so the part itself just needs to be valid
    // MasterContents XML. We also check that masters.xml declares ID=100.
    const masters = zip.file("visio/masters/masters.xml");
    expect(masters).not.toBeNull();
    const mastersContent = await masters!.async("string");
    expect(mastersContent).toContain(`ID="100"`);
    expect(mastersContent).toContain("Dynamic connector");
  });

  it("emits distinct geometry for pentagon, hexagon, octagon, star, cylinder", async () => {
    const ir: GraphIR = {
      layout: { direction: "TB" },
      nodes: {
        p:   { id: "p",   label: "P",   shape: "pentagon" } as Node,
        h:   { id: "h",   label: "H",   shape: "hexagon" } as Node,
        o:   { id: "o",   label: "O",   shape: "octagon" } as Node,
        s:   { id: "s",   label: "S",   shape: "star" } as Node,
        cyl: { id: "cyl", label: "Cyl", shape: "cylinder" } as Node,
      },
      edges: {},
      groups: {},
    };
    const { bytes } = await writeVsdxFromIr(ir);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");
    // Each shape gets its own inline geometry, so each <Shape> block must be
    // distinct. IDs map by Object.entries order: p=1, h=2, o=3, s=4, cyl=5.
    const pentagonShape = page.match(/<Shape ID="1"[^>]*>.*?<\/Shape>/s)![0];
    const hexagonShape  = page.match(/<Shape ID="2"[^>]*>.*?<\/Shape>/s)![0];
    const octagonShape  = page.match(/<Shape ID="3"[^>]*>.*?<\/Shape>/s)![0];
    const starShape     = page.match(/<Shape ID="4"[^>]*>.*?<\/Shape>/s)![0];
    const cylShape      = page.match(/<Shape ID="5"[^>]*>.*?<\/Shape>/s)![0];
    // Pentagon != hexagon — these were previously identical when pentagon
    // fell through to hexagon.
    expect(pentagonShape).not.toBe(hexagonShape);
    // Octagon != hexagon — same fall-through bug.
    expect(octagonShape).not.toBe(hexagonShape);
    // Star != triangle — star previously fell through to triangle.
    // We can't easily compare to a triangle here, but we can check the
    // line-segment count: 10 outer+inner edges for a real 5-point star.
    expect((starShape.match(/<Row T="RelLineTo"/g) ?? []).length).toBe(10);
    // Pentagon has 5 line segments + 1 MoveTo = 6 rows total.
    expect((pentagonShape.match(/<Row T="RelLineTo"/g) ?? []).length).toBe(5);
    // Hexagon has 6 line segments.
    expect((hexagonShape.match(/<Row T="RelLineTo"/g) ?? []).length).toBe(6);
    // Octagon has 8 line segments.
    expect((octagonShape.match(/<Row T="RelLineTo"/g) ?? []).length).toBe(8);
    // Cylinder uses elliptical arcs for the caps — should have at least one.
    expect(cylShape).toContain("RelEllipticalArcTo");
  });

  it("warns on edges referencing missing nodes", async () => {
    const ir: GraphIR = {
      layout: { direction: "TB" },
      nodes: { a: { id: "a", label: "A", shape: "rect" } as Node },
      edges: {
        e1: { id: "e1", from: "a", to: "ghost" },   // ghost doesn't exist
        e2: { id: "e2", from: "phantom", to: "a" }, // phantom doesn't exist
      },
      groups: {},
    };
    const { warnings } = await writeVsdxFromIr(ir);
    expect(warnings.length).toBe(2);
    expect(warnings.join("\n")).toContain("ghost");
    expect(warnings.join("\n")).toContain("phantom");
  });
});
