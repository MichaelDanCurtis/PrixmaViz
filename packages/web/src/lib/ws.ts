import { useEffect } from "react";
import { useAppStore } from "../store";
import type { ServerToClient } from "@prixmaviz/shared";

export function useWebSocket(): void {
  const setWsStatus = useAppStore((s) => s.setWsStatus);

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
          handleMessage(msg, useAppStore.getState());
        } catch {}
      };
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [setWsStatus]);
}

function handleMessage(
  msg: ServerToClient,
  store: ReturnType<typeof useAppStore.getState>,
): void {
  if (msg.type === "render") {
    store.setRender(msg.diagramId, msg.svg, msg.dsl, msg.ir);
  } else if (msg.type === "library") {
    store.setLibrary(msg.entries);
  } else if (msg.type === "annotation:created") {
    store.addAnnotation(msg.diagramId, msg.annotation);
  } else if (msg.type === "annotation:updated") {
    store.updateAnnotation(msg.diagramId, msg.annotation);
  } else if (msg.type === "annotation:deleted") {
    store.deleteAnnotation(msg.diagramId, msg.annotationId);
  } else if (msg.type === "workspace") {
    store.setCamera(msg.camera);
    store.setTiles(msg.tiles);
  }
}
