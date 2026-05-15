import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { Tile } from "./Tile";
import { EmptyStateCards } from "./EmptyStateCards";
import { api, authFetch } from "../lib/api";
import { clampCamera } from "@prixmaviz/shared";

const DEFAULT_PROMO_CARDS: Array<{ name: string; href: string; tagline: string }> = [];

export function InfiniteCanvas() {
  const camera = useAppStore((s) => s.camera);
  const tiles = useAppStore((s) => s.tiles);
  const setCamera = useAppStore((s) => s.setCamera);
  const setTiles = useAppStore((s) => s.setTiles);
  const mode = useAppStore((s) => s.mode);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
  const [vsdxDragOver, setVsdxDragOver] = useState(false);

  function handleVsdxDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.items).some((it) => it.kind === "file")) {
      e.preventDefault();
      setVsdxDragOver(true);
    }
  }

  function handleVsdxDragLeave() {
    setVsdxDragOver(false);
  }

  async function handleVsdxDrop(e: React.DragEvent) {
    e.preventDefault();
    setVsdxDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const vsdx = files.find((f) => f.name.toLowerCase().endsWith(".vsdx"));
    if (!vsdx) return;

    const fd = new FormData();
    fd.set("file", vsdx);
    fd.set("name", vsdx.name.replace(/\.vsdx$/i, ""));
    try {
      const res = await authFetch("/api/import", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "import failed" }));
        alert(`Visio import failed: ${(err as { error?: string }).error ?? "unknown error"}`);
        return;
      }
      // Server broadcasts the new diagram via WS — the canvas picks it up.
    } catch (err) {
      alert(`Visio import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Load workspace on mount
  useEffect(() => {
    api.getWorkspace()
      .then((w) => { setCamera(w.camera); setTiles(w.tiles); })
      .catch(() => {});
  }, [setCamera, setTiles]);

  function onMouseDown(e: React.MouseEvent) {
    if (mode !== "select") return;
    if (!(e.target as HTMLElement).classList.contains("infinite-canvas-bg")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / camera.zoom;
    const dy = (e.clientY - dragRef.current.startY) / camera.zoom;
    const nc = clampCamera({ x: dragRef.current.camX - dx, y: dragRef.current.camY - dy, zoom: camera.zoom });
    setCamera(nc);
  }
  async function onMouseUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    await api.setCamera(camera);
  }

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;  // require modifier for zoom
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.01);
    const newZoom = clampCamera({ ...camera, zoom: camera.zoom * factor }).zoom;
    // anchor zoom on cursor
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const wx = cx / camera.zoom + camera.x;
    const wy = cy / camera.zoom + camera.y;
    const nc = clampCamera({
      x: wx - cx / newZoom,
      y: wy - cy / newZoom,
      zoom: newZoom,
    });
    setCamera(nc);
  }

  return (
    <div
      ref={containerRef}
      className={`infinite-canvas${vsdxDragOver ? " drag-over" : ""}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { dragRef.current = null; }}
      onWheel={onWheel}
      onDragOver={handleVsdxDragOver}
      onDragLeave={handleVsdxDragLeave}
      onDrop={handleVsdxDrop}
    >
      <div className="infinite-canvas-bg" />
      {vsdxDragOver && (
        <div className="drop-overlay">Drop .vsdx to import</div>
      )}
      {tiles.length === 0 && (
        <div className="infinite-canvas-empty">
          <div className="infinite-canvas-empty-headline">
            <h2>No diagrams yet</h2>
            <p>
              Ask your AI assistant to render a diagram, or open one from the
              library on the left.
            </p>
          </div>
          <EmptyStateCards cards={DEFAULT_PROMO_CARDS} />
        </div>
      )}
      <div
        className="canvas-plane"
        style={{
          transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`,
        }}
      >
        {tiles.map((t) => <Tile key={t.id} tile={t} />)}
      </div>
    </div>
  );
}
