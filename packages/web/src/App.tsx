import { useState, useEffect } from "react";
import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { InfiniteCanvas } from "./components/InfiniteCanvas";
import { useWebSocket } from "./lib/ws";
import { SettingsPanel } from "./components/SettingsPanel";
import { UninstallDialog } from "./components/UninstallDialog";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
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
