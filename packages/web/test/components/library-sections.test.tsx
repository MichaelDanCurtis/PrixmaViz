import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

// Issue #7 Wave 2: end-to-end component tests for the 3-section Library
// layout (Pinned / Recent / All), the star icon, and the optimistic pin
// toggle with rollback. The Library mounts a single time per test and we
// drive it via the zustand store, fireEvent, and the mocked API surface.

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

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

// Three pinned, three with recent opens, plus three plain. Used by the
// section-partition tests below.
function buildSample(): LibraryEntry[] {
  return [
    // Pinned items — different updatedAt to test sort behavior.
    entry({ name: "Pinned-A", pinned: true, updatedAt: "2024-03-01T00:00:00Z" }),
    entry({ name: "Pinned-B", pinned: true, updatedAt: "2024-02-01T00:00:00Z" }),
    // Pinned-C also has a recent open — proves Recent excludes Pinned.
    entry({
      name: "Pinned-C",
      pinned: true,
      updatedAt: "2024-01-15T00:00:00Z",
      lastOpenedAt: "2025-05-01T00:00:00Z",
    }),
    // Recent items, not pinned.
    entry({ name: "Recent-1", lastOpenedAt: "2025-04-01T00:00:00Z" }),
    entry({ name: "Recent-2", lastOpenedAt: "2025-04-02T00:00:00Z" }),
    entry({ name: "Recent-3", lastOpenedAt: "2025-04-03T00:00:00Z" }),
    // Plain items — neither pinned nor opened.
    entry({ name: "Plain-1" }),
    entry({ name: "Plain-2" }),
    entry({ name: "Plain-3" }),
  ];
}

const setPinnedMock = vi.fn(async (_id: string, pinned: boolean) => ({ pinned }));
// Mutable mock library — tests can override via setLibraryMock before render.
let libraryMockResult: LibraryEntry[] = buildSample();
const libraryMock = vi.fn(async () => libraryMockResult);

function setLibraryMock(entries: LibraryEntry[]): void {
  libraryMockResult = entries;
}

vi.mock("../../src/lib/api", () => ({
  api: {
    library: libraryMock,
    loadBySlug: vi.fn(),
    createTile: vi.fn(),
    setPinned: setPinnedMock,
    // Issue #7 Wave 2: Library now also fetches tag autocomplete on
    // mount and may exercise the FTS / metadata routes. Mock them as
    // empty-results no-ops so this section-layout suite stays focused.
    listTags: vi.fn(async () => []),
    searchDiagrams: vi.fn(async () => ({ results: [] })),
    updateDiagramMeta: vi.fn(async () => ({ meta: {} })),
    save: vi.fn(async () => ({ path: "", slug: "" })),
    getWorkspace: vi.fn(async () => ({
      id: "00000000-0000-0000-0000-000000000000",
      name: null,
      camera: { x: 0, y: 0, zoom: 1 },
      tiles: [],
      settings: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      lastSeenAt: "2024-01-01T00:00:00Z",
    })),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

function sectionNames(testid: string): string[] {
  const root = document.querySelector(`[data-testid="${testid}"]`);
  if (!root) return [];
  return Array.from(root.querySelectorAll(".library-name")).map(
    (n) => n.textContent ?? "",
  );
}

beforeEach(() => {
  try { localStorage.removeItem("prixmaviz_library_sort"); } catch {}
  setPinnedMock.mockReset();
  setPinnedMock.mockImplementation(async (_id: string, pinned: boolean) => ({ pinned }));
  setLibraryMock(buildSample());
  useAppStore.setState({
    library: buildSample(),
    librarySortKey: "updated",
    diagram: null,
    tiles: [],
    selectMode: false,
    selectedSlugs: new Set<string>(),
    lastSelectedSlug: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("Library 3-section layout (Issue #7 Wave 2)", () => {
  it("renders Pinned, Recent, and All sections when each is populated", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    expect(screen.getByTestId("library-section-pinned")).toBeTruthy();
    expect(screen.getByTestId("library-section-recent")).toBeTruthy();
    expect(screen.getByTestId("library-section-all")).toBeTruthy();
  });

  it("Pinned section contains exactly the pinned: true entries", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const names = sectionNames("library-section-pinned");
    expect(new Set(names)).toEqual(new Set(["Pinned-A", "Pinned-B", "Pinned-C"]));
  });

  it("Recent section contains only non-pinned entries with lastOpenedAt", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const names = sectionNames("library-section-recent");
    // Pinned-C also has lastOpenedAt but it's pinned — must not appear here.
    expect(names).toEqual(["Recent-3", "Recent-2", "Recent-1"]);
  });

  it("Recent excludes pinned items even when they have lastOpenedAt", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const recent = sectionNames("library-section-recent");
    expect(recent).not.toContain("Pinned-C");
  });

  it("All section excludes pinned but INCLUDES recent (de-dup by pinned only)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const all = sectionNames("library-section-all");
    // No pinned items in All.
    expect(all).not.toContain("Pinned-A");
    expect(all).not.toContain("Pinned-B");
    expect(all).not.toContain("Pinned-C");
    // Recent items appear in All too.
    expect(all).toContain("Recent-1");
    expect(all).toContain("Recent-2");
    expect(all).toContain("Recent-3");
    // Plain items are in All.
    expect(all).toContain("Plain-1");
    expect(all).toContain("Plain-2");
    expect(all).toContain("Plain-3");
  });

  it("Recent caps at 10 entries even when more are available", async () => {
    // Build 12 recent entries — older first, then check the top-10 by date.
    const lib: LibraryEntry[] = [];
    for (let i = 1; i <= 12; i++) {
      const day = String(i).padStart(2, "0");
      lib.push(entry({
        name: `r${i}`,
        lastOpenedAt: `2025-05-${day}T00:00:00Z`,
      }));
    }
    // Override both the mock-fetched data and the initial store state — the
    // component re-fetches on mount, so without overriding the mock the
    // beforeEach default would clobber our state.
    setLibraryMock(lib);
    useAppStore.setState({ library: lib });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const recent = sectionNames("library-section-recent");
    expect(recent.length).toBe(10);
    // Newest first: r12, r11, … r3 (the 10 most recent).
    expect(recent[0]).toBe("r12");
    expect(recent[9]).toBe("r3");
    // r1 and r2 (oldest) drop off Recent but appear in All.
    const all = sectionNames("library-section-all");
    expect(all).toContain("r1");
    expect(all).toContain("r2");
  });

  it("empty sections do not render their headers", async () => {
    const lib = [entry({ name: "Only-1" }), entry({ name: "Only-2" })];
    setLibraryMock(lib);
    useAppStore.setState({ library: lib });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // No pinned, no recent → only All renders.
    expect(screen.queryByTestId("library-section-pinned")).toBeNull();
    expect(screen.queryByTestId("library-section-recent")).toBeNull();
    expect(screen.getByTestId("library-section-all")).toBeTruthy();
  });

  it("Pinned section honors the sort dropdown (name-asc orders Pinned-A,B,C)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const sort = screen.getByTestId("library-sort") as HTMLSelectElement;
    act(() => {
      fireEvent.change(sort, { target: { value: "name-asc" } });
    });
    expect(sectionNames("library-section-pinned")).toEqual([
      "Pinned-A",
      "Pinned-B",
      "Pinned-C",
    ]);
  });

  it("Recent ALWAYS sorts by lastOpenedAt DESC regardless of sort dropdown", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const sort = screen.getByTestId("library-sort") as HTMLSelectElement;
    // Name-A→Z would put Recent-1 first by name; Recent-3 first by recency.
    act(() => {
      fireEvent.change(sort, { target: { value: "name-asc" } });
    });
    expect(sectionNames("library-section-recent")).toEqual([
      "Recent-3",
      "Recent-2",
      "Recent-1",
    ]);
    // Name-Z→A: by name would be Recent-3 first; by recency still Recent-3 first.
    // Switch the data so the name and recency orders differ unambiguously.
    // The component already mounted — setLibraryMock has no effect here;
    // setState on the store is enough since the component is reading from
    // it via the selector and won't re-fetch unless re-mounted.
    act(() => {
      useAppStore.setState({
        library: [
          entry({ name: "zzz", lastOpenedAt: "2025-04-01T00:00:00Z" }),
          entry({ name: "aaa", lastOpenedAt: "2025-04-03T00:00:00Z" }),
          entry({ name: "mmm", lastOpenedAt: "2025-04-02T00:00:00Z" }),
        ],
      });
    });
    act(() => {
      fireEvent.change(sort, { target: { value: "name-asc" } });
    });
    // Sort by name-asc would be aaa, mmm, zzz.
    // Recent must STILL be by lastOpenedAt DESC: aaa (04-03), mmm (04-02), zzz (04-01).
    expect(sectionNames("library-section-recent")).toEqual(["aaa", "mmm", "zzz"]);
    // And the All section sees the sort dropdown applied.
    expect(sectionNames("library-section-all")).toEqual(["aaa", "mmm", "zzz"]);
    act(() => {
      fireEvent.change(sort, { target: { value: "name-desc" } });
    });
    // Recent unchanged.
    expect(sectionNames("library-section-recent")).toEqual(["aaa", "mmm", "zzz"]);
    // All flipped.
    expect(sectionNames("library-section-all")).toEqual(["zzz", "mmm", "aaa"]);
  });

  it("Recent surfaces a 'by recency' label on the section header", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const section = screen.getByTestId("library-section-recent");
    expect(section.textContent ?? "").toContain("by recency");
  });

  it("Section count badges reflect the section size", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    expect(screen.getByTestId("library-section-pinned-count").textContent).toBe("3");
    expect(screen.getByTestId("library-section-recent-count").textContent).toBe("3");
    // 6 in All = Recent-1/2/3 + Plain-1/2/3
    expect(screen.getByTestId("library-section-all-count").textContent).toBe("6");
  });
});

describe("Library star icon (Issue #7 Wave 2)", () => {
  it("renders a star button on every card with the right state", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const pinnedStar = screen.getByTestId("library-star-Pinned-A");
    expect(pinnedStar.textContent).toBe("★");
    expect(pinnedStar.getAttribute("aria-pressed")).toBe("true");
    expect(pinnedStar.getAttribute("aria-label")).toBe("Unpin");

    const plainStar = screen.getByTestId("library-star-Plain-1");
    expect(plainStar.textContent).toBe("☆");
    expect(plainStar.getAttribute("aria-pressed")).toBe("false");
    expect(plainStar.getAttribute("aria-label")).toBe("Pin to top");
  });

  it("clicking the star calls api.setPinned and updates the store optimistically", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const before = useAppStore.getState().library.find((e) => e.name === "Plain-1");
    expect(before?.pinned).toBe(false);

    const star = screen.getByTestId("library-star-Plain-1");
    await act(async () => {
      fireEvent.click(star);
    });
    // Optimistic store update happens synchronously before the await resolves.
    expect(useAppStore.getState().library.find((e) => e.name === "Plain-1")?.pinned).toBe(true);
    expect(setPinnedMock).toHaveBeenCalledWith("id-Plain-1", true);
  });

  it("clicking a pinned star unpins (toggles to false)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const star = screen.getByTestId("library-star-Pinned-A");
    await act(async () => {
      fireEvent.click(star);
    });
    expect(useAppStore.getState().library.find((e) => e.name === "Pinned-A")?.pinned).toBe(false);
    expect(setPinnedMock).toHaveBeenCalledWith("id-Pinned-A", false);
  });

  it("clicking the star does not open the diagram (stopPropagation)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const star = screen.getByTestId("library-star-Plain-1");
    await act(async () => {
      fireEvent.click(star);
    });
    // open() would set diagram in the store via the api mock chain.
    // Since the click is captured before bubbling, the diagram remains null.
    expect(useAppStore.getState().diagram).toBeNull();
  });

  it("rolls back the optimistic update when the API call fails", async () => {
    setPinnedMock.mockRejectedValueOnce(new Error("boom"));
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const star = screen.getByTestId("library-star-Plain-1");
    await act(async () => {
      fireEvent.click(star);
      // Allow the rejected promise to flush its catch().
      await Promise.resolve();
      await Promise.resolve();
    });
    // Reverted back to false.
    expect(useAppStore.getState().library.find((e) => e.name === "Plain-1")?.pinned).toBe(false);
  });
});
