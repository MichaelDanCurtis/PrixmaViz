import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// Issue #6: inline DSL editor for a tile. Shown when the tile is in "edit
// mode" (toggle on Tile.tsx). Loads current source via GET /source, saves
// on blur / Ctrl-Enter. On render failure the editor stays open with the
// user's text preserved and the engine error rendered inline below the
// textarea. Plain <textarea> + CSS line-numbers — no Monaco / CodeMirror.
//
// Saving is "trial-render then persist" on the server; we never overwrite
// the live SVG on failure, so the tile's render pane (the parent) keeps
// showing the prior good output behind the editor.

interface Props {
  diagramId: string;
  /** Fired when an edit completes successfully (parent updates its SVG). */
  onSaved?: (svg: string) => void;
  /** Fired when the user explicitly closes the editor. */
  onClose: () => void;
  /** Optional initial source override (e.g. after a restore round-trip). */
  initialSource?: string;
}

export function TileEditor({ diagramId, onSaved, onClose, initialSource }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState<string>(initialSource ?? "");
  const [loaded, setLoaded] = useState<boolean>(initialSource !== undefined);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Load current source on mount (skip if caller passed initialSource).
  useEffect(() => {
    let stop = false;
    if (initialSource !== undefined) return;
    api.getSource(diagramId)
      .then((r) => { if (!stop) { setSource(r.source); setLoaded(true); } })
      .catch((e) => { if (!stop) setError(e instanceof Error ? e.message : String(e)); });
    return () => { stop = true; };
  }, [diagramId, initialSource]);

  // If a parent updates initialSource (e.g. after restoring a version),
  // re-load the textarea.
  useEffect(() => {
    if (initialSource !== undefined) {
      setSource(initialSource);
      setLoaded(true);
    }
  }, [initialSource]);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    const result = await api.updateSource(diagramId, source);
    setSaving(false);
    if (result.ok) {
      setInfo("Saved");
      onSaved?.(result.svg);
      // clear the "Saved" toast after a beat
      window.setTimeout(() => setInfo(null), 1200);
    } else {
      setError(result.error);
      // Don't clear the textarea — the user's text is the source of truth.
      // Server may also echo the failed text back; prefer the server's echo
      // (in case of any normalization) but fall back to local state.
      if (result.source !== undefined && result.source !== source) {
        setSource(result.source);
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl/Cmd-Enter → save. Ctrl/Cmd-S also saves (and prevents browser save).
    if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "s")) {
      e.preventDefault();
      void save();
      return;
    }
    // Esc closes (without saving).
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Compute line numbers from current text. Cheap; ~hundreds of lines max.
  const lineCount = source === "" ? 1 : source.split("\n").length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");

  return (
    <div className="tile-editor" onMouseDown={(e) => e.stopPropagation()}>
      <div className="tile-editor-toolbar">
        <span className="tile-editor-title">DSL Source</span>
        {saving && <span className="tile-editor-status saving">Saving…</span>}
        {!saving && info && <span className="tile-editor-status ok">{info}</span>}
        {!saving && error && <span className="tile-editor-status err" title={error}>Render failed</span>}
        <button
          type="button"
          className="tile-editor-save"
          onClick={() => void save()}
          disabled={saving || !loaded}
          title="Save (Cmd/Ctrl+Enter)"
        >
          Save
        </button>
        <button
          type="button"
          className="tile-editor-close"
          onClick={onClose}
          title="Close editor (Esc)"
        >
          Done
        </button>
      </div>
      <div className="tile-editor-body">
        <pre className="tile-editor-gutter" aria-hidden="true">{lineNumbers}</pre>
        <textarea
          ref={taRef}
          className="tile-editor-textarea"
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (loaded) void save(); }}
          placeholder={loaded ? "" : "Loading…"}
          disabled={!loaded}
        />
      </div>
      {error && (
        <div className="tile-editor-error" role="alert">
          <strong>Render error:</strong>
          <pre>{error}</pre>
        </div>
      )}
    </div>
  );
}
