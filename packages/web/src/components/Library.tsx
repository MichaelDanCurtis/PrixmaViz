import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_SORT_LABELS,
  compareLibraryEntries,
  useAppStore,
  type LibrarySortKey,
} from "../store";
import { api, authFetch } from "../lib/api";
import { basename } from "../lib/path";
import { toastError, toastInfo, toastSuccess } from "../lib/toast";
import type { ExportFormat, BulkPackaging } from "../lib/export";
import type { LibraryEntry, Tile } from "@prixmaviz/shared";

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

function LibraryThumb({ slug }: { slug: string }) {
  const [blobUrl, setBlobUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    let createdUrl = "";
    authFetch(`/api/library/${encodeURIComponent(slug)}/thumb`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (cancelled || !b) return;
        createdUrl = URL.createObjectURL(b);
        setBlobUrl(createdUrl);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [slug]);
  return blobUrl ? <img src={blobUrl} alt="" /> : null;
}

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
  const [search, setSearch] = useState("");
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

  useEffect(() => {
    api.library().then(setLibrary).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [setLibrary, setError]);

  useEffect(() => {
    return () => {
      if (cancelFocusRef.current) cancelFocusRef.current();
    };
  }, []);

  const sorted = useMemo(
    () => [...library].sort((a, b) => compareLibraryEntries(a, b, librarySortKey)),
    [library, librarySortKey],
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [sorted, search]);

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
  const total = library.length;
  const searchActive = search.length > 0;
  const countLabel = searchActive ? `${filtered.length} / ${total}` : `${total}`;
  const countTitle = searchActive
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
      const { exportBulk } = await import("../lib/export");
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
      >
        <div className="library-list" ref={listRef} data-testid="library-list">
          {filtered.map((entry) => {
            const slug = basename(entry.path).replace(/\.pviz$/, "");
            const active = diagram?.name === entry.name;
            const checked = selectedSlugs.has(slug);
            const itemClasses = [
              "library-item",
              active ? "active" : "",
              selectMode ? "select-mode" : "",
              checked ? "selected" : "",
            ].filter(Boolean).join(" ");
            return (
              <div
                key={entry.path}
                className={itemClasses}
                onClick={(e) => onItemClick(entry, slug, e)}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    className="library-checkbox"
                    checked={checked}
                    onChange={() => { /* row onClick handles it */ }}
                    aria-label={`Select ${entry.name}`}
                  />
                )}
                <div className="library-thumb">
                  <LibraryThumb slug={slug} />
                </div>
                <div className="library-name">{entry.name}</div>
                <div className="library-meta">
                  {entry.engine} · {relativeTime(entry.updatedAt)}
                </div>
                {entry.tags.length > 0 && (
                  <div className="library-tags">
                    {entry.tags.map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            );
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
    </aside>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
