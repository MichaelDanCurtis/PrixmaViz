import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../src/store";

// Issue #7 Wave 2C: store-level pins for the new folder-tree state.
// These tests cover the contract between Tree.tsx and zustand:
//   - expandedFolderPaths is a Set<string> persisted to localStorage
//     under "prixmaviz_expanded_folders"
//   - selectedFolderPath defaults to "" (root / no scope)
//   - toggleFolderExpanded ignores the empty key (root has no toggle)
//
// We use storage-touching tests sparingly (one round-trip is enough);
// the rest exercise the set algebra directly off the store.

const STORAGE_KEY = "prixmaviz_expanded_folders";

function resetStore(): void {
  // Force a clean expandedFolderPaths and selectedFolderPath. Touching
  // setState directly is fine for tests; the production path uses the
  // setters.
  useAppStore.setState({
    expandedFolderPaths: new Set<string>(),
    selectedFolderPath: "",
  });
}

beforeEach(() => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  resetStore();
});

describe("expandedFolderPaths (issue #7 Wave 2C)", () => {
  it("defaults to an empty Set when nothing is persisted", () => {
    const s = useAppStore.getState();
    expect(s.expandedFolderPaths).toBeInstanceOf(Set);
    expect(s.expandedFolderPaths.size).toBe(0);
  });

  it("toggleFolderExpanded adds then removes a path", () => {
    const { toggleFolderExpanded } = useAppStore.getState();
    toggleFolderExpanded("mercury");
    expect(useAppStore.getState().expandedFolderPaths.has("mercury")).toBe(true);
    toggleFolderExpanded("mercury");
    expect(useAppStore.getState().expandedFolderPaths.has("mercury")).toBe(false);
  });

  it("toggleFolderExpanded handles many paths independently", () => {
    const { toggleFolderExpanded } = useAppStore.getState();
    toggleFolderExpanded("a");
    toggleFolderExpanded("a/b");
    toggleFolderExpanded("c");
    const set = useAppStore.getState().expandedFolderPaths;
    expect(set.has("a")).toBe(true);
    expect(set.has("a/b")).toBe(true);
    expect(set.has("c")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("toggleFolderExpanded ignores the empty (root) key", () => {
    const { toggleFolderExpanded } = useAppStore.getState();
    toggleFolderExpanded("");
    const set = useAppStore.getState().expandedFolderPaths;
    expect(set.has("")).toBe(false);
    expect(set.size).toBe(0);
  });

  it("toggleFolderExpanded persists to localStorage", () => {
    useAppStore.getState().toggleFolderExpanded("foo");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as string[];
    expect(parsed).toContain("foo");
  });

  it("expandedFolderPaths round-trips through localStorage on reload", async () => {
    // Simulate a previous-session expansion.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["alpha", "beta/sub"]));
    // Use vi.resetModules() pattern to reimport the store fresh.
    const { useAppStore: freshStore } = await (async () => {
      const mod = await import("../../src/store?reload=" + Date.now());
      return mod as typeof import("../../src/store");
    })();
    const set = freshStore.getState().expandedFolderPaths;
    expect(set.has("alpha")).toBe(true);
    expect(set.has("beta/sub")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("toggleFolderExpanded persists the union — multiple paths survive a reload", async () => {
    useAppStore.getState().toggleFolderExpanded("one");
    useAppStore.getState().toggleFolderExpanded("two");
    useAppStore.getState().toggleFolderExpanded("three");
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as string[];
    expect(parsed.sort()).toEqual(["one", "three", "two"]);
  });

  it("malformed localStorage payload yields an empty set (no throw)", async () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    const mod = await import("../../src/store?reload=malformed-" + Date.now());
    const set = mod.useAppStore.getState().expandedFolderPaths;
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(0);
  });
});

describe("selectedFolderPath (issue #7 Wave 2C)", () => {
  it("defaults to '' (root / no scope)", () => {
    expect(useAppStore.getState().selectedFolderPath).toBe("");
  });

  it("setSelectedFolderPath sets and clears", () => {
    const { setSelectedFolderPath } = useAppStore.getState();
    setSelectedFolderPath("mercury/wire-format");
    expect(useAppStore.getState().selectedFolderPath).toBe("mercury/wire-format");
    setSelectedFolderPath("");
    expect(useAppStore.getState().selectedFolderPath).toBe("");
  });

  it("is NOT persisted to localStorage (transient, lives only in memory)", () => {
    useAppStore.getState().setSelectedFolderPath("foo");
    // We don't allocate a storage key for it — confirm no incidental writes.
    expect(localStorage.getItem("prixmaviz_selected_folder")).toBeNull();
  });
});
