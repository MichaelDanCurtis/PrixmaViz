import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Props { onClose: () => void; }

export function SettingsPanel({ onClose }: Props) {
  const [krokiUrl, setKrokiUrl] = useState<string>("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings()
      .then((s) => setKrokiUrl(s.krokiUrl))
      .catch(() => setKrokiUrl("https://kroki.io"));
  }, []);

  async function onTest() {
    setTestStatus("testing");
    setTestError(null);
    const r = await api.testKrokiConnection(krokiUrl);
    if (r.ok) setTestStatus("ok");
    else { setTestStatus("fail"); setTestError(r.error ?? "unknown"); }
  }

  async function onSave() {
    await api.setSettings({ krokiUrl });
    onClose();
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          <span>Kroki URL</span>
          <input
            type="text"
            value={krokiUrl}
            onChange={(e) => setKrokiUrl(e.target.value)}
            placeholder="https://kroki.io"
          />
        </label>
        <p className="settings-hint">
          The default <code>https://kroki.io</code> sends your diagram source to a public service.
          For private content, run Kroki locally (e.g. <code>http://localhost:18000</code>) or use your organization's deployment.
        </p>
        <div className="settings-row">
          <button onClick={onTest}>Test connection</button>
          {testStatus === "testing" && <span className="settings-status">testing…</span>}
          {testStatus === "ok" && <span className="settings-status ok">✓ reachable</span>}
          {testStatus === "fail" && <span className="settings-status fail">✗ {testError}</span>}
        </div>
        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onSave} className="settings-save">Save</button>
        </div>
      </div>
    </div>
  );
}
