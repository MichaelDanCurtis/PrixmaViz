import { beforeEach, describe, expect, it } from "vitest";
import {
  LIBRARY_SORT_LABELS,
  compareLibraryEntries,
  useAppStore,
  type LibrarySortKey,
} from "../../src/store";
import type { LibraryEntry } from "@prixmaviz/shared";

// Issue #4: the Library sidebar sort comparator + persisted sort key. These
// tests pin the wire-format-ish behavior so a future refactor of the
// comparator can't silently flip the user's reading order.

function entry(p: Partial<LibraryEntry>): LibraryEntry {
  return {
    name: p.name ?? "x",
    path: p.path ?? `/lib/${p.name ?? "x"}.pviz`,
    engine: p.engine ?? "mermaid",
    kind: p.kind ?? "graph",
    tags: p.tags ?? [],
    createdAt: p.createdAt ?? "2024-01-01T00:00:00Z",
    updatedAt: p.updatedAt ?? "2024-01-01T00:00:00Z",
    parentPath: p.parentPath ?? "",
    pinned: p.pinned ?? false,
    lastOpenedAt: p.lastOpenedAt ?? null,
  };
}

const A = entry({
  name: "Alpha",
  path: "/lib/alpha.pviz",
  engine: "mermaid",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-03-01T00:00:00Z",
});
const B = entry({
  name: "bravo",
  path: "/lib/bravo.pviz",
  engine: "plantuml",
  createdAt: "2024-02-01T00:00:00Z",
  updatedAt: "2024-02-15T00:00:00Z",
});
const C = entry({
  name: "Charlie",
  path: "/lib/charlie.pviz",
  engine: "mermaid",
  createdAt: "2024-03-01T00:00:00Z",
  updatedAt: "2024-01-15T00:00:00Z",
});

function sortNames(input: LibraryEntry[], key: LibrarySortKey): string[] {
  return [...input].sort((a, b) => compareLibraryEntries(a, b, key)).map((e) => e.name);
}

describe("compareLibraryEntries (issue #4)", () => {
  it("'updated' returns most-recently-updated first", () => {
    expect(sortNames([B, A, C], "updated")).toEqual(["Alpha", "bravo", "Charlie"]);
  });

  it("'created' returns most-recently-created first", () => {
    expect(sortNames([A, B, C], "created")).toEqual(["Charlie", "bravo", "Alpha"]);
  });

  it("'name-asc' is case-insensitive A→Z", () => {
    expect(sortNames([C, B, A], "name-asc")).toEqual(["Alpha", "bravo", "Charlie"]);
  });

  it("'name-desc' is case-insensitive Z→A", () => {
    expect(sortNames([A, B, C], "name-desc")).toEqual(["Charlie", "bravo", "Alpha"]);
  });

  it("'engine' groups by engine then breaks ties by updatedAt DESC", () => {
    // mermaid: A (2024-03-01) before C (2024-01-15)
    // plantuml: B
    // mermaid < plantuml alphabetically, so the mermaid block comes first.
    expect(sortNames([C, B, A], "engine")).toEqual(["Alpha", "Charlie", "bravo"]);
  });

  it("LIBRARY_SORT_LABELS covers every key", () => {
    const keys: LibrarySortKey[] = [
      "updated",
      "created",
      "name-asc",
      "name-desc",
      "engine",
    ];
    for (const k of keys) {
      expect(typeof LIBRARY_SORT_LABELS[k]).toBe("string");
      expect(LIBRARY_SORT_LABELS[k].length).toBeGreaterThan(0);
    }
  });
});

describe("librarySortKey persistence (issue #4)", () => {
  beforeEach(() => {
    try { localStorage.removeItem("prixmaviz_library_sort"); } catch {}
    useAppStore.setState({ librarySortKey: "updated" });
  });

  it("defaults to 'updated' when nothing is persisted", () => {
    expect(useAppStore.getState().librarySortKey).toBe("updated");
  });

  it("setLibrarySortKey writes to localStorage", () => {
    useAppStore.getState().setLibrarySortKey("name-asc");
    expect(useAppStore.getState().librarySortKey).toBe("name-asc");
    expect(localStorage.getItem("prixmaviz_library_sort")).toBe("name-asc");
  });

  it("setLibrarySortKey to each valid key round-trips through localStorage", () => {
    const keys: LibrarySortKey[] = [
      "updated",
      "created",
      "name-asc",
      "name-desc",
      "engine",
    ];
    for (const k of keys) {
      useAppStore.getState().setLibrarySortKey(k);
      expect(localStorage.getItem("prixmaviz_library_sort")).toBe(k);
    }
  });
});
