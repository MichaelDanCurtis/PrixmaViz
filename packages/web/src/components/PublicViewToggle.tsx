import { useEffect, useState } from "react";
import { api, authFetch, jsonOrThrow } from "../lib/api";

interface Props {
  diagramId: string;
  publicView?: boolean;
  publicUrl?: string;
}

export function PublicViewToggle({ diagramId, publicView: initialPublic, publicUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(initialPublic ?? false);
  const [resolvedUrl, setResolvedUrl] = useState(publicUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the server when an initial state wasn't passed in. Without
  // this we always render the closed-lock icon on mount even for diagrams
  // that are already public.
  useEffect(() => {
    if (initialPublic !== undefined) return;
    let cancelled = false;
    authFetch(`/api/diagrams/${encodeURIComponent(diagramId)}`)
      .then((r) => jsonOrThrow<{ publicView: boolean }>(r))
      .then((d) => { if (!cancelled) setIsPublic(d.publicView); })
      .catch(() => { /* leave as private on failure */ });
    return () => { cancelled = true; };
  }, [diagramId, initialPublic]);

  async function onChange(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.setDiagramVisibility(diagramId, next);
      setIsPublic(result.public);
      setResolvedUrl(result.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-toggle-wrapper">
      <button
        className="public-toggle"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={isPublic ? "Public" : "Private"}
      >
        {isPublic ? "\u{1F310}" : "\u{1F512}"}
      </button>
      {open && (
        <div className="public-toggle-popover" onMouseDown={(e) => e.stopPropagation()}>
          <label>
            <input type="radio" checked={!isPublic} onChange={() => onChange(false)} disabled={busy} />
            {" "}Private
          </label>
          <label>
            <input type="radio" checked={isPublic} onChange={() => onChange(true)} disabled={busy} />
            {" "}Public
          </label>
          {isPublic && resolvedUrl && (
            <>
              <p className="public-toggle-hint">Anyone with this URL can view:</p>
              <input
                className="public-toggle-url"
                type="text"
                readOnly
                value={resolvedUrl}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              />
            </>
          )}
          {error && <p className="public-toggle-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
