import { useState } from "react";
import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { InfiniteCanvas } from "./components/InfiniteCanvas";
import { useWebSocket } from "./lib/ws";
import { SettingsPanel } from "./components/SettingsPanel";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  useWebSocket();
  return (
    <div className="app">
      <Topbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="workspace">
        <Library />
        <InfiniteCanvas />
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
