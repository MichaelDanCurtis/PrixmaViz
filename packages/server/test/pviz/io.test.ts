import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPviz, writePviz, listPvizEntries } from "../../src/pviz/io";
import { emptyGraphIR, emptyMeta, PVIZ_VERSION } from "@prixmaviz/shared";
import type { Diagram } from "@prixmaviz/shared";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pviz-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeDiagram(name: string): Diagram {
  return {
    id: "d_test",
    name,
    engine: "mermaid",
    kind: "graph",
    ir: emptyGraphIR(),
    meta: emptyMeta("2026-05-06T00:00:00Z"),
  };
}

describe("writePviz / readPviz", () => {
  it("roundtrips a graph diagram", async () => {
    const d = makeDiagram("hello world");
    const written = await writePviz(dir, d, "<svg/>");
    expect(written.path).toMatch(/hello-world\.pviz$/);
    const back = await readPviz(written.path);
    expect(back.version).toBe(PVIZ_VERSION);
    expect(back.id).toBe("d_test");
    expect(back.name).toBe("hello world");
    expect(back.kind).toBe("graph");
  });

  it("writes sibling .svg", async () => {
    const d = makeDiagram("svg-test");
    const written = await writePviz(dir, d, "<svg id='x'/>");
    const svgPath = written.path.replace(/\.pviz$/, ".svg");
    const svg = await Bun.file(svgPath).text();
    expect(svg).toContain("id='x'");
  });

  it("resolves slug conflicts for diagrams with different ids", async () => {
    const a = makeDiagram("dup");
    const b = makeDiagram("dup");
    b.id = "d_other"; // different id → genuine new diagram, not an overwrite
    await writePviz(dir, a, "<svg/>");
    const second = await writePviz(dir, b, "<svg/>");
    expect(second.path).toMatch(/dup-2\.pviz$/);
  });
});

describe("listPvizEntries", () => {
  it("returns library entries from dir scan", async () => {
    const d = makeDiagram("one");
    await writePviz(dir, d, "<svg/>");
    const list = await listPvizEntries(dir);
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("one");
    expect(list[0]!.engine).toBe("mermaid");
  });

  it("returns empty list when dir missing", async () => {
    const list = await listPvizEntries(join(dir, "nope"));
    expect(list).toEqual([]);
  });
});

describe("annotations roundtrip", () => {
  it("preserves annotations across write+read", async () => {
    const d = makeDiagram("with-annot");
    d.annotations = [
      { id: "ann_001", kind: "tag", targetNodes: ["a"], text: "rename", createdAt: "2026-05-07T00:00:00Z" },
      { id: "ann_002", kind: "pin", point: { x: 10, y: 20 }, text: "weird", createdAt: "2026-05-07T00:01:00Z" },
    ];
    const written = await writePviz(dir, d, "<svg/>");
    const back = await readPviz(written.path);
    expect(back.annotations?.length).toBe(2);
    expect(back.annotations?.[0]?.kind).toBe("tag");
    expect(back.annotations?.[1]?.point).toEqual({ x: 10, y: 20 });
  });
});

describe("writePviz overwrite by id", () => {
  it("overwrites existing .pviz when diagram id matches (does not create -2 suffix)", async () => {
    const d = makeDiagram("overwrite-test");
    const first = await writePviz(dir, d, "<svg/>");
    expect(first.slug).toBe("overwrite-test");

    // Add an annotation and save again with the SAME diagram id
    d.annotations = [{ id: "ann_X", kind: "tag", createdAt: "2026-05-08T00:00:00Z" }];
    const second = await writePviz(dir, d, "<svg/>");

    expect(second.slug).toBe("overwrite-test"); // SAME slug, not overwrite-test-2
    expect(second.path).toBe(first.path);

    // Re-read and verify the annotation is on disk
    const back = await readPviz(second.path);
    expect(back.annotations?.length).toBe(1);
    expect(back.annotations?.[0]?.id).toBe("ann_X");
  });

  it("still suffixes when a different diagram has the same name (different id)", async () => {
    const d1 = makeDiagram("collision-test");
    const first = await writePviz(dir, d1, "<svg/>");
    expect(first.slug).toBe("collision-test");

    // Different diagram with same name but explicitly different id
    const d2 = makeDiagram("collision-test");
    d2.id = "d_other";
    expect(d2.id).not.toBe(d1.id);
    const second = await writePviz(dir, d2, "<svg/>");
    expect(second.slug).toBe("collision-test-2");
  });
});
