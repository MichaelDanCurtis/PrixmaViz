import { useEffect, useState } from "react";
import { api, clearWorkspaceId } from "../lib/api";
import { useAppStore } from "../store";

interface Props { onClose: () => void; }

export function SettingsPanel({ onClose }: Props) {
  const workspaceId = useAppStore((s) => s.workspaceId);
  const storedName = useAppStore((s) => s.workspaceName);
  const setStoredName = useAppStore((s) => s.setWorkspaceName);

  const [workspaceName, setWorkspaceName] = useState<string>(storedName ?? "");
  const [initialName, setInitialName] = useState<string>(storedName ?? "");
  const [krokiUrl, setKrokiUrl] = useState<string>("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => setKrokiUrl(s.krokiUrl))
      .catch(() => setKrokiUrl("https://kroki.io"));
    // Load workspace metadata for the name field.
    api.getWorkspace()
      .then((w) => {
        setWorkspaceName(w.name ?? "");
        setInitialName(w.name ?? "");
        setStoredName(w.name ?? null);
      })
      .catch(() => {});
  }, [setStoredName]);

  async function onTest() {
    setTestStatus("testing");
    setTestError(null);
    const r = await api.testKrokiConnection(krokiUrl);
    if (r.ok) setTestStatus("ok");
    else { setTestStatus("fail"); setTestError(r.error ?? "unknown"); }
  }

  async function onSave() {
    setSaving(true);
    try {
      if (workspaceName !== initialName) {
        await fetch("/api/workspace/name", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(workspaceId ? { Authorization: `Bearer ${workspaceId}` } : {}),
          },
          body: JSON.stringify({ name: workspaceName.trim() === "" ? null : workspaceName.trim() }),
        });
        setStoredName(workspaceName.trim() === "" ? null : workspaceName.trim());
      }
      await api.setSettings({ krokiUrl });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteWorkspace() {
    if (!workspaceId) return;
    if (!confirm("Delete this workspace and all its diagrams? This cannot be undone.")) return;
    await fetch("/api/workspace", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${workspaceId}` },
    });
    clearWorkspaceId();
    window.location.href = "/";
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Workspace settings</h2>

        <label>
          <span>Workspace name</span>
          <input
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="Untitled workspace"
            data-testid="workspace-name-input"
          />
        </label>

        <label>
          <span>Workspace ID (for shim / MCP setup)</span>
          <input
            type="text"
            readOnly
            value={workspaceId ?? ""}
            onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
            data-testid="workspace-id-input"
          />
        </label>
        <p className="settings-hint">
          Point your local shim or MCP client at this workspace by passing
          this UUID as the bearer token (<code>Authorization: Bearer &lt;id&gt;</code>).
        </p>

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

        <p className="settings-hint settings-soon">
          More workspace defaults (default engine, default tile size,
          snap-to-grid, theme) are coming soon — see issue #9.
        </p>

        <div className="settings-danger">
          <h3>Danger zone</h3>
          <p className="settings-hint">Deletes this workspace and all its diagrams. This cannot be undone.</p>
          <button className="settings-danger-button" onClick={onDeleteWorkspace}>
            Delete workspace
          </button>
        </div>

        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onSave} className="settings-save" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
