import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { InfiniteCanvas } from "./components/InfiniteCanvas";
import { useWebSocket } from "./lib/ws";

export function App() {
  useWebSocket();
  return (
    <div className="app">
      <Topbar />
      <div className="workspace">
        <Library />
        <InfiniteCanvas />
      </div>
    </div>
  );
}
