import { describe, expect, it } from "vitest";
import { diffLines, diffStats } from "../../src/lib/line-diff";

describe("diffLines", () => {
  it("returns empty for two empty strings", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("marks unchanged lines as same", () => {
    const d = diffLines("a\nb", "a\nb");
    expect(d).toEqual([
      { kind: "same", a: 1, b: 1, text: "a" },
      { kind: "same", a: 2, b: 2, text: "b" },
    ]);
  });

  it("marks an inserted line as added", () => {
    const d = diffLines("a\nb", "a\nx\nb");
    expect(d).toEqual([
      { kind: "same", a: 1, b: 1, text: "a" },
      { kind: "added", b: 2, text: "x" },
      { kind: "same", a: 2, b: 3, text: "b" },
    ]);
  });

  it("marks a deleted line as removed", () => {
    const d = diffLines("a\nx\nb", "a\nb");
    expect(d).toEqual([
      { kind: "same", a: 1, b: 1, text: "a" },
      { kind: "removed", a: 2, text: "x" },
      { kind: "same", a: 3, b: 2, text: "b" },
    ]);
  });

  it("modify renders as remove+add", () => {
    const d = diffLines("a\nold\nb", "a\nnew\nb");
    const stats = diffStats(d);
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(1);
    expect(stats.same).toBe(2);
  });

  it("diffStats counts kinds", () => {
    const d = diffLines("line1\nline2\nline3", "line1\nline2\nline3a\nline4");
    const s = diffStats(d);
    expect(s.added).toBeGreaterThan(0);
    expect(s.added + s.removed).toBeGreaterThan(0);
  });

  it("handles entirely-different sources", () => {
    const d = diffLines("flowchart LR\n  A-->B", "graph TD\n  X-->Y");
    expect(d.length).toBeGreaterThan(0);
    // All lines change in some way → diff is non-empty
    const s = diffStats(d);
    expect(s.added + s.removed).toBeGreaterThan(0);
  });

  it("real-world: simple DSL evolution", () => {
    const before = "flowchart LR\n  A-->B\n  B-->C";
    const after = "flowchart LR\n  A-->B\n  B-->C\n  C-->D";
    const d = diffLines(before, after);
    const s = diffStats(d);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(0);
    expect(s.same).toBe(3);
  });
});
