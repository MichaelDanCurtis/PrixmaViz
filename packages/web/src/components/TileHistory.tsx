import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { diffLines, diffStats } from "../lib/line-diff";
import type { DiffLine } from "../lib/line-diff";

// Issue #6: per-tile version history panel.
//   - Lists snapshots newest-first
//   - Click one to preview a line-level diff (selected source vs current)
//   - "Restore" rolls back to that version (snapshotting current first)
//
// Lives inside the tile body alongside the renderer; appears as an overlay
// when toggled from the tile header. Auto-refreshes after each restore.

interface Version {
  id: string;
  engine: string;
  kind: string;
  source: string | null;
  createdAt: string;
}

interface Props {
  diagramId: string;
  /** Called after a successful restore. Parent updates the tile's SVG. */
  onRestored?: (newSource: string, newSvg: string) => void;
  onClose: () => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function TileHistory({ diagramId, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [currentSource, setCurrentSource] = useState<string>("");
  const [restoring, setRestoring] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [list, cur] = await Promise.all([
        api.listVersions(diagramId),
        api.getSource(diagramId).then((r) => r.source).catch(() => ""),
      ]);
      setVersions(list);
      setCurrentSource(cur);
      if (list.length > 0 && !selected) setSelected(list[0]!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [diagramId]);

  const selectedVersion = versions.find((v) => v.id === selected) ?? null;
  const diff: DiffLine[] = selectedVersion
    ? diffLines(selectedVersion.source ?? "", currentSource)
    : [];
  const stats = diffStats(diff);

  async function onRestore(versionId: string): Promise<void> {
    if (restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const result = await api.restoreVersion(diagramId, versionId);
      onRestored?.(result.source, result.render.svg);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="tile-history" onMouseDown={(e) => e.stopPropagation()} data-testid="tile-history">
      <div className="tile-history-header">
        <span className="tile-history-title">Version History</span>
        <button className="tile-history-close" onClick={onClose} title="Close">×</button>
      </div>
      {loading && <div className="tile-history-empty">Loading…</div>}
      {error && (
        <div className="tile-history-error">
          <pre>{error}</pre>
        </div>
      )}
      {!loading && !error && versions.length === 0 && (
        <div className="tile-history-empty">
          No prior versions yet. The next time you save an edit, a snapshot
          will appear here.
        </div>
      )}
      {!loading && versions.length > 0 && (
        <div className="tile-history-body">
          <ul className="tile-history-list">
            {versions.map((v, i) => (
              <li
                key={v.id}
                className={`tile-history-item${selected === v.id ? " selected" : ""}`}
                onClick={() => setSelected(v.id)}
                data-testid={`history-version-${i}`}
              >
                <div className="tile-history-item-time">{formatTime(v.createdAt)}</div>
                <div className="tile-history-item-meta">
                  {v.engine} · {v.source?.split("\n").length ?? 0} lines
                </div>
              </li>
            ))}
          </ul>
          <div className="tile-history-detail">
            {selectedVersion ? (
              <>
                <div className="tile-history-detail-head">
                  <span>vs current</span>
                  <span className="tile-history-diff-stats">
                    <span className="added">+{stats.added}</span>
                    <span className="removed">−{stats.removed}</span>
                  </span>
                  <button
                    className="tile-history-restore"
                    onClick={() => void onRestore(selectedVersion.id)}
                    disabled={restoring}
                    data-testid="history-restore-button"
                  >
                    {restoring ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
                <pre className="tile-history-diff">
                  {diff.length === 0
                    ? <span className="muted">(no source recorded)</span>
                    : diff.map((line, idx) => {
                        const sign = line.kind === "added" ? "+" :
                                     line.kind === "removed" ? "−" : " ";
                        return (
                          <span
                            key={idx}
                            className={`diff-line diff-${line.kind}`}
                          >{sign} {line.text || " "}{"\n"}</span>
                        );
                      })}
                </pre>
              </>
            ) : (
              <div className="tile-history-empty">Select a version on the left.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
