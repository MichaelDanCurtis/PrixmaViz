import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

// Issue #7 Wave 2C — folder tree, drag-drop, and edge-scroll. The
// existing library.test.tsx covers the flat-list behavior; this file
// pins the new tree-specific UX.

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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

const sample: LibraryEntry[] = [
  entry({ name: "root-thing", parentPath: "" }),
  entry({ name: "mercury-thing", parentPath: "mercury" }),
  entry({ name: "wire-thing", parentPath: "mercury/wire-format" }),
  entry({ name: "auth-thing", parentPath: "auth-flows" }),
];

const moveDiagram = vi.fn(async () => ({ ok: true as const, parentPath: "" }));
const emptyFolder = vi.fn(async () => ({ emptyFolders: [] as string[] }));

vi.mock("../../src/lib/api", () => ({
  api: {
    library: vi.fn(async () => sample),
    loadBySlug: vi.fn(async () => ({
      diagramId: "diagid-1",
      ir: undefined,
      dsl: "",
      render: { svg: "", dsl: "" },
    })),
    createTile: vi.fn(),
    getWorkspace: vi.fn(async () => ({
      id: "00000000-0000-0000-0000-000000000000",
      name: null,
      camera: { x: 0, y: 0, zoom: 1 },
      tiles: [],
      // Wave 2C reads workspace.settings.emptyFolders to materialize
      // empty subdirectories in the tree.
      settings: { emptyFolders: ["sandbox/pristine"] },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      lastSeenAt: "2024-01-01T00:00:00Z",
    })),
    moveDiagram,
    emptyFolder,
    renameFolder: vi.fn(async () => ({ affected: 0 })),
    deleteFolder: vi.fn(async () => ({ deleted: 0 })),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

beforeEach(() => {
  try {
    localStorage.removeItem("prixmaviz_expanded_folders");
    localStorage.removeItem("prixmaviz_library_sort");
  } catch {}
  useAppStore.setState({
    library: sample,
    librarySortKey: "updated",
    diagram: null,
    tiles: [],
    expandedFolderPaths: new Set<string>(),
    selectedFolderPath: "",
  });
  moveDiagram.mockClear();
  emptyFolder.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Library folder tree (issue #7 Wave 2C)", () => {
  it("renders one row per materialized top-level folder (collapsed by default)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // Top-level: mercury, auth-flows, sandbox.
    expect(screen.queryByTestId("library-tree-row-mercury")).not.toBeNull();
    expect(screen.queryByTestId("library-tree-row-auth-flows")).not.toBeNull();
    expect(screen.queryByTestId("library-tree-row-sandbox")).not.toBeNull();
    // Children are hidden until the parent is expanded.
    expect(screen.queryByTestId("library-tree-row-mercury/wire-format")).toBeNull();
    expect(screen.queryByTestId("library-tree-row-sandbox/pristine")).toBeNull();
  });

  it("expanding a folder reveals its 3-level-deep children", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // Pre-expand mercury so the child row materializes.
    act(() => {
      useAppStore.getState().toggleFolderExpanded("mercury");
    });
    expect(screen.queryByTestId("library-tree-row-mercury/wire-format")).not.toBeNull();
    // Pre-expand sandbox (which only has children via emptyFolders).
    act(() => {
      useAppStore.getState().toggleFolderExpanded("sandbox");
    });
    expect(screen.queryByTestId("library-tree-row-sandbox/pristine")).not.toBeNull();
  });

  it("clicking a folder name selects it and scopes the All list", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // Before selection: all 4 entries are visible.
    expect(document.querySelectorAll(".library-name").length).toBe(4);
    // Click on mercury folder name.
    const folderBtn = screen.getByTestId("library-tree-name-mercury");
    act(() => {
      fireEvent.click(folderBtn);
    });
    expect(useAppStore.getState().selectedFolderPath).toBe("mercury");
    // After: only entries under mercury are in the All list (2: direct + descendant).
    expect(document.querySelectorAll(".library-name").length).toBe(2);
  });

  it("clicking the selected folder again clears the selection", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const folderBtn = screen.getByTestId("library-tree-name-mercury");
    act(() => {
      fireEvent.click(folderBtn);
    });
    expect(useAppStore.getState().selectedFolderPath).toBe("mercury");
    act(() => {
      fireEvent.click(folderBtn);
    });
    expect(useAppStore.getState().selectedFolderPath).toBe("");
  });

  it("expand/collapse toggles state and persists to localStorage", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const row = screen.getByTestId("library-tree-row-mercury");
    const toggle = row.querySelector(".library-tree-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(useAppStore.getState().expandedFolderPaths.has("mercury")).toBe(false);
    act(() => {
      fireEvent.click(toggle);
    });
    expect(useAppStore.getState().expandedFolderPaths.has("mercury")).toBe(true);
    const raw = localStorage.getItem("prixmaviz_expanded_folders");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toContain("mercury");
    act(() => {
      fireEvent.click(toggle);
    });
    expect(useAppStore.getState().expandedFolderPaths.has("mercury")).toBe(false);
  });

  it("dragstart on a card sets the prixmaviz-diagram dataTransfer", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // Find a card by data-slug. The first sample entry has path
    // /lib/root-thing.pviz → slug "root-thing".
    const card = document.querySelector(
      '[data-slug="root-thing"]',
    ) as HTMLDivElement;
    expect(card).not.toBeNull();
    expect(card.getAttribute("draggable")).toBe("true");
    const setData = vi.fn();
    const dataTransfer = {
      setData,
      getData: vi.fn(() => "root-thing"),
      effectAllowed: "",
      dropEffect: "",
      types: ["application/x-prixmaviz-diagram"],
    } as unknown as DataTransfer;
    act(() => {
      fireEvent.dragStart(card, { dataTransfer });
    });
    expect(setData).toHaveBeenCalledWith(
      "application/x-prixmaviz-diagram",
      "root-thing",
    );
  });

  it("drop on a folder calls api.moveDiagram with the target path", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const target = screen.getByTestId("library-tree-row-mercury");
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn((mime: string) =>
        mime === "application/x-prixmaviz-diagram" ? "root-thing" : "",
      ),
      effectAllowed: "",
      dropEffect: "",
      types: ["application/x-prixmaviz-diagram"],
    } as unknown as DataTransfer;
    await act(async () => {
      fireEvent.dragOver(target, { dataTransfer });
      fireEvent.drop(target, { dataTransfer });
      // Wait for the loadBySlug → moveDiagram async chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The mock moveDiagram was called once with the second arg = "mercury".
    expect(moveDiagram).toHaveBeenCalledTimes(1);
    expect(moveDiagram.mock.calls[0]![1]).toBe("mercury");
  });

  it("drop dataTransfer with no slug is a no-op", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const target = screen.getByTestId("library-tree-row-mercury");
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => ""),
      effectAllowed: "",
      dropEffect: "",
      types: ["application/x-prixmaviz-diagram"],
    } as unknown as DataTransfer;
    await act(async () => {
      fireEvent.dragOver(target, { dataTransfer });
      fireEvent.drop(target, { dataTransfer });
      await Promise.resolve();
    });
    expect(moveDiagram).not.toHaveBeenCalled();
  });

  it("'+ New folder' input commits via POST /api/folders/empty", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // Click the + New folder button.
    const btn = screen.getByTestId("library-tree-new-folder-button");
    act(() => {
      fireEvent.click(btn);
    });
    const input = screen.getByTestId(
      "library-tree-new-folder-input",
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "labs/scratch" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(emptyFolder).toHaveBeenCalledWith("labs/scratch", "add");
  });

  it("the tree has a stable testid root so consumers can scope queries", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    expect(screen.queryByTestId("library-tree")).not.toBeNull();
  });

  it("count badge shows 'matches / total' when a folder is selected", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    // 4 entries total. Selecting "mercury" narrows to 2.
    expect(screen.getByTestId("library-count-badge").textContent).toBe("4");
    act(() => {
      fireEvent.click(screen.getByTestId("library-tree-name-mercury"));
    });
    expect(screen.getByTestId("library-count-badge").textContent).toBe("2 / 4");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Drag-drop guard — direct unit test on the exported helper.
// ────────────────────────────────────────────────────────────────────────

describe("isInvalidFolderDrop (issue #7 Wave 2C)", () => {
  it("rejects dropping a folder into its own subtree", async () => {
    const { isInvalidFolderDrop } = await import(
      "../../src/components/Library/Tree"
    );
    expect(isInvalidFolderDrop("a", "a/b")).toBe(true);
    expect(isInvalidFolderDrop("a", "a")).toBe(true);
    expect(isInvalidFolderDrop("a/b", "a/b/c/d")).toBe(true);
  });

  it("allows sibling and unrelated targets", async () => {
    const { isInvalidFolderDrop } = await import(
      "../../src/components/Library/Tree"
    );
    expect(isInvalidFolderDrop("a", "b")).toBe(false);
    expect(isInvalidFolderDrop("a/b", "c/d")).toBe(false);
  });

  it("does not confuse 'a' with 'ab' (shared prefix substring)", async () => {
    const { isInvalidFolderDrop } = await import(
      "../../src/components/Library/Tree"
    );
    expect(isInvalidFolderDrop("a", "ab")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Edge-scroll helper — wrapper-level integration test.
// ────────────────────────────────────────────────────────────────────────

describe("Library edge-scroll during drag (issue #7 Wave 2C)", () => {
  it("does NOT scroll when pointer is in the middle of the wrapper", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const wrap = screen.getByTestId("library-list-wrap");
    const list = screen.getByTestId("library-list");
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      writable: true,
      value: 100,
    });
    // Force a non-zero bounding rect so the math is real.
    wrap.getBoundingClientRect = () =>
      ({ top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const before = (list as unknown as { scrollTop: number }).scrollTop;
    act(() => {
      fireEvent.dragOver(wrap, { clientY: 200 });
    });
    // No interval should have started — scrollTop is unchanged.
    expect((list as unknown as { scrollTop: number }).scrollTop).toBe(before);
  });

  it("starts scrolling when pointer enters the top edge zone", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { Library } = await import("../../src/components/Library");
      render(<Library />);
      // happy-dom requires we manually wait for state when fake timers are
      // active because microtasks still run normally — flushAsync uses
      // Promise.resolve(), not timers.
      await flushAsync();
      const wrap = screen.getByTestId("library-list-wrap");
      const list = screen.getByTestId("library-list");
      let scrollValue = 100;
      Object.defineProperty(list, "scrollTop", {
        configurable: true,
        get: () => scrollValue,
        set: (v: number) => {
          scrollValue = v;
        },
      });
      wrap.getBoundingClientRect = () =>
        ({ top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      // Pointer at y=10 → 10px from top, inside the 24px hot zone.
      // RTL's fireEvent translates the {clientY} init to a DragEvent
      // but happy-dom doesn't actually attach clientY by default —
      // construct a DragEvent and set clientY explicitly.
      act(() => {
        const ev = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clientY", { value: 10 });
        wrap.dispatchEvent(ev);
      });
      // Advance several intervals.
      act(() => {
        vi.advanceTimersByTime(64);
      });
      expect(scrollValue).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts scrolling when pointer enters the bottom edge zone", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { Library } = await import("../../src/components/Library");
      render(<Library />);
      await flushAsync();
      const wrap = screen.getByTestId("library-list-wrap");
      const list = screen.getByTestId("library-list");
      let scrollValue = 0;
      Object.defineProperty(list, "scrollTop", {
        configurable: true,
        get: () => scrollValue,
        set: (v: number) => {
          scrollValue = v;
        },
      });
      wrap.getBoundingClientRect = () =>
        ({ top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      // Pointer at y=395 → 5px from bottom, inside the 24px hot zone.
      act(() => {
        const ev = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clientY", { value: 395 });
        wrap.dispatchEvent(ev);
      });
      act(() => {
        vi.advanceTimersByTime(64);
      });
      expect(scrollValue).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops scrolling on dragleave", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { Library } = await import("../../src/components/Library");
      render(<Library />);
      await flushAsync();
      const wrap = screen.getByTestId("library-list-wrap");
      const list = screen.getByTestId("library-list");
      let scrollValue = 100;
      Object.defineProperty(list, "scrollTop", {
        configurable: true,
        get: () => scrollValue,
        set: (v: number) => {
          scrollValue = v;
        },
      });
      wrap.getBoundingClientRect = () =>
        ({ top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      act(() => {
        const ev = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clientY", { value: 10 });
        wrap.dispatchEvent(ev);
      });
      act(() => {
        vi.advanceTimersByTime(32);
      });
      const partway = scrollValue;
      act(() => {
        const ev = new Event("dragleave", { bubbles: true, cancelable: true });
        wrap.dispatchEvent(ev);
      });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // After dragleave, scrollTop should not have advanced further.
      expect(scrollValue).toBe(partway);
    } finally {
      vi.useRealTimers();
    }
  });
});
