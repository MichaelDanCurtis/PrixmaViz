import { useEffect } from "react";
import { useAppStore } from "../store";
import { api } from "./api";
import type { ServerToClient } from "@prixmaviz/shared";

export function useWebSocket(): void {
  const setWsStatus = useAppStore((s) => s.setWsStatus);
  const workspaceId = useAppStore((s) => s.workspaceId);

  useEffect(() => {
    // Wait for bootstrap. Cycle 4 server doesn't yet enforce WS auth (see TODO
    // in server/src/index.ts), but the client still includes the workspace ID
    // as a `?token=` query param so the future auth layer can find it.
    if (!workspaceId) return;

    let ws: WebSocket | null = null;
    let reconnectDelay = 1000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const token = encodeURIComponent(workspaceId!);
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
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
  }, [setWsStatus, workspaceId]);
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
  } else if (
    msg.type === "library:diagram-updated" ||
    msg.type === "library:diagram-opened" ||
    msg.type === "library:folders-changed" ||
    msg.type === "library:tags-changed"
  ) {
    // Issue #7 Wave 2C: any folder/pin/meta/recent change from another
    // tab re-fetches the library so the local state stays consistent.
    // The server always sends a full library snapshot via the existing
    // "library" event when it has one — these are notification-only.
    api
      .library()
      .then(store.setLibrary)
      .catch(() => {});
  }
}
