import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_SORT_LABELS,
  compareLibraryEntries,
  useAppStore,
  type LibrarySortKey,
} from "../store";
import { api, authFetch } from "../lib/api";
import { basename } from "../lib/path";
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
    // Only clear if this is still the most-recent focus — guards against
    // racing focuses where a newer pulse would otherwise be killed early.
    if (useAppStore.getState().recentlyFocusedTileId === tile.id) {
      useAppStore.getState().setRecentlyFocusedTileId(null);
    }
  }, 1500);
  return () => clearTimeout(handle);
}

// Exported for tests.
export const _focusExistingTile = focusExistingTile;

/**
 * Library thumbnails go through an auth'd fetch → blob URL because the
 * server requires `Authorization: Bearer <workspaceId>` on `/api/library/
 * <slug>/thumb`, and browsers don't let you attach headers to a bare
 * `<img src>`. Without this, every thumbnail 401s and shows blank.
 */
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

export function Library() {
  const library = useAppStore((s) => s.library);
  const diagram = useAppStore((s) => s.diagram);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const setDiagram = useAppStore((s) => s.setDiagram);
  const setRender = useAppStore((s) => s.setRender);
  const setError = useAppStore((s) => s.setError);
  // Issue #4: client-side sort key + setter, persisted to localStorage.
  const librarySortKey = useAppStore((s) => s.librarySortKey);
  const setLibrarySortKey = useAppStore((s) => s.setLibrarySortKey);
  const [search, setSearch] = useState("");
  // Track the pending "clear pulse" timeout so we can cancel it on unmount
  // or when a new focus pulse supersedes it.
  const cancelFocusRef = useRef<(() => void) | null>(null);
  // Issue #4: scroll-affordance state. We mirror the list's "is there more
  // above/below?" answer into data attributes that drive the CSS gradient
  // overlays — pure CSS can't see scroll position, so we have to.
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

  // Cancel any pending pulse-clear when the Library unmounts so the timeout
  // doesn't fire against a stale store.
  useEffect(() => {
    return () => {
      if (cancelFocusRef.current) cancelFocusRef.current();
    };
  }, []);

  // Issue #4: sort first (stable, persisted), then filter by search. This
  // ordering matches the issue's "sort → filter → render" pipeline so the
  // user-visible count and the rendered order line up.
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

  // Issue #4: update scroll-affordance state on layout changes, scroll
  // events, and any time the rendered list length changes. The 1px slack on
  // each end avoids flicker from sub-pixel fractional scrollTop values.
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

      // Issue #3: client-side dedup. If a tile for this diagram is already
      // on the canvas, don't create another — just pan + pulse the existing
      // one. The server still has a parallel check (belt-and-suspenders for
      // multi-tab races); see POST /api/tiles in packages/server/src/http/routes.ts.
      const existing = useAppStore.getState().tiles.find((t) => t.diagramSlug === slug);
      if (existing) {
        // Cancel any in-flight pulse-clear from a previous focus so the
        // earlier setTimeout doesn't wipe this new pulse early.
        if (cancelFocusRef.current) cancelFocusRef.current();
        cancelFocusRef.current = focusExistingTile(existing);
        // Still load + bind to the legacy single-diagram surface so the
        // sidebar `active` class lights up and the diagram editor (if any)
        // reflects the focused diagram.
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
      // create a tile at viewport center
      const camera = useAppStore.getState().camera;
      await api.createTile({
        diagramId: result.diagramId,
        diagramSlug: slug,
        x: camera.x + 60,
        y: camera.y + 60,
        w: 600, h: 400,
      });
      // also keep current diagram = first opened (for legacy single-canvas paths)
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

  // Issue #4: header count format. Show "12 / 47" when a search filter is
  // active so the user always knows both the visible-match total and the
  // workspace total.
  const total = library.length;
  const searchActive = search.length > 0;
  const countLabel = searchActive ? `${filtered.length} / ${total}` : `${total}`;
  const countTitle = searchActive
    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"} of ${total} diagram${total === 1 ? "" : "s"}`
    : `${total} diagram${total === 1 ? "" : "s"}`;

  return (
    <aside className="library">
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
            return (
              <div
                key={entry.path}
                className={`library-item ${active ? "active" : ""}`}
                onClick={() => open(entry)}
              >
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
