import { useState } from "react";

interface Props { onClose: () => void; }

export function UninstallDialog({ onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setConfirming(true);
    setError(null);
    try {
      // @ts-ignore — __TAURI__ exists only inside the Tauri webview
      const tauri = (window as any).__TAURI__;
      if (!tauri) throw new Error("Tauri API not available");
      const result = await tauri.core.invoke("uninstall_plugin_cmd") as [boolean, string];
      const [uninstalled, message] = result;
      setResultMessage(message);
      if (uninstalled) setDone(true);
      else setError(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Uninstall PrixmaViz Plugin</h2>
        {!done ? (
          <>
            <p>This will run <code>claude plugins uninstall prixmaviz@prixmaviz-local</code> and clean up the plugin cache directory.</p>
            <p className="settings-hint">Saved diagrams in your projects' <code>.prixmaviz/</code> directories are not affected.</p>
            {error && <p className="settings-status fail">Error: {error}</p>}
            <div className="settings-actions">
              <button onClick={onClose}>Cancel</button>
              <button onClick={onConfirm} disabled={confirming} className="settings-save">
                {confirming ? "Uninstalling…" : "Uninstall"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="settings-status ok">✓ {resultMessage}</p>
            <div className="settings-actions">
              <button onClick={onClose} className="settings-save">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
