import { useAppStore } from "../store";
import { api } from "../lib/api";
import { ALL_ENGINES } from "@prixmaviz/shared";
import { ToolPalette } from "./ToolPalette";

interface TopbarProps { onOpenSettings?: () => void; }

export function Topbar({ onOpenSettings }: TopbarProps = {}) {
  const diagram = useAppStore((s) => s.diagram);
  const wsStatus = useAppStore((s) => s.wsStatus);
  const pending = useAppStore((s) => s.pending);
  const setPending = useAppStore((s) => s.setPending);
  const setError = useAppStore((s) => s.setError);

  const dot =
    wsStatus === "open" ? "ok" :
    wsStatus === "closed" ? "err" :
    "";

  async function onSave() {
    if (!diagram) return;
    setPending(true);
    try {
      await api.save(diagram.id, { name: diagram.name, tags: diagram.meta.tags });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <header className="topbar">
      <h1>PrixmaViz</h1>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {diagram ? `${diagram.engine} · ${diagram.kind}` : "no diagram"}
      </span>
      <ToolPalette />
      <div className="spacer" />
      {diagram && (
        <button className="primary" onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      )}
      <button className="topbar-button" onClick={onOpenSettings} title="Settings">⚙ Settings</button>
      <div className="status">
        <span className={`dot ${dot}`} />
        <span>ws · {wsStatus}</span>
      </div>
    </header>
  );
}
