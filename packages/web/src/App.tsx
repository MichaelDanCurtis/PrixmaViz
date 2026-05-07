import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { Canvas } from "./components/Canvas";
import { useWebSocket } from "./lib/ws";

export function App() {
  useWebSocket();
  return (
    <div className="app">
      <Topbar />
      <div className="workspace">
        <Library />
        <Canvas />
      </div>
    </div>
  );
}
