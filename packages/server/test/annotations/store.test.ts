import { describe, expect, it } from "bun:test";
import { AnnotationStore } from "../../src/annotations/store";
import type { Annotation } from "@prixmaviz/shared";

function fix(id: string, kind: Annotation["kind"]): Annotation {
  return { id, kind, createdAt: "2026-05-07T00:00:00Z" };
}

describe("AnnotationStore", () => {
  it("add + listByDiagram", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.add("d1", fix("a2", "pin"));
    s.add("d2", fix("a3", "region"));
    const d1 = s.listByDiagram("d1");
    expect(d1.length).toBe(2);
    expect(d1.map(a => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("update modifies existing", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.update("d1", "a1", { text: "hello" });
    expect(s.listByDiagram("d1")[0]?.text).toBe("hello");
  });

  it("update on missing throws", () => {
    const s = new AnnotationStore();
    expect(() => s.update("d1", "nope", { text: "x" })).toThrow(/not found/);
  });

  it("delete removes", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.delete("d1", "a1");
    expect(s.listByDiagram("d1")).toEqual([]);
  });

  it("resolve sets resolvedAt", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    const t = "2026-05-07T01:00:00Z";
    s.update("d1", "a1", { resolvedAt: t });
    expect(s.listByDiagram("d1")[0]?.resolvedAt).toBe(t);
  });

  it("loadFromDiagram replaces", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.loadFromDiagram("d1", [fix("b1", "pin"), fix("b2", "region")]);
    const out = s.listByDiagram("d1");
    expect(out.map(a => a.id).sort()).toEqual(["b1", "b2"]);
  });
});
