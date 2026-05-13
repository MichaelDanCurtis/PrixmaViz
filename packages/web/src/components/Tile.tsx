import { useEffect, useRef, useState } from "react";
import type { Tile as TileT } from "@prixmaviz/shared";
import { SNAP_GRID } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api, authFetch } from "../lib/api";
import { DiagramView } from "./DiagramView";
import { AnnotationLayer } from "./AnnotationLayer";
import { PublicViewToggle } from "./PublicViewToggle";

interface Props { tile: TileT; }

export function Tile({ tile }: Props) {
  const setTiles = useAppStore((s) => s.setTiles);
  const tiles = useAppStore((s) => s.tiles);
  const camera = useAppStore((s) => s.camera);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  async function onExport(format: "svg" | "png" | "jpeg") {
    setExportMenuOpen(false);
    if (!svg) return;
    const { svgToBlob, getExportFilename } = await import("../lib/export");
    const blob = await svgToBlob(svg, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getExportFilename(tile.diagramSlug, format);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Fetch the tile's SVG (load by slug). v1: use library/thumb endpoint
  // NOTE: must go through authFetch — `/api/library/<slug>/thumb` requires
  // `Authorization: Bearer <workspaceId>`. Raw fetch() omits the header and
  // returns 401 → svg="" → tile body renders as blank white (the tile's own
  // background bleeds through because DiagramView never mounts). This was the
  // "blank tile after deep-link" bug.
  useEffect(() => {
    let stop = false;
    authFetch(`/api/library/${encodeURIComponent(tile.diagramSlug)}/thumb`)
      .then(r => r.ok ? r.text() : "")
      .then(s => { if (!stop) setSvg(s); });
    return () => { stop = true; };
  }, [tile.diagramSlug]);

  function snap(n: number): number {
    return Math.round(n / SNAP_GRID) * SNAP_GRID;
  }

  function onHeaderDown(e: React.MouseEvent) {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startTileX = tile.x, startTileY = tile.y;
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / camera.zoom;
      const dy = (ev.clientY - startY) / camera.zoom;
      const newX = ev.altKey ? startTileX + dx : snap(startTileX + dx);
      const newY = ev.altKey ? startTileY + dy : snap(startTileY + dy);
      setTiles(tiles.map(t => t.id === tile.id ? { ...t, x: newX, y: newY } : t));
    }
    async function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const latest = useAppStore.getState().tiles.find(t => t.id === tile.id);
      if (latest) await api.patchTile(tile.id, { x: latest.x, y: latest.y });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onResizeDown(e: React.MouseEvent) {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = tile.w, startH = tile.h;
    function onMove(ev: MouseEvent) {
      const dw = (ev.clientX - startX) / camera.zoom;
      const dh = (ev.clientY - startY) / camera.zoom;
      const newW = Math.max(120, snap(startW + dw));
      const newH = Math.max(80, snap(startH + dh));
      setTiles(useAppStore.getState().tiles.map(t => t.id === tile.id ? { ...t, w: newW, h: newH } : t));
    }
    async function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const latest = useAppStore.getState().tiles.find(t => t.id === tile.id);
      if (latest) await api.patchTile(tile.id, { w: latest.w, h: latest.h });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function onClose() {
    await api.deleteTile(tile.id);
  }

  return (
    <div
      ref={containerRef}
      className="tile"
      style={{
        position: "absolute", left: tile.x, top: tile.y,
        width: tile.w, height: tile.h, zIndex: tile.z,
      }}
    >
      <div className="tile-header" onMouseDown={onHeaderDown}>
        <span className="tile-name">{tile.diagramSlug}</span>
        <PublicViewToggle diagramId={tile.diagramId} />
        <div className="tile-export-wrapper">
          <button
            className="tile-export"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setExportMenuOpen((v) => !v); }}
            title="Export"
          >
            ⬇ ▾
          </button>
          {exportMenuOpen && (
            <div className="tile-export-menu" onMouseDown={(e) => e.stopPropagation()}>
              <button onClick={() => onExport("svg")}>Download as SVG</button>
              <button onClick={() => onExport("png")}>Download as PNG</button>
              <button onClick={() => onExport("jpeg")}>Download as JPEG</button>
            </div>
          )}
        </div>
        <button className="tile-close" onClick={onClose}>×</button>
      </div>
      <div className="tile-body">
        {svg && <DiagramView diagramId={tile.diagramId} svg={svg} />}
        <AnnotationLayer diagramId={tile.diagramId} containerRef={containerRef} />
      </div>
      <div className="tile-resize" onMouseDown={onResizeDown} />
    </div>
  );
}
