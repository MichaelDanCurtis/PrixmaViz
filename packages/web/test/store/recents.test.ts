import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../src/store";
import type { LibraryEntry } from "@prixmaviz/shared";

// Issue #7 Wave 2: store wiring for the Recent section. Tests pin two
// behaviors:
//   1. The library:diagram-opened WS event updates the matching entry's
//      lastOpenedAt — the Recent section is a `useMemo` derivation, so
//      changing this field re-sorts on the next render.
//   2. The optimistic last_opened_at bump on loadBySlug from the Library
//      runs through `setLibraryLastOpenedAt`, the same mutator the WS
//      handler uses. Asserting against the mutator pins the contract.

function entry(p: Partial<LibraryEntry> & { name: string }): LibraryEntry {
  return {
    id: p.id ?? `id-${p.name}`,
    name: p.name,
    path: p.path ?? `/lib/${p.name}.pviz`,
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

beforeEach(() => {
  useAppStore.setState({
    library: [
      entry({ name: "alpha", id: "id-alpha", lastOpenedAt: null }),
      entry({ name: "beta", id: "id-beta", lastOpenedAt: "2025-01-01T00:00:00Z" }),
      entry({ name: "gamma", id: "id-gamma", lastOpenedAt: null }),
    ],
  });
});

describe("setLibraryLastOpenedAt (Issue #7 Wave 2)", () => {
  it("updates the matching entry's lastOpenedAt", () => {
    useAppStore.getState().setLibraryLastOpenedAt(
      "id-alpha",
      "2025-05-15T12:00:00Z",
    );
    const after = useAppStore.getState().library.find((e) => e.id === "id-alpha");
    expect(after?.lastOpenedAt).toBe("2025-05-15T12:00:00Z");
  });

  it("overwrites a previously non-null lastOpenedAt", () => {
    useAppStore.getState().setLibraryLastOpenedAt(
      "id-beta",
      "2025-05-15T12:00:00Z",
    );
    const after = useAppStore.getState().library.find((e) => e.id === "id-beta");
    expect(after?.lastOpenedAt).toBe("2025-05-15T12:00:00Z");
  });

  it("is a no-op when the diagram is not in the local library", () => {
    const before = useAppStore.getState().library;
    useAppStore.getState().setLibraryLastOpenedAt(
      "id-missing",
      "2025-05-15T12:00:00Z",
    );
    const after = useAppStore.getState().library;
    // Object identity is preserved when nothing changed (short-circuit).
    expect(after).toBe(before);
  });

  it("preserves the order of entries in the library array", () => {
    useAppStore.getState().setLibraryLastOpenedAt(
      "id-gamma",
      "2025-05-15T12:00:00Z",
    );
    const names = useAppStore.getState().library.map((e) => e.name);
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("setLibraryPinned (Issue #7 Wave 2)", () => {
  it("toggles pinned on the matching entry", () => {
    useAppStore.getState().setLibraryPinned("id-alpha", true);
    expect(
      useAppStore.getState().library.find((e) => e.id === "id-alpha")?.pinned,
    ).toBe(true);
    useAppStore.getState().setLibraryPinned("id-alpha", false);
    expect(
      useAppStore.getState().library.find((e) => e.id === "id-alpha")?.pinned,
    ).toBe(false);
  });

  it("is a no-op when the pinned value is unchanged", () => {
    const before = useAppStore.getState().library;
    useAppStore.getState().setLibraryPinned("id-alpha", false);
    const after = useAppStore.getState().library;
    expect(after).toBe(before);
  });

  it("is a no-op when the diagram is not in the local library", () => {
    const before = useAppStore.getState().library;
    useAppStore.getState().setLibraryPinned("id-missing", true);
    expect(useAppStore.getState().library).toBe(before);
  });
});

describe("library:diagram-opened WS event integration", () => {
  // The ws.ts handler is just a switch over the message type; we exercise
  // its effect on the store by calling the same mutator it uses.
  it("WS payload semantics: diagramId + lastOpenedAt → store update", () => {
    const wsPayload = {
      type: "library:diagram-opened" as const,
      diagramId: "id-alpha",
      lastOpenedAt: "2025-05-16T10:30:00Z",
    };
    // The WS handler dispatches by msg.type; the body of the
    // "library:diagram-opened" arm calls store.setLibraryLastOpenedAt.
    useAppStore.getState().setLibraryLastOpenedAt(
      wsPayload.diagramId,
      wsPayload.lastOpenedAt,
    );
    expect(
      useAppStore.getState().library.find((e) => e.id === "id-alpha")?.lastOpenedAt,
    ).toBe("2025-05-16T10:30:00Z");
  });

  it("repeated WS events stack — newest wins", () => {
    useAppStore.getState().setLibraryLastOpenedAt("id-alpha", "2025-05-15T10:00:00Z");
    useAppStore.getState().setLibraryLastOpenedAt("id-alpha", "2025-05-15T11:00:00Z");
    useAppStore.getState().setLibraryLastOpenedAt("id-alpha", "2025-05-15T12:00:00Z");
    expect(
      useAppStore.getState().library.find((e) => e.id === "id-alpha")?.lastOpenedAt,
    ).toBe("2025-05-15T12:00:00Z");
  });
});

describe("optimistic last_opened_at bump on loadBySlug from Library", () => {
  // The Library.tsx::open() function calls setLibraryLastOpenedAt(entry.id,
  // new Date().toISOString()) BEFORE awaiting the server. We test the
  // same call shape directly — the component test exercises the click
  // path; this pins the mutator contract.
  it("a synchronous bump on entry.id moves the entry into Recent", () => {
    const now = new Date().toISOString();
    useAppStore.getState().setLibraryLastOpenedAt("id-alpha", now);
    const lib = useAppStore.getState().library;
    const alpha = lib.find((e) => e.id === "id-alpha");
    expect(alpha?.lastOpenedAt).toBe(now);
    // Sorted by lastOpenedAt DESC, alpha (just now) should beat beta (2025).
    const sortedDesc = [...lib]
      .filter((e) => e.lastOpenedAt !== null)
      .sort((a, b) => b.lastOpenedAt!.localeCompare(a.lastOpenedAt!));
    expect(sortedDesc[0]?.name).toBe("alpha");
  });
});
