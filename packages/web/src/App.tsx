import { useState, useEffect } from "react";
import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { InfiniteCanvas } from "./components/InfiniteCanvas";
import { useWebSocket } from "./lib/ws";
import { SettingsPanel } from "./components/SettingsPanel";
import { UninstallDialog } from "./components/UninstallDialog";
import { ensureWorkspaceId } from "./lib/api";
import { useAppStore } from "./store";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const workspaceId = useAppStore((s) => s.workspaceId);
  const setWorkspaceId = useAppStore((s) => s.setWorkspaceId);

  // Bootstrap the workspace UUID before mounting anything that hits /api/*.
  useEffect(() => {
    let cancelled = false;
    ensureWorkspaceId()
      .then((id) => {
        if (cancelled) return;
        setWorkspaceId(id);
        setBootstrapping(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setBootstrapError(e instanceof Error ? e.message : String(e));
        setBootstrapping(false);
      });
    return () => { cancelled = true; };
  }, [setWorkspaceId]);

  // Hooks must be called unconditionally — useWebSocket gates internally on workspaceId.
  useWebSocket();

  useEffect(() => {
    // @ts-ignore — __TAURI__ exists only when running inside the Tauri webview
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      // @ts-ignore
      const tauri = (window as any).__TAURI__;
      const cleanups: (() => void)[] = [];
      tauri.event
        .listen("open-settings", () => setSettingsOpen(true))
        .then((unlisten: () => void) => {
          cleanups.push(unlisten);
        });
      tauri.event
        .listen("open-uninstall", () => setUninstallOpen(true))
        .then((unlisten: () => void) => {
          cleanups.push(unlisten);
        });
      return () => {
        cleanups.forEach((fn) => fn());
      };
    }
  }, []);

  if (bootstrapping) {
    return <div className="app-bootstrapping">Loading PrixmaViz…</div>;
  }
  if (bootstrapError || !workspaceId) {
    return (
      <div className="app-bootstrapping app-bootstrapping-error">
        Failed to start: {bootstrapError ?? "no workspace"}
      </div>
    );
  }

  return (
    <div className="app">
      <Topbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="workspace">
        <Library />
        <InfiniteCanvas />
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {uninstallOpen && <UninstallDialog onClose={() => setUninstallOpen(false)} />}
    </div>
  );
}
