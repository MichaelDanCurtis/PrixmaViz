import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useAppStore } from "../../src/store";
import { useKeyboardShortcuts } from "../../src/lib/use-keyboard-shortcuts";

// Mock the api so the hook never tries to talk to the network.
vi.mock("../../src/lib/api", () => ({
  api: {
    patchTile: vi.fn().mockResolvedValue({}),
    deleteTile: vi.fn().mockResolvedValue({}),
    createTile: vi.fn().mockResolvedValue({ tile: { id: "t_dup" } }),
    setCamera: vi.fn().mockResolvedValue({}),
  },
}));

function resetStore() {
  useAppStore.setState({
    tiles: [],
    camera: { x: 0, y: 0, zoom: 1 },
    snapEnabled: true,
    focusedTileId: null,
    minimapVisible: true,
    commandPaletteOpen: false,
    shortcutsHelpOpen: false,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

function fireKey(opts: KeyboardEventInit & { target?: EventTarget }): void {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
  if (opts.target) {
    Object.defineProperty(ev, "target", { value: opts.target, writable: false });
  }
  window.dispatchEvent(ev);
}

describe("useKeyboardShortcuts — focus rule", () => {
  it("does NOT open the palette when '/' fires from an <input>", () => {
    renderHook(() => useKeyboardShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey({ key: "/", code: "Slash", target: input });
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    input.remove();
  });

  it("does NOT open the palette when Cmd+K fires from a <textarea>", () => {
    renderHook(() => useKeyboardShortcuts());
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireKey({ key: "k", metaKey: true, target: ta });
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    ta.remove();
  });

  it("does NOT open help when '?' fires from a contenteditable", () => {
    renderHook(() => useKeyboardShortcuts());
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(div);
    fireKey({ key: "?", target: div });
    expect(useAppStore.getState().shortcutsHelpOpen).toBe(false);
    div.remove();
  });
});

describe("useKeyboardShortcuts — palette + help", () => {
  it("Cmd+K toggles the palette open", () => {
    renderHook(() => useKeyboardShortcuts());
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    fireKey({ key: "k", metaKey: true });
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);
  });

  it("Ctrl+K toggles the palette open", () => {
    renderHook(() => useKeyboardShortcuts());
    fireKey({ key: "k", ctrlKey: true });
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);
  });

  it("'/' opens the palette", () => {
    renderHook(() => useKeyboardShortcuts());
    fireKey({ key: "/", code: "Slash" });
    expect(useAppStore.getState().commandPaletteOpen).toBe(true);
  });

  it("'?' opens the shortcuts help", () => {
    renderHook(() => useKeyboardShortcuts());
    fireKey({ key: "?" });
    expect(useAppStore.getState().shortcutsHelpOpen).toBe(true);
  });

  it("Esc closes the palette when open", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({ commandPaletteOpen: true });
    fireKey({ key: "Escape" });
    expect(useAppStore.getState().commandPaletteOpen).toBe(false);
  });

  it("Esc closes the help when open and palette is closed", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({ shortcutsHelpOpen: true });
    fireKey({ key: "Escape" });
    expect(useAppStore.getState().shortcutsHelpOpen).toBe(false);
  });
});

describe("useKeyboardShortcuts — view toggles", () => {
  it("'G' toggles snap-to-grid", () => {
    renderHook(() => useKeyboardShortcuts());
    expect(useAppStore.getState().snapEnabled).toBe(true);
    fireKey({ key: "g" });
    expect(useAppStore.getState().snapEnabled).toBe(false);
    fireKey({ key: "g" });
    expect(useAppStore.getState().snapEnabled).toBe(true);
  });

  it("'M' toggles minimap visibility", () => {
    renderHook(() => useKeyboardShortcuts());
    expect(useAppStore.getState().minimapVisible).toBe(true);
    fireKey({ key: "m" });
    expect(useAppStore.getState().minimapVisible).toBe(false);
  });

  it("'G' does NOT fire when typing into an input", () => {
    renderHook(() => useKeyboardShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey({ key: "g", target: input });
    expect(useAppStore.getState().snapEnabled).toBe(true);
    input.remove();
  });
});

describe("useKeyboardShortcuts — arrow nudge", () => {
  it("ArrowRight moves focused tile by 1px", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({
      tiles: [{ id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 100, w: 600, h: 400, z: 0 }],
      focusedTileId: "t1",
    });
    fireKey({ key: "ArrowRight" });
    expect(useAppStore.getState().tiles[0]!.x).toBe(101);
  });

  it("Shift+ArrowRight moves focused tile by 10px", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({
      tiles: [{ id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 100, w: 600, h: 400, z: 0 }],
      focusedTileId: "t1",
    });
    fireKey({ key: "ArrowRight", shiftKey: true });
    expect(useAppStore.getState().tiles[0]!.x).toBe(110);
  });

  it("Arrows do nothing when no tile is focused", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({
      tiles: [{ id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 100, w: 600, h: 400, z: 0 }],
      focusedTileId: null,
    });
    fireKey({ key: "ArrowRight" });
    expect(useAppStore.getState().tiles[0]!.x).toBe(100);
  });

  it("ArrowUp moves focused tile up by 1px", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({
      tiles: [{ id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 100, w: 600, h: 400, z: 0 }],
      focusedTileId: "t1",
    });
    fireKey({ key: "ArrowUp" });
    expect(useAppStore.getState().tiles[0]!.y).toBe(99);
  });
});

describe("useKeyboardShortcuts — delete", () => {
  it("Delete removes focused tile and clears focus", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({
      tiles: [{ id: "t1", diagramId: "d1", diagramSlug: "a", x: 100, y: 100, w: 600, h: 400, z: 0 }],
      focusedTileId: "t1",
    });
    fireKey({ key: "Delete" });
    // Focus is cleared synchronously; the actual tile removal happens via
    // server round-trip, which is mocked.
    expect(useAppStore.getState().focusedTileId).toBe(null);
  });

  it("Delete does nothing when no tile is focused", () => {
    renderHook(() => useKeyboardShortcuts());
    useAppStore.setState({ focusedTileId: null });
    fireKey({ key: "Delete" });
    expect(useAppStore.getState().focusedTileId).toBe(null);
  });
});
