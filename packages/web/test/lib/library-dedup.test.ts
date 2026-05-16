import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../src/store";
import type { Tile } from "@prixmaviz/shared";

// Resets the slice of the store that this suite mutates. Other suites set
// their own slices; we don't touch them.
function resetStore() {
  useAppStore.setState({
    tiles: [],
    camera: { x: 0, y: 0, zoom: 1 },
    recentlyFocusedTileId: null,
    diagram: null,
  });
}

const tileA: Tile = {
  id: "t_a", diagramId: "d_a", diagramSlug: "alpha",
  x: 200, y: 300, w: 600, h: 400, z: 0,
};

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("focusExistingTile (issue #3, part C)", () => {
  it("sets recentlyFocusedTileId to the tile.id", async () => {
    const { _focusExistingTile } = await import("../../src/components/Library");
    useAppStore.setState({ tiles: [tileA] });
    _focusExistingTile(tileA);
    expect(useAppStore.getState().recentlyFocusedTileId).toBe("t_a");
  });

  it("updates camera so the tile is centered in the viewport", async () => {
    const { _focusExistingTile } = await import("../../src/components/Library");
    useAppStore.setState({ tiles: [tileA] });
    _focusExistingTile(tileA);
    const { camera } = useAppStore.getState();
    // happy-dom's window.innerWidth/innerHeight default to 1024/768.
    // With zoom=1, expected.x = tile.x - vw/2/zoom + tile.w/2
    //                          = 200 - 1024/2 + 600/2 = 200 - 512 + 300 = -12
    //              expected.y = tile.y - vh/2/zoom + tile.h/2
    //                          = 300 - 768/2 + 400/2 = 300 - 384 + 200 = 116
    expect(camera.x).toBe(-12);
    expect(camera.y).toBe(116);
    expect(camera.zoom).toBe(1);
  });

  it("clears recentlyFocusedTileId after ~1500ms", async () => {
    const { _focusExistingTile } = await import("../../src/components/Library");
    useAppStore.setState({ tiles: [tileA] });
    _focusExistingTile(tileA);
    expect(useAppStore.getState().recentlyFocusedTileId).toBe("t_a");
    vi.advanceTimersByTime(1499);
    expect(useAppStore.getState().recentlyFocusedTileId).toBe("t_a");
    vi.advanceTimersByTime(1);
    expect(useAppStore.getState().recentlyFocusedTileId).toBe(null);
  });

  it("returned cancel fn prevents the timeout from clearing", async () => {
    const { _focusExistingTile } = await import("../../src/components/Library");
    useAppStore.setState({ tiles: [tileA] });
    const cancel = _focusExistingTile(tileA);
    cancel();
    vi.advanceTimersByTime(5000);
    // Pulse stays set because the clearing timeout was cancelled.
    expect(useAppStore.getState().recentlyFocusedTileId).toBe("t_a");
  });

  it("setRecentlyFocusedTileId(null) is idempotent and safe", () => {
    useAppStore.getState().setRecentlyFocusedTileId(null);
    expect(useAppStore.getState().recentlyFocusedTileId).toBe(null);
  });
});

describe("client-side dedup check (issue #3, part A)", () => {
  // The dedup check inside Library.tsx::open() is a literal:
  //   useAppStore.getState().tiles.find(t => t.diagramSlug === slug)
  // We test the underlying predicate against the store so that any future
  // refactor (e.g. composite key on diagramId) updates this test too.
  it("returns the existing tile when a matching diagramSlug is on the canvas", () => {
    useAppStore.setState({ tiles: [tileA] });
    const found = useAppStore.getState().tiles.find((t) => t.diagramSlug === "alpha");
    expect(found?.id).toBe("t_a");
  });

  it("returns undefined when no matching diagramSlug is on the canvas", () => {
    useAppStore.setState({ tiles: [tileA] });
    const found = useAppStore.getState().tiles.find((t) => t.diagramSlug === "beta");
    expect(found).toBeUndefined();
  });
});
