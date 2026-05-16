import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

// Issue #7 Wave 2 (F3): the FilterChips row + tag-click-to-filter UX.
// Covers:
//   - clicking a card's tag chip adds that tag to activeTagFilters
//   - removing a chip via its X works
//   - "Clear all" only appears when 2+ filters are active
//   - 2 active tags applies AND semantics over the Library list

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

function entry(p: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: p.id ?? `id-${p.name ?? "x"}`,
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

// Three diagrams with overlapping tags to exercise AND semantics.
const sample: LibraryEntry[] = [
  entry({ name: "Alpha", tags: ["mercury", "auth"] }),
  entry({ name: "Bravo", tags: ["mercury"] }),
  entry({ name: "Charlie", tags: ["auth"] }),
];

vi.mock("../../src/lib/api", () => ({
  api: {
    library: vi.fn(async () => sample),
    loadBySlug: vi.fn(),
    createTile: vi.fn(),
    listTags: vi.fn(async () => ["mercury", "auth"]),
    searchDiagrams: vi.fn(async () => ({ results: [] })),
    updateDiagramMeta: vi.fn(async () => ({ meta: {} })),
    save: vi.fn(async () => ({ path: "", slug: "" })),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

function renderedNames(): string[] {
  return Array.from(document.querySelectorAll(".library-name")).map(
    (n) => n.textContent ?? "",
  );
}

beforeEach(() => {
  try { localStorage.removeItem("prixmaviz_library_sort"); } catch {}
  useAppStore.setState({
    library: sample,
    librarySortKey: "name-asc",
    activeTagFilters: new Set<string>(),
    diagram: null,
    tiles: [],
    detailModalSlug: null,
    serverSearchResults: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("FilterChips (issue #7 F3)", () => {
  it("clicking a tag chip on a card adds it to activeTagFilters", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const chip = screen.getByTestId("library-tag-Alpha-mercury");
    act(() => {
      fireEvent.click(chip);
    });

    expect([...useAppStore.getState().activeTagFilters]).toEqual(["mercury"]);
    // The FilterChips row is now visible.
    const chipsRow = screen.getByTestId("library-filter-chips");
    expect(chipsRow).toBeTruthy();
    expect(chipsRow.textContent).toContain("mercury");
  });

  it("removing a filter chip via its X clears that filter", async () => {
    useAppStore.setState({
      activeTagFilters: new Set<string>(["mercury"]),
    });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const removeBtn = screen.getByLabelText("Remove filter mercury");
    act(() => {
      fireEvent.click(removeBtn);
    });

    expect(useAppStore.getState().activeTagFilters.size).toBe(0);
    expect(screen.queryByTestId("library-filter-chips")).toBeNull();
  });

  it("Clear-all appears only with 2+ filters and clears them all", async () => {
    useAppStore.setState({
      activeTagFilters: new Set<string>(["mercury"]),
    });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    // Single filter — no "Clear all".
    expect(screen.queryByTestId("filter-chips-clear-all")).toBeNull();

    // Add a second filter — "Clear all" appears.
    act(() => {
      useAppStore.getState().addTagFilter("auth");
    });
    const clearAll = screen.getByTestId("filter-chips-clear-all");
    expect(clearAll).toBeTruthy();

    act(() => {
      fireEvent.click(clearAll);
    });
    expect(useAppStore.getState().activeTagFilters.size).toBe(0);
  });

  it("2 active tag filters apply AND semantics on the Library list", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    // No filters: all three diagrams visible.
    expect(renderedNames().sort()).toEqual(["Alpha", "Bravo", "Charlie"]);

    // One filter "mercury": Alpha + Bravo (both have mercury).
    act(() => {
      useAppStore.getState().addTagFilter("mercury");
    });
    expect(renderedNames().sort()).toEqual(["Alpha", "Bravo"]);

    // Two filters "mercury" AND "auth": only Alpha (has both).
    act(() => {
      useAppStore.getState().addTagFilter("auth");
    });
    expect(renderedNames()).toEqual(["Alpha"]);

    // Remove "mercury": only Charlie (has auth).
    act(() => {
      useAppStore.getState().removeTagFilter("mercury");
    });
    expect(renderedNames().sort()).toEqual(["Alpha", "Charlie"]);
  });

  it("clicking the same tag chip twice on the same card is a no-op (dedup)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const chip = screen.getByTestId("library-tag-Alpha-mercury");
    act(() => {
      fireEvent.click(chip);
      fireEvent.click(chip);
    });
    expect(useAppStore.getState().activeTagFilters.size).toBe(1);
  });
});
