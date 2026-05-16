import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

// Issue #7 Wave 2 (F1): FTS Library wiring. Covers the four cases listed
// in the design spec:
//   - search.length < 2 uses client filter
//   - search.length >= 2 fires debounced HTTP after ~200ms
//   - "Searching…" placeholder shown while in-flight
//   - serverSearchResults render in the All section

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

const sample: LibraryEntry[] = [
  entry({ name: "alpha", path: "/lib/alpha.pviz" }),
  entry({ name: "beta", path: "/lib/beta.pviz" }),
  entry({ name: "gamma", path: "/lib/gamma.pviz" }),
];

// Resolvable searchDiagrams that we control per-test via this var.
let searchResolver: ((value: { results: Array<unknown> }) => void) | null = null;
let searchPromise: Promise<{ results: Array<unknown> }> | null = null;

function makeSearchPromise(): Promise<{ results: Array<unknown> }> {
  searchPromise = new Promise((resolve) => {
    searchResolver = resolve;
  });
  return searchPromise;
}

const searchDiagramsMock = vi.fn(() => makeSearchPromise());

vi.mock("../../src/lib/api", () => ({
  api: {
    library: vi.fn(async () => sample),
    loadBySlug: vi.fn(),
    createTile: vi.fn(),
    listTags: vi.fn(async () => []),
    searchDiagrams: (args: Parameters<typeof searchDiagramsMock>[0]) =>
      searchDiagramsMock(args),
    updateDiagramMeta: vi.fn(),
    save: vi.fn(),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

beforeEach(() => {
  vi.useFakeTimers();
  searchResolver = null;
  searchPromise = null;
  searchDiagramsMock.mockClear();
  useAppStore.setState({
    library: sample,
    activeTagFilters: new Set<string>(),
    serverSearchResults: null,
    librarySortKey: "name-asc",
    diagram: null,
    tiles: [],
    detailModalSlug: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderedNames(): string[] {
  return Array.from(document.querySelectorAll(".library-name")).map(
    (n) => n.textContent ?? "",
  );
}

describe("FTS Library wiring (issue #7 F1)", () => {
  it("search.length < 2 falls back to the client substring filter", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const input = screen.getByPlaceholderText("Search diagrams…") as HTMLInputElement;

    // Single-char query — server search must NOT run.
    act(() => {
      fireEvent.change(input, { target: { value: "a" } });
    });
    // Even if we advance timers past the debounce, the server search
    // should be skipped.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(searchDiagramsMock).not.toHaveBeenCalled();
    // Client filter picks the entries whose name contains "a".
    // "alpha" + "beta" + "gamma" all contain "a".
    expect(renderedNames()).toContain("alpha");
    expect(renderedNames()).toContain("gamma");
  });

  it("search.length >= 2 fires the debounced HTTP after ~200ms", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const input = screen.getByPlaceholderText("Search diagrams…") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: "al" } });
    });
    // Before the debounce fires, no HTTP call.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(searchDiagramsMock).not.toHaveBeenCalled();

    // After 200ms, the call goes out.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(searchDiagramsMock).toHaveBeenCalledTimes(1);
    expect(searchDiagramsMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "al" }),
    );
  });

  it("\"Searching…\" placeholder is visible while a query is in flight", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const input = screen.getByPlaceholderText("Search diagrams…") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: "alpha" } });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // The fetch fired but searchResolver hasn't been invoked — placeholder.
    expect(screen.getByTestId("library-searching").textContent).toBe("Searching…");

    // Resolve the promise — placeholder disappears.
    await act(async () => {
      searchResolver!({ results: [{ slug: "alpha" }] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("library-searching")).toBeNull();
  });

  it("serverSearchResults render in the All section in result order", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const input = screen.getByPlaceholderText("Search diagrams…") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: "gamma" } });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Server-side say gamma matched first, then alpha.
    await act(async () => {
      searchResolver!({
        results: [
          { slug: "gamma", name: "gamma", engine: "mermaid", tags: [] },
          { slug: "alpha", name: "alpha", engine: "mermaid", tags: [] },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Render order matches server result order — NOT the local sort.
    expect(renderedNames()).toEqual(["gamma", "alpha"]);
    expect(useAppStore.getState().serverSearchResults?.length).toBe(2);
  });

  it("clearing the search drops serverSearchResults and restores client filter", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const input = screen.getByPlaceholderText("Search diagrams…") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: "alpha" } });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      searchResolver!({
        results: [{ slug: "alpha", name: "alpha", engine: "mermaid", tags: [] }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedNames()).toEqual(["alpha"]);

    // Clear the input — server result drops, client filter takes over.
    act(() => {
      fireEvent.change(input, { target: { value: "" } });
    });
    await flushAsync();
    expect(useAppStore.getState().serverSearchResults).toBeNull();
    expect(renderedNames().sort()).toEqual(["alpha", "beta", "gamma"]);
  });
});
