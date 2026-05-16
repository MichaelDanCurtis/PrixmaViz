import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
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
  const [search, setSearch] = useState("");
  // Track the pending "clear pulse" timeout so we can cancel it on unmount
  // or when a new focus pulse supersedes it.
  const cancelFocusRef = useRef<(() => void) | null>(null);

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

  const filtered = useMemo(() => {
    if (!search) return library;
    const q = search.toLowerCase();
    return library.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [library, search]);

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

  return (
    <aside className="library">
      <div className="library-header">
        <div className="library-title">Library</div>
      </div>
      <div className="library-search">
        <input
          placeholder="Search diagrams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="library-count">
        {filtered.length} diagram{filtered.length === 1 ? "" : "s"}
      </div>
      <div className="library-list">
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
