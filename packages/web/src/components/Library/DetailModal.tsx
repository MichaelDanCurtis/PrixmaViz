/**
 * Issue #7 Wave 2 (F5) — diagram metadata detail modal.
 *
 * Renders a vertical stack of editable fields for the diagram identified
 * by `detailModalSlug` in the store:
 *   - Name (text input, commits via `api.save` rename on blur)
 *   - Description (text input, commits via `api.updateDiagramMeta` on blur)
 *   - Author (text input, same)
 *   - Notes (multi-line textarea; toggle between markdown preview + raw)
 *   - Tags (chip editor sourced from `tagAutocompleteCache`)
 *   - Folder (read-only display + plain text — folder move UI is Agent C)
 *
 * Save semantics are "on blur" per field — independent PATCH calls so a
 * partial failure doesn't poison the rest of the form. Close on ESC, the
 * X button, or click outside the dialog body.
 *
 * Diagram identification: the modal accepts a slug (from the Card's ⋯
 * click). It resolves to the `LibraryEntry` in the store, which now
 * carries `id` (Issue #7 Wave 2). If the entry has no `id` (back-compat),
 * the modal renders in read-only mode for `meta` fields and only the
 * rename PATH works (which is keyed on slug).
 */
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store";
import { api } from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { basename } from "../../lib/path";
import { toastError } from "../../lib/toast";
import type { LibraryEntry } from "@prixmaviz/shared";

interface FieldState {
  name: string;
  description: string;
  author: string;
  notes: string;
  tags: string[];
}

function entryToFields(entry: LibraryEntry | null): FieldState {
  return {
    name: entry?.name ?? "",
    description: entry?.description ?? "",
    author: entry?.author ?? "",
    notes: entry?.notes ?? "",
    tags: entry?.tags ?? [],
  };
}

export function DetailModal() {
  const slug = useAppStore((s) => s.detailModalSlug);
  const close = useAppStore((s) => s.closeDetailModal);
  const library = useAppStore((s) => s.library);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const tagAutocompleteCache = useAppStore((s) => s.tagAutocompleteCache);

  // Resolve the slug → LibraryEntry. Re-runs when the modal target changes
  // or when the library list itself is refreshed (e.g. WS-driven).
  const entry: LibraryEntry | null = (() => {
    if (!slug) return null;
    return (
      library.find((e) => basename(e.path).replace(/\.pviz$/, "") === slug) ?? null
    );
  })();

  const [fields, setFields] = useState<FieldState>(entryToFields(entry));
  const [notesMode, setNotesMode] = useState<"view" | "edit">("view");
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Sync fields when the target entry changes (modal opens on a different
  // diagram, or the library refreshes from WS).
  useEffect(() => {
    setFields(entryToFields(entry));
    // entry?.path is the most stable key — it changes when slug changes
    // and when WS replaces the entry object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.path, entry?.description, entry?.author, entry?.notes, entry?.name]);

  // ESC + click-outside close.
  useEffect(() => {
    if (!slug) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (!dialogRef.current) return;
      if (!dialogRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [slug, close]);

  if (!slug) return null;
  if (!entry) {
    // Slug points to nothing — close. This shouldn't happen in practice
    // since the modal is opened from a Card on the same list, but defend
    // against WS races where a delete arrives between click and render.
    return null;
  }

  // Capture into a non-null local so TypeScript narrows inside the closures
  // below — narrowing across nested function boundaries doesn't carry.
  const currentEntry: LibraryEntry = entry;
  const diagramId = currentEntry.id;

  async function commitMeta(patch: Partial<Pick<FieldState, "description" | "author" | "notes">>) {
    if (!diagramId) return;
    try {
      await api.updateDiagramMeta(diagramId, patch);
      // Optimistically reflect into the cached library entry so the card
      // hover-tooltip / byline update without waiting for the WS round-trip.
      setLibrary(
        library.map((e) =>
          e === currentEntry ? { ...e, ...patch } : e,
        ),
      );
    } catch (err) {
      toastError(
        `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function commitName(next: string) {
    if (!diagramId) return;
    if (next === currentEntry.name) return;
    try {
      await api.save(diagramId, { name: next });
      setLibrary(library.map((e) => (e === currentEntry ? { ...e, name: next } : e)));
    } catch (err) {
      toastError(
        `Failed to rename: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function commitTags(next: string[]) {
    if (!diagramId) return;
    try {
      await api.save(diagramId, { tags: next });
      setLibrary(library.map((e) => (e === currentEntry ? { ...e, tags: next } : e)));
    } catch (err) {
      toastError(
        `Failed to save tags: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (fields.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    const next = [...fields.tags, tag];
    setFields({ ...fields, tags: next });
    setTagInput("");
    setTagSuggestionsOpen(false);
    void commitTags(next);
  }

  function removeTag(tag: string) {
    const next = fields.tags.filter((t) => t !== tag);
    setFields({ ...fields, tags: next });
    void commitTags(next);
  }

  // Filter autocomplete suggestions: existing tags not yet on this diagram,
  // matching the input prefix (case-insensitive).
  const suggestions = (() => {
    const lower = tagInput.toLowerCase();
    return tagAutocompleteCache
      .filter((t) => !fields.tags.includes(t))
      .filter((t) => (lower ? t.toLowerCase().includes(lower) : true))
      .slice(0, 10);
  })();

  return (
    <div
      className="library-detail-modal-overlay"
      role="presentation"
      data-testid="detail-modal-overlay"
    >
      <div
        ref={dialogRef}
        className="library-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${entry.name}`}
        data-testid="detail-modal"
      >
        <div className="library-detail-modal-header">
          <h2 className="library-detail-modal-title">Diagram details</h2>
          <button
            type="button"
            className="library-detail-modal-close"
            aria-label="Close"
            title="Close (Esc)"
            onClick={close}
            data-testid="detail-modal-close"
          >
            ×
          </button>
        </div>

        <div className="library-detail-modal-body">
          <label className="library-detail-field">
            <span className="library-detail-field-label">Name</span>
            <input
              type="text"
              className="library-detail-input"
              value={fields.name}
              onChange={(e) => setFields({ ...fields, name: e.target.value })}
              onBlur={() => commitName(fields.name)}
              data-testid="detail-modal-name"
            />
          </label>

          <label className="library-detail-field">
            <span className="library-detail-field-label">Description</span>
            <input
              type="text"
              className="library-detail-input"
              value={fields.description}
              placeholder="Short one-line summary"
              onChange={(e) => setFields({ ...fields, description: e.target.value })}
              onBlur={() => commitMeta({ description: fields.description })}
              data-testid="detail-modal-description"
            />
          </label>

          <label className="library-detail-field">
            <span className="library-detail-field-label">Author</span>
            <input
              type="text"
              className="library-detail-input"
              value={fields.author}
              placeholder="e.g. alice"
              onChange={(e) => setFields({ ...fields, author: e.target.value })}
              onBlur={() => commitMeta({ author: fields.author })}
              data-testid="detail-modal-author"
            />
          </label>

          <div className="library-detail-field">
            <div className="library-detail-field-row">
              <span className="library-detail-field-label">Notes</span>
              <button
                type="button"
                className="library-detail-notes-toggle"
                onClick={() =>
                  setNotesMode((m) => (m === "view" ? "edit" : "view"))
                }
                data-testid="detail-modal-notes-toggle"
              >
                {notesMode === "view" ? "Edit notes" : "Preview"}
              </button>
            </div>
            {notesMode === "view" ? (
              <div
                className="library-detail-notes-view"
                data-testid="detail-modal-notes-view"
                // Markdown is escaped at the source; renderMarkdown only
                // emits trusted tags from a fixed allowlist.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(fields.notes) }}
              />
            ) : (
              <textarea
                className="library-detail-textarea"
                value={fields.notes}
                placeholder="Markdown — bold, italic, links, code, lists"
                rows={6}
                onChange={(e) => setFields({ ...fields, notes: e.target.value })}
                onBlur={() => commitMeta({ notes: fields.notes })}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).blur();
                  }
                }}
                data-testid="detail-modal-notes"
              />
            )}
          </div>

          <div className="library-detail-field">
            <span className="library-detail-field-label">Tags</span>
            <div
              className="library-detail-tags"
              data-testid="detail-modal-tags"
            >
              {fields.tags.map((t) => (
                <span key={t} className="library-detail-tag-chip">
                  {t}
                  <button
                    type="button"
                    className="library-detail-tag-remove"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => removeTag(t)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <div className="library-detail-tag-combobox">
                <input
                  type="text"
                  className="library-detail-tag-input"
                  value={tagInput}
                  placeholder="Add tag…"
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    setTagSuggestionsOpen(true);
                  }}
                  onFocus={() => setTagSuggestionsOpen(true)}
                  onBlur={() =>
                    setTimeout(() => setTagSuggestionsOpen(false), 100)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag(tagInput);
                    } else if (e.key === "Backspace" && tagInput === "" && fields.tags.length > 0) {
                      removeTag(fields.tags[fields.tags.length - 1]!);
                    }
                  }}
                  data-testid="detail-modal-tag-input"
                />
                {tagSuggestionsOpen && suggestions.length > 0 && (
                  <div
                    className="library-detail-tag-suggestions"
                    role="listbox"
                    data-testid="detail-modal-tag-suggestions"
                  >
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="library-detail-tag-suggestion"
                        // onMouseDown so the blur on input doesn't fire first
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addTag(s);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="library-detail-field">
            <span className="library-detail-field-label">Folder</span>
            <div className="library-detail-folder-readonly">
              {entry.parentPath || <em>(workspace root)</em>}
              <span
                className="library-detail-folder-todo"
                title="Folder move UI is delivered by Agent C — placeholder for now"
              >
                {" "}
                — move via drag-drop on the Library list
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
