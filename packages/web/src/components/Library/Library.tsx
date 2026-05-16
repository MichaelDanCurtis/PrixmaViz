import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_SORT_LABELS,
  compareLibraryEntries,
  useAppStore,
  type LibrarySortKey,
} from "../../store";
import { api } from "../../lib/api";
import { basename } from "../../lib/path";
import { toastError, toastInfo, toastSuccess } from "../../lib/toast";
import type { ExportFormat, BulkPackaging } from "../../lib/export";
import type { LibraryEntry, Tile } from "@prixmaviz/shared";
import { entriesUnderPath } from "../../lib/folder-tree";
import { Card } from "./Card";
import { Tree } from "./Tree";
import { FilterChips } from "./FilterChips";
import { DetailModal } from "./DetailModal";
import { EmbedModal } from "./EmbedModal";

/**
 * Issue #7 Wave 2: section render helper. Emits nothing when `entries`
 * is empty so empty sections don't pollute the UI with bare headers.
 * The section wraps a sticky header + the partition's cards, rendered
 * with the same `Card` the flat list previously used — section is a
 * pure presentation layer.
 */
function renderSection(opts: {
  id: "pinned" | "recent" | "all";
  title: string;
  icon?: string;
  note?: string;
  entries: LibraryEntry[];
  diagram: { name: string } | null;
  selectMode: boolean;
  selectedSlugs: Set<string>;
  onItemClick: (entry: LibraryEntry, slug: string, e: React.MouseEvent) => void;
}) {
  const { id, title, icon, note, entries, diagram, selectMode, selectedSlugs, onItemClick } = opts;
  if (entries.length === 0) return null;
  return (
    <div
      className={`library-section library-section-${id}`}
      data-testid={`library-section-${id}`}
      key={id}
    >
      <div className="library-section-header">
        <span className="library-section-title">
          {icon && <span className="library-section-icon">{icon}</span>}
          <span>{title}</span>
          {note && <span className="library-section-note">({note})</span>}
        </span>
        <span
          className="library-section-count"
          data-testid={`library-section-${id}-count`}
        >
          {entries.length}
        </span>
      </div>
      {entries.map((entry) => {
        const slug = basename(entry.path).replace(/\.pviz$/, "");
        const active = diagram?.name === entry.name;
        const checked = selectedSlugs.has(slug);
        return (
          <Card
            key={`${id}-${entry.path}`}
            entry={entry}
            slug={slug}
            active={active}
            selectMode={selectMode}
            checked={checked}
            onItemClick={onItemClick}
            draggable={!selectMode}
          />
        );
      })}
    </div>
  );
}

/**
 * Issue #7 Wave 2C — distance (in px) from the top/bottom edge of the
 * library list at which dragover starts auto-scrolling. Native HTML5
 * DnD does not auto-scroll the container; this helper steps the scroll
 * top by SCROLL_STEP_PX per dragover tick while the pointer is in the
 * hot zone.
 */
const EDGE_SCROLL_ZONE_PX = 24;
const SCROLL_STEP_PX = 8;

/**
 * Re-opening a Library entry whose diagram is already on the canvas:
 *  - pans the camera so the existing tile is centered in the viewport
 *  - flashes the tile via the `.tile-just-focused` class
 *  - DOES NOT call createTile (issue #3 fix — silent duplicate tile)
 *
 * The pulse class is cleared 1.5s later by setRecentlyFocusedTileId(null).
 * The returned cancel function lets callers (component unmount, rapid
 * re-clicks on a different entry) drop the pending timeout so we don't
 * clear someone else's pulse later.
 */
function focusExistingTile(tile: Tile): () => void {
  const store = useAppStore.getState();
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 720;
  const currentZoom = store.camera.zoom;
  store.setCamera({
    x: tile.x - viewportW / 2 / currentZoom + tile.w / 2,
    y: tile.y - viewportH / 2 / currentZoom + tile.h / 2,
    zoom: currentZoom,
  });
  store.setRecentlyFocusedTileId(tile.id);
  const handle = setTimeout(() => {
    if (useAppStore.getState().recentlyFocusedTileId === tile.id) {
      useAppStore.getState().setRecentlyFocusedTileId(null);
    }
  }, 1500);
  return () => clearTimeout(handle);
}

export const _focusExistingTile = focusExistingTile;

interface LibraryProps {
  onOpenSettings?: () => void;
}

export function Library({ onOpenSettings }: LibraryProps = {}) {
  const library = useAppStore((s) => s.library);
  const diagram = useAppStore((s) => s.diagram);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const setDiagram = useAppStore((s) => s.setDiagram);
  const setRender = useAppStore((s) => s.setRender);
  const setError = useAppStore((s) => s.setError);
  // Issue #4: client-side sort key + setter, persisted to localStorage.
  const librarySortKey = useAppStore((s) => s.librarySortKey);
  const setLibrarySortKey = useAppStore((s) => s.setLibrarySortKey);
  // Issue #2: bulk-select state.
  const selectMode = useAppStore((s) => s.selectMode);
  const selectedSlugs = useAppStore((s) => s.selectedSlugs);
  const lastSelectedSlug = useAppStore((s) => s.lastSelectedSlug);
  const setSelectMode = useAppStore((s) => s.setSelectMode);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const selectRange = useAppStore((s) => s.selectRange);
  const selectAll = useAppStore((s) => s.selectAll);
  const clearSelection = useAppStore((s) => s.clearSelection);
  // Issue #10: snap-to-grid toggle in library footer.
  const snapEnabled = useAppStore((s) => s.snapEnabled);
  const setSnapEnabled = useAppStore((s) => s.setSnapEnabled);
  // Issue #7 Wave 2C — folder tree state.
  const selectedFolderPath = useAppStore((s) => s.selectedFolderPath);
  // Issue #7 Wave 2 (F3): active tag filter set, AND-applied below.
  const activeTagFilters = useAppStore((s) => s.activeTagFilters);
  // Issue #7 Wave 2 (F1): server-side FTS result list. When non-null,
  // the All section renders these instead of the local-filtered slice.
  const serverSearchResults = useAppStore((s) => s.serverSearchResults);
  const setServerSearchResults = useAppStore((s) => s.setServerSearchResults);
  const setTagAutocomplete = useAppStore((s) => s.setTagAutocomplete);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Issue #7 Wave 2 (F1): in-flight flag for the FTS HTTP request. Drives
  // the "Searching…" placeholder while a debounced query is outstanding.
  const [searching, setSearching] = useState(false);
  const [bulkFormat, setBulkFormat] = useState<ExportFormat>("svg");
  const [bulkPackaging, setBulkPackaging] = useState<BulkPackaging>("zip");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const cancelFocusRef = useRef<(() => void) | null>(null);
  // Issue #4: scroll-affordance state.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<{
    canScrollUp: boolean;
    canScrollDown: boolean;
  }>({ canScrollUp: false, canScrollDown: false });

  // Library + empty-folder list. Issue #7 Wave 2C pulls the empty-folder
  // list out of the workspace settings JSONB so the tree can render
  // pristine subdirectories that don't yet contain a diagram.
  const refreshLibrary = useCallback(async (): Promise<void> => {
    try {
      const [entries, ws] = await Promise.all([
        api.library(),
        api.getWorkspace().catch(() => null),
      ]);
      setLibrary(entries);
      const ef = (ws?.settings as { emptyFolders?: unknown } | null)?.emptyFolders;
      setEmptyFolders(
        Array.isArray(ef) ? ef.filter((p): p is string => typeof p === "string") : [],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setLibrary, setError]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // Issue #7 Wave 2 (F3/F5): seed the autocomplete cache once on mount.
  // Best-effort — if the route is down we just skip; the DetailModal still
  // works, it just won't suggest existing tags.
  useEffect(() => {
    let cancelled = false;
    void api
      .listTags()
      .then((tags) => {
        if (!cancelled) setTagAutocomplete(tags);
      })
      .catch(() => {
        /* ignore — autocomplete is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [setTagAutocomplete]);

  // Issue #7 Wave 2 (F1): debounced server-side FTS. When the search input
  // has >= 2 chars, wait 200ms and POST. Earlier requests are dropped via a
  // `requestId` token so a slow response doesn't overwrite a faster newer
  // one. When the input drops below 2 chars, clear serverSearchResults so
  // the All section falls back to the local filter.
  const searchRequestIdRef = useRef(0);
  useEffect(() => {
    if (search.length < 2) {
      // Drop any pending results from a previous query.
      if (useAppStore.getState().serverSearchResults !== null) {
        setServerSearchResults(null);
      }
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      const myId = ++searchRequestIdRef.current;
      setSearching(true);
      void api
        .searchDiagrams({
          q: search,
          parentPath: selectedFolderPath,
          tags: [...activeTagFilters],
        })
        .then((res) => {
          // Stale guard — only commit if we're still the latest request.
          if (myId !== searchRequestIdRef.current) return;
          setServerSearchResults(res.results);
        })
        .catch(() => {
          if (myId !== searchRequestIdRef.current) return;
          setServerSearchResults([]);
        })
        .finally(() => {
          if (myId !== searchRequestIdRef.current) return;
          setSearching(false);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [search, selectedFolderPath, activeTagFilters, setServerSearchResults]);

  useEffect(() => {
    return () => {
      if (cancelFocusRef.current) cancelFocusRef.current();
    };
  }, []);

  // Folder-scoped pool first, then sort, then text filter. Issue #7
  // Wave 2C — when a folder is selected in the tree, the All section
  // narrows to that folder's contents (including descendants).
  const folderScoped = useMemo(
    () => entriesUnderPath(library, selectedFolderPath),
    [library, selectedFolderPath],
  );

  const sorted = useMemo(
    () => [...folderScoped].sort((a, b) => compareLibraryEntries(a, b, librarySortKey)),
    [folderScoped, librarySortKey],
  );

  // Issue #7 Wave 2 (F3): apply the tag AND filter BEFORE the substring
  // filter so the search box still narrows within the active tag scope.
  const tagFiltered = useMemo(() => {
    if (activeTagFilters.size === 0) return sorted;
    const filters = [...activeTagFilters];
    return sorted.filter((e) => filters.every((t) => e.tags.includes(t)));
  }, [sorted, activeTagFilters]);

  const filtered = useMemo(() => {
    if (!search) return tagFiltered;
    const q = search.toLowerCase();
    return tagFiltered.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [tagFiltered, search]);

  // Issue #7 Wave 2: section partition over `filtered`.
  //  - Pinned: every pinned entry, honoring the sort dropdown.
  //  - Recent: top RECENT_LIMIT non-pinned entries by lastOpenedAt DESC,
  //    ALWAYS sorted by recency regardless of the dropdown — its whole
  //    purpose is "what did I last touch?".
  //  - All:    everything not pinned, honoring the sort dropdown. Note
  //    Recent is a shortcut, not a filter — its entries also appear here.
  //
  // Issue #7 Wave 2 (F1) — when a server-side FTS result is present
  // (serverSearchResults != null), the All section renders THOSE in
  // result order instead of the local-filtered slice. Pinned + Recent
  // are hidden during an active server search so the result list
  // doesn't read as duplicated against the shortcut sections.
  const RECENT_LIMIT = 10;
  const serverActive = serverSearchResults !== null;
  const pinnedEntries = useMemo(
    () => (serverActive ? [] : filtered.filter((e) => e.pinned)),
    [filtered, serverActive],
  );
  const recentEntries = useMemo(() => {
    if (serverActive) return [];
    return filtered
      .filter((e) => !e.pinned && e.lastOpenedAt)
      .slice()
      .sort((a, b) => (b.lastOpenedAt as string).localeCompare(a.lastOpenedAt as string))
      .slice(0, RECENT_LIMIT);
  }, [filtered, serverActive]);
  const allEntries = useMemo(() => {
    if (!serverActive) return filtered.filter((e) => !e.pinned);
    // Map server result slugs back to LibraryEntry objects (preserve
    // result order). If the library hasn't caught up via WS yet, fall
    // back to a synthesized entry built from the search hit so the All
    // section still renders something — but in the common case the
    // entry already exists in `library`.
    const bySlug = new Map<string, LibraryEntry>();
    for (const e of library) {
      bySlug.set(basename(e.path).replace(/\.pviz$/, ""), e);
    }
    const out: LibraryEntry[] = [];
    for (const hit of serverSearchResults!) {
      const existing = bySlug.get(hit.slug);
      if (existing) {
        out.push(existing);
      } else {
        out.push({
          id: hit.slug,
          name: hit.name,
          path: `/lib/${hit.slug}.pviz`,
          engine: hit.engine,
          kind: "graph",
          tags: hit.tags,
          createdAt: hit.createdAt ?? "",
          updatedAt: hit.updatedAt ?? "",
          parentPath: "",
          pinned: false,
          lastOpenedAt: null,
        } as LibraryEntry);
      }
    }
    return out;
  }, [filtered, library, serverActive, serverSearchResults]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const canScrollUp = el.scrollTop > 1;
      const canScrollDown =
        el.scrollHeight - el.clientHeight - el.scrollTop > 1;
      setScrollState((prev) =>
        prev.canScrollUp === canScrollUp && prev.canScrollDown === canScrollDown
          ? prev
          : { canScrollUp, canScrollDown },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [filtered.length]);

  async function open(entry: LibraryEntry) {
    try {
      const slug = basename(entry.path).replace(/\.pviz$/, "");

      const existing = useAppStore.getState().tiles.find((t) => t.diagramSlug === slug);
      if (existing) {
        if (cancelFocusRef.current) cancelFocusRef.current();
        cancelFocusRef.current = focusExistingTile(existing);
        const result = await api.loadBySlug(slug);
        setDiagram({
          id: result.diagramId,
          name: entry.name,
          engine: entry.engine,
          kind: entry.kind,
          ir: result.ir,
          dsl: result.dsl,
          meta: { createdAt: entry.createdAt, updatedAt: entry.updatedAt, tags: entry.tags, sourcePaths: [] },
        });
        setRender(result.diagramId, result.render.svg, result.render.dsl, result.ir);
        return;
      }

      const result = await api.loadBySlug(slug);
      const camera = useAppStore.getState().camera;
      await api.createTile({
        diagramId: result.diagramId,
        diagramSlug: slug,
        x: camera.x + 60,
        y: camera.y + 60,
        w: 600, h: 400,
      });
      setDiagram({
        id: result.diagramId,
        name: entry.name,
        engine: entry.engine,
        kind: entry.kind,
        ir: result.ir,
        dsl: result.dsl,
        meta: { createdAt: entry.createdAt, updatedAt: entry.updatedAt, tags: entry.tags, sourcePaths: [] },
      });
      setRender(result.diagramId, result.render.svg, result.render.dsl, result.ir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Issue #4: header count format.
  // Note: `total` is the full library size, NOT the folder-scoped pool.
  // When a folder is selected, the count badge already shows
  // `filtered.length / library.length` (matches / total) via the search
  // branch — which generalizes correctly to the folder case too.
  const total = library.length;
  const folderActive = selectedFolderPath.length > 0;
  const searchActive = search.length > 0;
  const filteredActive = searchActive || folderActive;
  const countLabel = filteredActive ? `${filtered.length} / ${total}` : `${total}`;
  const countTitle = filteredActive
    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"} of ${total} diagram${total === 1 ? "" : "s"}`
    : `${total} diagram${total === 1 ? "" : "s"}`;

  // Issue #2: visible-slug list + click handler + bulk export.
  const visibleSlugs = useMemo(
    () => filtered.map((e) => basename(e.path).replace(/\.pviz$/, "")),
    [filtered],
  );

  function onItemClick(entry: LibraryEntry, slug: string, e: React.MouseEvent) {
    if (!selectMode) {
      open(entry);
      return;
    }
    if (e.shiftKey && lastSelectedSlug) {
      selectRange(visibleSlugs, lastSelectedSlug, slug);
    } else {
      toggleSelected(slug);
    }
  }

  async function runBulkExport() {
    const slugs = Array.from(selectedSlugs);
    if (slugs.length === 0) return;
    setBulkBusy(true);
    setBulkProgress({ completed: 0, total: slugs.length });
    try {
      const { exportBulk } = await import("../../lib/export");
      const result = await exportBulk(
        slugs,
        bulkFormat,
        bulkPackaging,
        (p) => setBulkProgress({ completed: p.completed, total: p.total }),
      );
      if (result.failureCount === 0) {
        toastSuccess(`Exported ${result.successCount} diagram${result.successCount === 1 ? "" : "s"}`);
      } else if (result.successCount === 0) {
        toastError(`Bulk export failed for all ${result.failureCount} diagrams`);
      } else {
        toastInfo(
          `Exported ${result.successCount} of ${result.successCount + result.failureCount} — ${result.failureCount} failed`,
        );
      }
    } catch (err) {
      toastError(`Bulk export error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  const allVisibleSelected =
    visibleSlugs.length > 0 && visibleSlugs.every((s) => selectedSlugs.has(s));

  // Issue #7 Wave 2C — folder drop handler. Called when a Card is
  // dropped on a Tree row. The Tree component does the cycle-guard for
  // folder-on-folder drops; here we just optimistically update the
  // library state, fire the API call, and roll back if it fails.
  const handleDropDiagram = useCallback(
    async (slug: string, targetFolder: string): Promise<void> => {
      const slugPath = (e: LibraryEntry) => basename(e.path).replace(/\.pviz$/, "");
      const currentLibrary = useAppStore.getState().library;
      const entry = currentLibrary.find((e) => slugPath(e) === slug);
      if (!entry) return;
      if (entry.parentPath === targetFolder) return; // no-op
      // Optimistic update.
      const prev = currentLibrary;
      const next = currentLibrary.map((e) =>
        slugPath(e) === slug ? { ...e, parentPath: targetFolder } : e,
      );
      setLibrary(next);
      try {
        // The diagram's REST id is held server-side under entry.path's
        // slug — but the move route accepts the database UUID, not the
        // slug. We have to round-trip through loadBySlug to discover the
        // id, which is wasteful for a drop. Defer: the server route
        // accepts a slug via the same path. Look at how the server
        // resolves :id below.
        //
        // For Wave 2C we call api.moveDiagram with the slug as the URL
        // segment — the server's PATCH /api/diagrams/:id/move expects
        // a diagram UUID; we need to round-trip via loadBySlug to get
        // the canonical id. Cost: one extra HTTP call per drop. Fine
        // for the scale envelope; revisit if drops become bursty.
        const loaded = await api.loadBySlug(slug);
        await api.moveDiagram(loaded.diagramId, targetFolder);
        // Server broadcasts library:diagram-updated → ws.ts re-fetches.
        // We pre-refresh now to avoid waiting for the round trip in the
        // common single-tab case.
        void refreshLibrary();
      } catch (err) {
        // Rollback on failure.
        setLibrary(prev);
        toastError(
          `Move failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [setLibrary, refreshLibrary],
  );

  // Edge-scroll helper. Native HTML5 DnD does NOT auto-scroll a
  // container during a drag. While the user is hovering near the top or
  // bottom 24px of the library wrapper, step the scrollTop so the drop
  // target they're trying to reach comes into view.
  const dragScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopEdgeScroll = useCallback(() => {
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current);
      dragScrollIntervalRef.current = null;
    }
  }, []);
  useEffect(() => () => stopEdgeScroll(), [stopEdgeScroll]);

  const onWrapperDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const wrapper = e.currentTarget;
    const list = wrapper.querySelector<HTMLElement>("[data-testid='library-list']");
    if (!list) return;
    const rect = wrapper.getBoundingClientRect();
    const y = e.clientY;
    const distFromTop = y - rect.top;
    const distFromBottom = rect.bottom - y;
    let direction: -1 | 0 | 1 = 0;
    if (distFromTop < EDGE_SCROLL_ZONE_PX && distFromTop >= 0) direction = -1;
    else if (distFromBottom < EDGE_SCROLL_ZONE_PX && distFromBottom >= 0) direction = 1;
    if (direction === 0) {
      stopEdgeScroll();
      return;
    }
    if (dragScrollIntervalRef.current) return; // already scrolling
    dragScrollIntervalRef.current = setInterval(() => {
      list.scrollTop += direction * SCROLL_STEP_PX;
    }, 16);
  }, [stopEdgeScroll]);

  return (
    <aside className={`library${selectMode ? " library-select-mode" : ""}`}>
      <div className="library-header">
        <div className="library-title">Library</div>
        <span
          className="library-count-badge"
          title={countTitle}
          aria-label={countTitle}
          data-testid="library-count-badge"
        >
          {countLabel}
        </span>
        <button
          className={`library-select-toggle${selectMode ? " active" : ""}`}
          onClick={() => setSelectMode(!selectMode)}
          title={selectMode ? "Exit select mode" : "Select multiple diagrams"}
        >
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
      <div className="library-controls">
        <input
          className="library-search-input"
          placeholder="Search diagrams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="library-sort"
          aria-label="Sort diagrams"
          data-testid="library-sort"
          value={librarySortKey}
          onChange={(e) => setLibrarySortKey(e.target.value as LibrarySortKey)}
        >
          {(Object.keys(LIBRARY_SORT_LABELS) as LibrarySortKey[]).map((k) => (
            <option key={k} value={k}>
              {LIBRARY_SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      {/* Issue #7 Wave 2 (F3): active tag-filter chips. Self-hides when
          no filters are active. */}
      <FilterChips />
      {/* Issue #7 Wave 2 (F1): in-flight FTS placeholder. */}
      {searching && (
        <div
          className="library-searching"
          data-testid="library-searching"
          aria-live="polite"
        >
          Searching…
        </div>
      )}
      {selectMode && (
        <div className="library-select-row">
          <button
            className="library-select-link"
            onClick={() => (allVisibleSelected ? clearSelection() : selectAll(visibleSlugs))}
          >
            {allVisibleSelected ? "Clear selection" : `Select all (${visibleSlugs.length})`}
          </button>
          <span className="library-select-count">
            {selectedSlugs.size} selected
          </span>
        </div>
      )}
      <div
        className="library-list-wrap"
        data-can-scroll-up={scrollState.canScrollUp ? "true" : "false"}
        data-can-scroll-down={scrollState.canScrollDown ? "true" : "false"}
        data-testid="library-list-wrap"
        onDragOver={onWrapperDragOver}
        onDragLeave={stopEdgeScroll}
        onDrop={stopEdgeScroll}
      >
        <Tree
          entries={library}
          emptyFolders={emptyFolders}
          onDropDiagram={(slug, target) => void handleDropDiagram(slug, target)}
          onFoldersChanged={() => void refreshLibrary()}
        />
        <div className="library-list" ref={listRef} data-testid="library-list">
          {renderSection({
            id: "pinned",
            title: "Pinned",
            icon: "★",
            entries: pinnedEntries,
            diagram,
            selectMode,
            selectedSlugs,
            onItemClick,
          })}
          {renderSection({
            id: "recent",
            title: "Recent",
            note: "by recency",
            entries: recentEntries,
            diagram,
            selectMode,
            selectedSlugs,
            onItemClick,
          })}
          {renderSection({
            id: "all",
            title: "All",
            entries: allEntries,
            diagram,
            selectMode,
            selectedSlugs,
            onItemClick,
          })}
        </div>
      </div>
      {selectMode && selectedSlugs.size > 0 && (
        <div className="library-bulk-bar" role="region" aria-label="Bulk export">
          <div className="library-bulk-line">
            <span className="library-bulk-count">
              {selectedSlugs.size} selected
            </span>
            <label className="library-bulk-field">
              <span>Format</span>
              <select
                value={bulkFormat}
                onChange={(e) => setBulkFormat(e.target.value as ExportFormat)}
                disabled={bulkBusy}
              >
                <option value="svg">SVG</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="vsdx">VSDX</option>
              </select>
            </label>
            <label className="library-bulk-field">
              <span>Packaging</span>
              <select
                value={bulkPackaging}
                onChange={(e) => setBulkPackaging(e.target.value as BulkPackaging)}
                disabled={bulkBusy}
              >
                <option value="zip">Single .zip</option>
                <option value="individual">Individual files</option>
              </select>
            </label>
          </div>
          <div className="library-bulk-line">
            <button
              className="library-bulk-action"
              onClick={runBulkExport}
              disabled={bulkBusy || selectedSlugs.size === 0}
            >
              {bulkBusy && bulkProgress
                ? `Exporting ${bulkProgress.completed}/${bulkProgress.total}…`
                : `Export ${selectedSlugs.size}`}
            </button>
            <button
              className="library-bulk-secondary"
              onClick={clearSelection}
              disabled={bulkBusy}
            >
              Clear
            </button>
          </div>
        </div>
      )}
      <div className="library-footer">
        <label className="library-snap-toggle">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          <span>Snap to grid</span>
          <span className="kbd-hint">G</span>
        </label>
        {onOpenSettings && (
          <button
            type="button"
            className="library-settings-button"
            onClick={onOpenSettings}
            aria-label="Workspace settings"
            title="Workspace settings"
            data-testid="library-settings-button"
          >
            ⚙ Workspace settings
          </button>
        )}
      </div>
      {/* Issue #7 Wave 2 (F5): item-detail modal. Self-gates on
          detailModalSlug — renders nothing when closed. */}
      <DetailModal />
      {/* Issue #8 Wave 2C: embed/share modal. Self-gates on
          embedModalDiagram — renders nothing when closed. */}
      <EmbedModal />
    </aside>
  );
}
