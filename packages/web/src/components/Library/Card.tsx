import { useEffect, useState } from "react";
import { authFetch } from "../../lib/api";
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
            <span key={t} className="tag">
              {t}
            </span>
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
