import { describe, expect, it } from "bun:test";
import { DiagramStore } from "../../src/store/diagrams";
import { emptyGraphIR, emptyMeta } from "@prixmaviz/shared";
import type { Diagram } from "@prixmaviz/shared";

function fixture(id: string, name: string): Diagram {
  return {
    id,
    name,
    engine: "mermaid",
    kind: "graph",
    ir: emptyGraphIR(),
    meta: emptyMeta(),
  };
}

describe("DiagramStore", () => {
  it("create returns id and stores diagram", () => {
    const s = new DiagramStore();
    const d = fixture("d1", "test");
    s.put(d);
    expect(s.get("d1")).toEqual(d);
  });

  it("put with same id updates", () => {
    const s = new DiagramStore();
    s.put(fixture("d1", "old"));
    const updated = { ...fixture("d1", "new"), name: "new" };
    s.put(updated);
    expect(s.get("d1")?.name).toBe("new");
  });

  it("delete removes", () => {
    const s = new DiagramStore();
    s.put(fixture("d1", "x"));
    s.delete("d1");
    expect(s.get("d1")).toBeUndefined();
  });

  it("list returns all in insertion order", () => {
    const s = new DiagramStore();
    s.put(fixture("a", "a"));
    s.put(fixture("b", "b"));
    expect(s.list().map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("touch updates updatedAt", async () => {
    const s = new DiagramStore();
    const d = fixture("d1", "x");
    d.meta.updatedAt = "2020-01-01T00:00:00Z";
    s.put(d);
    s.touch("d1");
    const after = s.get("d1");
    expect(after?.meta.updatedAt).not.toBe("2020-01-01T00:00:00Z");
  });
});
