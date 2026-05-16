import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../src/store";

// Issue #2 — Library bulk-select state actions. These cover the multi-select
// state machine the Library component drives: enter/exit select mode, toggle
// individual rows, shift-click range selection over the visible filtered
// list, select-all/clear, and the auto-clear when select mode exits.

beforeEach(() => {
  // Reset only the slice this suite mutates so we don't fight other suites.
  useAppStore.setState({
    selectMode: false,
    selectedSlugs: new Set<string>(),
    lastSelectedSlug: null,
  });
});

describe("bulk-select store actions (issue #2)", () => {
  it("setSelectMode(true) enables select mode without touching the set", () => {
    useAppStore.getState().toggleSelected("alpha");
    useAppStore.getState().setSelectMode(true);
    expect(useAppStore.getState().selectMode).toBe(true);
    // Entering select mode preserves any pre-existing selection (defensive —
    // callers like the Library toggle don't reach here with one, but other
    // call sites might).
    expect(useAppStore.getState().selectedSlugs.has("alpha")).toBe(true);
  });

  it("setSelectMode(false) clears the selection set", () => {
    useAppStore.getState().setSelectMode(true);
    useAppStore.getState().toggleSelected("alpha");
    useAppStore.getState().toggleSelected("beta");
    expect(useAppStore.getState().selectedSlugs.size).toBe(2);
    useAppStore.getState().setSelectMode(false);
    expect(useAppStore.getState().selectMode).toBe(false);
    expect(useAppStore.getState().selectedSlugs.size).toBe(0);
    expect(useAppStore.getState().lastSelectedSlug).toBe(null);
  });

  it("toggleSelected adds + removes a slug + updates anchor", () => {
    useAppStore.getState().toggleSelected("alpha");
    expect(useAppStore.getState().selectedSlugs.has("alpha")).toBe(true);
    expect(useAppStore.getState().lastSelectedSlug).toBe("alpha");

    useAppStore.getState().toggleSelected("beta");
    expect(useAppStore.getState().selectedSlugs.size).toBe(2);
    expect(useAppStore.getState().lastSelectedSlug).toBe("beta");

    useAppStore.getState().toggleSelected("alpha");
    expect(useAppStore.getState().selectedSlugs.has("alpha")).toBe(false);
    expect(useAppStore.getState().selectedSlugs.has("beta")).toBe(true);
    // De-selecting still moves the anchor to the slug we touched — matches
    // typical OS list behavior.
    expect(useAppStore.getState().lastSelectedSlug).toBe("alpha");
  });

  it("selectRange selects every slug between anchor and target inclusive", () => {
    const slugs = ["a", "b", "c", "d", "e"];
    useAppStore.getState().selectRange(slugs, "b", "d");
    const sel = useAppStore.getState().selectedSlugs;
    expect(sel.has("a")).toBe(false);
    expect(sel.has("b")).toBe(true);
    expect(sel.has("c")).toBe(true);
    expect(sel.has("d")).toBe(true);
    expect(sel.has("e")).toBe(false);
    expect(useAppStore.getState().lastSelectedSlug).toBe("d");
  });

  it("selectRange works when target is before anchor (reverse range)", () => {
    const slugs = ["a", "b", "c", "d", "e"];
    useAppStore.getState().selectRange(slugs, "d", "b");
    const sel = useAppStore.getState().selectedSlugs;
    expect(sel.has("b")).toBe(true);
    expect(sel.has("c")).toBe(true);
    expect(sel.has("d")).toBe(true);
    expect(sel.has("a")).toBe(false);
    expect(sel.has("e")).toBe(false);
  });

  it("selectRange unions with existing selection (doesn't clear)", () => {
    useAppStore.getState().toggleSelected("x");
    const slugs = ["a", "b", "c"];
    useAppStore.getState().selectRange(slugs, "a", "b");
    const sel = useAppStore.getState().selectedSlugs;
    expect(sel.has("x")).toBe(true);
    expect(sel.has("a")).toBe(true);
    expect(sel.has("b")).toBe(true);
  });

  it("selectRange falls back to toggle when anchor is not in visible list", () => {
    // Anchor was filtered out of the visible list — e.g. user searched. The
    // sensible thing is to just toggle the destination row instead of doing
    // nothing.
    const slugs = ["c", "d"];
    useAppStore.getState().selectRange(slugs, "alpha-not-visible", "c");
    expect(useAppStore.getState().selectedSlugs.has("c")).toBe(true);
  });

  it("selectAll replaces selection with the provided slugs", () => {
    useAppStore.getState().toggleSelected("x");
    useAppStore.getState().selectAll(["a", "b", "c"]);
    const sel = useAppStore.getState().selectedSlugs;
    expect(sel.has("x")).toBe(false);
    expect(sel.size).toBe(3);
    expect(useAppStore.getState().lastSelectedSlug).toBe("c");
  });

  it("selectAll with empty list clears the anchor", () => {
    useAppStore.getState().toggleSelected("x");
    useAppStore.getState().selectAll([]);
    expect(useAppStore.getState().selectedSlugs.size).toBe(0);
    expect(useAppStore.getState().lastSelectedSlug).toBe(null);
  });

  it("clearSelection empties the set and the anchor", () => {
    useAppStore.getState().toggleSelected("a");
    useAppStore.getState().toggleSelected("b");
    useAppStore.getState().clearSelection();
    expect(useAppStore.getState().selectedSlugs.size).toBe(0);
    expect(useAppStore.getState().lastSelectedSlug).toBe(null);
  });

  it("selectedSlugs is a fresh Set on each mutation (referential change)", () => {
    // The store keeps selectedSlugs as an immutable Set replaced on every
    // change so React's reference-equality bail-outs don't miss updates.
    const before = useAppStore.getState().selectedSlugs;
    useAppStore.getState().toggleSelected("alpha");
    const after = useAppStore.getState().selectedSlugs;
    expect(after).not.toBe(before);
  });
});
