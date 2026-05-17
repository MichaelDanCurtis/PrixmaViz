import { describe, expect, it } from "vitest";
import {
  ancestors,
  buildTree,
  entriesAtPath,
  entriesUnderPath,
  isDescendantOrEqual,
  materializedFolderPaths,
} from "../../src/lib/folder-tree";
import type { LibraryEntry } from "@prixmaviz/shared";

// Issue #7 Wave 2C — pure tree helpers. These pin the shape of the
// derived tree so a future refactor can't silently change which
// folders show up or where.

function entry(parentPath: string, name = "x"): LibraryEntry {
  return {
    name,
    path: `/lib/${parentPath ? parentPath + "/" : ""}${name}.pviz`,
    engine: "mermaid",
    kind: "graph",
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    parentPath,
    pinned: false,
    lastOpenedAt: null,
  };
}

describe("ancestors", () => {
  it("returns each prefix of a slash-delimited path", () => {
    expect(ancestors("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
  });
  it("returns the single segment for a top-level folder", () => {
    expect(ancestors("alpha")).toEqual(["alpha"]);
  });
  it("returns [] for the empty (root) path", () => {
    expect(ancestors("")).toEqual([]);
  });
});

describe("materializedFolderPaths", () => {
  it("collects all ancestor paths of every entry's parentPath", () => {
    const entries = [entry("a/b/c"), entry("a/b/d"), entry("x")];
    const paths = materializedFolderPaths(entries, []);
    // Every distinct prefix should appear.
    expect(paths.sort()).toEqual(["a", "a/b", "a/b/c", "a/b/d", "x"]);
  });

  it("includes empty folders (and their ancestors) too", () => {
    const entries = [entry("a/b")];
    const paths = materializedFolderPaths(entries, ["c/d/e"]);
    // a, a/b come from the entry. c, c/d, c/d/e come from the empty folder.
    expect(paths).toEqual(["a", "a/b", "c", "c/d", "c/d/e"]);
  });

  it("dedupes overlapping ancestors", () => {
    const entries = [entry("a/b/c"), entry("a/b/c/d")];
    const paths = materializedFolderPaths(entries, []);
    expect(paths).toEqual(["a", "a/b", "a/b/c", "a/b/c/d"]);
  });

  it("returns [] for an empty workspace", () => {
    expect(materializedFolderPaths([], [])).toEqual([]);
  });
});

describe("buildTree", () => {
  it("nests three levels correctly", () => {
    const tree = buildTree(["a", "a/b", "a/b/c", "x"]);
    expect(tree).toHaveLength(2);
    const a = tree.find((n) => n.path === "a")!;
    expect(a.depth).toBe(0);
    expect(a.children).toHaveLength(1);
    expect(a.children[0]!.path).toBe("a/b");
    expect(a.children[0]!.depth).toBe(1);
    expect(a.children[0]!.children[0]!.path).toBe("a/b/c");
    expect(a.children[0]!.children[0]!.depth).toBe(2);
    expect(a.children[0]!.children[0]!.name).toBe("c");
  });

  it("sorts siblings case-insensitively", () => {
    const tree = buildTree(["Zebra", "alpha", "Mid"]);
    expect(tree.map((n) => n.name)).toEqual(["alpha", "Mid", "Zebra"]);
  });

  it("ignores the empty (root) path", () => {
    const tree = buildTree(["", "a"]);
    expect(tree.map((n) => n.path)).toEqual(["a"]);
  });
});

describe("entriesAtPath", () => {
  it("returns only entries whose parentPath exactly matches", () => {
    const entries = [
      entry("", "root1"),
      entry("a", "in-a"),
      entry("a/b", "deep"),
    ];
    const direct = entriesAtPath(entries, "a");
    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe("in-a");
  });

  it("'' matches workspace root", () => {
    const entries = [entry("", "root"), entry("a", "nested")];
    expect(entriesAtPath(entries, "").map((e) => e.name)).toEqual(["root"]);
  });
});

describe("entriesUnderPath", () => {
  it("includes the folder itself + all descendants", () => {
    const entries = [
      entry("", "root1"),
      entry("a", "in-a"),
      entry("a/b", "deep"),
      entry("x", "other"),
    ];
    const under = entriesUnderPath(entries, "a");
    expect(under.map((e) => e.name).sort()).toEqual(["deep", "in-a"]);
  });

  it("'' scope returns every entry (no narrowing)", () => {
    const entries = [entry(""), entry("a"), entry("a/b")];
    expect(entriesUnderPath(entries, "")).toHaveLength(3);
  });

  it("does not match a sibling folder with the same prefix substring", () => {
    // 'a' must NOT match entries under 'ab' just because the string starts with 'a'.
    const entries = [entry("a", "in-a"), entry("ab", "in-ab")];
    const under = entriesUnderPath(entries, "a");
    expect(under).toHaveLength(1);
    expect(under[0]!.name).toBe("in-a");
  });
});

describe("isDescendantOrEqual", () => {
  it("is true for the identity case", () => {
    expect(isDescendantOrEqual("a/b", "a/b")).toBe(true);
  });

  it("is true for a strict descendant", () => {
    expect(isDescendantOrEqual("a", "a/b/c")).toBe(true);
  });

  it("is false for a sibling with a shared substring", () => {
    expect(isDescendantOrEqual("a", "ab")).toBe(false);
    expect(isDescendantOrEqual("ab", "a/x")).toBe(false);
  });

  it("root ('') is ancestor of everything (used by drag-drop guard)", () => {
    expect(isDescendantOrEqual("", "a/b")).toBe(true);
    expect(isDescendantOrEqual("", "")).toBe(true);
  });

  it("non-empty path is NOT a descendant of empty target", () => {
    // Caller checks: is target (descendant) under source (ancestor)?
    // Dropping 'x' onto '' means '' must contain 'x' — yes, '' contains all.
    // But the reverse — is '' descendant of 'x'? No.
    expect(isDescendantOrEqual("x", "")).toBe(false);
  });
});
