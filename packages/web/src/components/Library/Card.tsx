import { useEffect, useState } from "react";
import { api, authFetch } from "../../lib/api";
import { useAppStore } from "../../store";
import { toastError } from "../../lib/toast";
import type { LibraryEntry } from "@prixmaviz/shared";

/**
 * Slug-keyed thumbnail loader. Fetches the rendered SVG/PNG blob from the
 * server's `/api/library/:slug/thumb` endpoint, converts to an object URL,
 * and revokes it on unmount. Returns null while loading.
 *
 * Extracted from Library.tsx during the Issue #7 Wave 2C file split.
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

export interface CardProps {
  /** The Library entry to render. */
  entry: LibraryEntry;
  /** Slug derived from `entry.path` — passed in so the parent's slug list stays the source of truth. */
  slug: string;
  /** Whether this card matches the active diagram. */
  active: boolean;
  /** Whether the parent Library is in bulk-select mode (changes click semantics). */
  selectMode: boolean;
  /** Whether this card is currently checked under bulk-select. */
  checked: boolean;
  /** Click handler — receives the original mouse event so Shift-range selection works. */
  onItemClick: (entry: LibraryEntry, slug: string, e: React.MouseEvent) => void;
  /**
   * Whether the card should be HTML5-draggable. Issue #7 Wave 2C uses this
   * to wire folder drag-drop in the All / Pinned / Recent sections; Wave 2E
   * will set `draggable={false}` when rendering inside the detail modal so
   * the modal trigger doesn't double as a drag source.
   */
  draggable?: boolean;
}

/**
 * Single Library card. Extracted from the inline `.library-item` markup
 * that previously lived in Library.tsx. The component is intentionally
 * lean: parent decides the slug, the checked state, the click handler,
 * and whether dragging is enabled — Card just renders.
 *
 * Issue #7 Wave 2C — file split (no behavior change vs. the inline JSX
 * that lived in Library.tsx before this commit). The follow-up commits
 * in this PR wire drag-drop into the `draggable` path.
 */
export function Card({
  entry,
  slug,
  active,
  selectMode,
  checked,
  onItemClick,
  draggable = false,
}: CardProps) {
  const itemClasses = [
    "library-item",
    active ? "active" : "",
    selectMode ? "select-mode" : "",
    checked ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function onDragStart(e: React.DragEvent<HTMLDivElement>): void {
    // Issue #7 Wave 2C: native HTML5 DnD payload format. The folder
    // drop target reads this MIME on `onDrop` and parses the slug.
    // We intentionally use a custom MIME so other drop targets on the
    // page (browser tabs, OS file drops) don't intercept it.
    e.dataTransfer.setData("application/x-prixmaviz-diagram", slug);
    e.dataTransfer.effectAllowed = "move";
  }

  // Issue #7 Wave 2 / spec F4: star toggle. Optimistic store update
  // happens synchronously BEFORE the await, so the UI flips immediately;
  // on API failure we revert and surface a toast.
  async function onToggleStar(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    const next = !entry.pinned;
    const setLibraryPinned = useAppStore.getState().setLibraryPinned;
    setLibraryPinned(entry.id, next);
    try {
      await api.setPinned(entry.id, next);
    } catch (err) {
      // Revert.
      setLibraryPinned(entry.id, !next);
      toastError(
        `Failed to ${next ? "pin" : "unpin"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Issue #7 Wave 2 (F3): clicking a tag chip on a card adds it to the
  // global tag-filter set. stopPropagation prevents the card's onClick
  // (which would open the diagram) from firing in the same gesture.
  function onTagClick(tag: string, e: React.MouseEvent): void {
    e.stopPropagation();
    useAppStore.getState().addTagFilter(tag);
  }

  // Issue #7 Wave 2 (F5): per-card ⋯ menu opens the detail modal for
  // this entry's slug. Hidden under bulk-select mode (the row click is
  // already overloaded with multi-select semantics there).
  function onOpenMenu(e: React.MouseEvent): void {
    e.stopPropagation();
    useAppStore.getState().openDetailModal(slug);
  }

  return (
    <div
      className={itemClasses}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onClick={(e) => onItemClick(entry, slug, e)}
      data-slug={slug}
    >
      {selectMode && (
        <input
          type="checkbox"
          className="library-checkbox"
          checked={checked}
          onChange={() => {
            /* row onClick handles it */
          }}
          aria-label={`Select ${entry.name}`}
        />
      )}
      <button
        type="button"
        className={`library-star${entry.pinned ? " pinned" : ""}`}
        onClick={(e) => void onToggleStar(e)}
        aria-pressed={entry.pinned ? "true" : "false"}
        aria-label={entry.pinned ? "Unpin" : "Pin to top"}
        title={entry.pinned ? "Unpin" : "Pin to top"}
        data-testid={`library-star-${entry.name}`}
      >
        {entry.pinned ? "★" : "☆"}
      </button>
      {!selectMode && (
        <button
          type="button"
          className="library-item-menu"
          onClick={onOpenMenu}
          aria-label={`Details for ${entry.name}`}
          title="Details"
          data-testid={`library-item-menu-${slug}`}
        >
          ⋯
        </button>
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
            <button
              key={t}
              type="button"
              className="tag"
              onClick={(e) => onTagClick(t, e)}
              title={`Filter by ${t}`}
              data-testid={`library-tag-${entry.name}-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Hoisted from Library.tsx unchanged. Exported as a named util so tests
 * and future siblings (e.g. the detail modal) can render the same string
 * without re-implementing.
 */
export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
