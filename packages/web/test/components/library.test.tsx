import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

// Flush any pending promise microtasks + the React state update they
// schedule. Library.tsx fires api.library() on mount; without this the
// mocked-promise resolution lands AFTER the test asserts, triggering an
// act(...) warning. Wrapping in act ensures React commits the resulting
// setLibrary(...) before we read the DOM.
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

// Issue #4: end-to-end component tests for the Library sidebar UX fix.
// Covers:
//   - sort dropdown changes the rendered order
//   - count badge shows total at rest, "matches / total" while searching
//   - scroll-cue data attributes track the inner list's scroll position
//
// We mock `../lib/api` because the component fires `api.library()` on mount;
// without the mock, jsdom's fetch tries to hit the network during render.

function entry(p: Partial<LibraryEntry>): LibraryEntry {
  return {
    name: p.name ?? "x",
    path: p.path ?? `/lib/${p.name ?? "x"}.pviz`,
    engine: p.engine ?? "mermaid",
    kind: p.kind ?? "graph",
    tags: p.tags ?? [],
    createdAt: p.createdAt ?? "2024-01-01T00:00:00Z",
    updatedAt: p.updatedAt ?? "2024-01-01T00:00:00Z",
  };
}

const sample: LibraryEntry[] = [
  entry({
    name: "Charlie",
    path: "/lib/charlie.pviz",
    engine: "mermaid",
    createdAt: "2024-03-01T00:00:00Z",
    updatedAt: "2024-01-15T00:00:00Z",
  }),
  entry({
    name: "Alpha",
    path: "/lib/alpha.pviz",
    engine: "mermaid",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-03-01T00:00:00Z",
  }),
  entry({
    name: "bravo",
    path: "/lib/bravo.pviz",
    engine: "plantuml",
    createdAt: "2024-02-01T00:00:00Z",
    updatedAt: "2024-02-15T00:00:00Z",
  }),
];

// Mock the API surface the Library component reaches for on mount. We
// return our sample list so api.library() doesn't clobber the store state
// the test set up via setState() in beforeEach.
vi.mock("../../src/lib/api", () => ({
  api: {
    library: vi.fn(async () => sample),
    loadBySlug: vi.fn(),
    createTile: vi.fn(),
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
    librarySortKey: "updated",
    diagram: null,
    tiles: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("Library sidebar (issue #4)", () => {
  it("renders sorted by updated_at DESC by default", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    expect(renderedNames()).toEqual(["Alpha", "bravo", "Charlie"]);
  });

  it("changing the sort dropdown re-orders the list", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const sort = screen.getByTestId("library-sort") as HTMLSelectElement;

    act(() => {
      fireEvent.change(sort, { target: { value: "name-asc" } });
    });
    expect(renderedNames()).toEqual(["Alpha", "bravo", "Charlie"]);
    expect(useAppStore.getState().librarySortKey).toBe("name-asc");

    act(() => {
      fireEvent.change(sort, { target: { value: "name-desc" } });
    });
    expect(renderedNames()).toEqual(["Charlie", "bravo", "Alpha"]);

    act(() => {
      fireEvent.change(sort, { target: { value: "created" } });
    });
    expect(renderedNames()).toEqual(["Charlie", "bravo", "Alpha"]);
  });

  it("count badge shows the total at rest", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const badge = screen.getByTestId("library-count-badge");
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-label")).toBe("3 diagrams");
  });

  it("count badge shows 'matches / total' while searching", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const search = screen.getByPlaceholderText("Search diagrams…") as HTMLInputElement;
    // Substring "a" matches Alpha, bravo, Charlie — all three.
    act(() => {
      fireEvent.change(search, { target: { value: "a" } });
    });
    let badge = screen.getByTestId("library-count-badge");
    expect(badge.textContent).toBe("3 / 3");
    expect(badge.getAttribute("aria-label")).toBe("3 matches of 3 diagrams");

    // Substring "al" only matches Alpha.
    act(() => {
      fireEvent.change(search, { target: { value: "al" } });
    });
    badge = screen.getByTestId("library-count-badge");
    expect(badge.textContent).toBe("1 / 3");
    expect(badge.getAttribute("aria-label")).toBe("1 match of 3 diagrams");

    // Substring with no matches.
    act(() => {
      fireEvent.change(search, { target: { value: "zzzzzz" } });
    });
    badge = screen.getByTestId("library-count-badge");
    expect(badge.textContent).toBe("0 / 3");
    expect(badge.getAttribute("aria-label")).toBe("0 matches of 3 diagrams");
  });

  it("scroll-cue data attributes start at false=false when content fits", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const wrap = screen.getByTestId("library-list-wrap");
    // No scroll has occurred and (in happy-dom) layout reports 0 sizes, so
    // both should be false at rest.
    expect(wrap.getAttribute("data-can-scroll-up")).toBe("false");
    expect(wrap.getAttribute("data-can-scroll-down")).toBe("false");
  });

  it("scroll-cue updates when the inner list overflows and is scrolled", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const list = screen.getByTestId("library-list");
    const wrap = screen.getByTestId("library-list-wrap");

    // Force overflow: stub the layout-derived getters so the listener sees a
    // scrollable list. happy-dom doesn't actually lay out, so we have to
    // pretend. The component's listener reads scrollTop, scrollHeight,
    // clientHeight at call time, so redefining once and dispatching scroll
    // is enough.
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: 0 });

    act(() => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(wrap.getAttribute("data-can-scroll-up")).toBe("false");
    expect(wrap.getAttribute("data-can-scroll-down")).toBe("true");

    // Scroll partway: both cues should appear.
    Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: 100 });
    act(() => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(wrap.getAttribute("data-can-scroll-up")).toBe("true");
    expect(wrap.getAttribute("data-can-scroll-down")).toBe("true");

    // Scroll to bottom: only "more above" should remain.
    Object.defineProperty(list, "scrollTop", { configurable: true, writable: true, value: 800 });
    act(() => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(wrap.getAttribute("data-can-scroll-up")).toBe("true");
    expect(wrap.getAttribute("data-can-scroll-down")).toBe("false");
  });

  it("sort selection persists to localStorage and survives remount", async () => {
    const { Library } = await import("../../src/components/Library");
    const view = render(<Library />);
    await flushAsync();
    const sort = screen.getByTestId("library-sort") as HTMLSelectElement;
    act(() => {
      fireEvent.change(sort, { target: { value: "engine" } });
    });
    expect(localStorage.getItem("prixmaviz_library_sort")).toBe("engine");

    view.unmount();
    // Remount: store already has the value (set by the change above).
    // The on-disk value would drive a fresh page reload via readPersistedSortKey().
    render(<Library />);
    await flushAsync();
    const sort2 = screen.getByTestId("library-sort") as HTMLSelectElement;
    expect(sort2.value).toBe("engine");
  });
});
