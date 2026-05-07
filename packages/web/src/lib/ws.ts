import { useEffect } from "react";
import { useAppStore } from "../store";
import type { ServerToClient } from "@prixmaviz/shared";

export function useWebSocket(): void {
  const setWsStatus = useAppStore((s) => s.setWsStatus);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const setRender = useAppStore((s) => s.setRender);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectDelay = 1000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      setWsStatus("connecting");
      ws.onopen = () => {
        reconnectDelay = 1000;
        setWsStatus("open");
      };
      ws.onclose = () => {
        setWsStatus("closed");
        if (!stopped) {
          timer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerToClient;
          handleMessage(msg, { setLibrary, setRender });
        } catch {}
      };
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [setWsStatus, setLibrary, setRender]);
}

function handleMessage(
  msg: ServerToClient,
  deps: {
    setLibrary: (e: import("@prixmaviz/shared").LibraryEntry[]) => void;
    setRender: (
      id: import("@prixmaviz/shared").DiagramId,
      svg: string,
      dsl: string,
      ir?: import("@prixmaviz/shared").GraphIR,
    ) => void;
  },
): void {
  if (msg.type === "render") {
    deps.setRender(msg.diagramId, msg.svg, msg.dsl, msg.ir);
  } else if (msg.type === "library") {
    deps.setLibrary(msg.entries);
  }
}
