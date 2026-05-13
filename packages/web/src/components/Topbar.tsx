import { useState } from "react";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { ALL_ENGINES } from "@prixmaviz/shared";
import { ToolPalette } from "./ToolPalette";

interface TopbarProps { onOpenSettings?: () => void; }

export function Topbar({ onOpenSettings }: TopbarProps = {}) {
  const diagram = useAppStore((s) => s.diagram);
  const wsStatus = useAppStore((s) => s.wsStatus);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const dot =
    wsStatus === "open" ? "ok" :
    wsStatus === "closed" ? "err" :
    "";

  async function onTopbarExport(format: "svg" | "png" | "jpeg") {
    setExportMenuOpen(false);
    // Find the most-recently-focused tile via the workspace API
    const w = await api.getWorkspace().catch(() => null);
    if (!w || w.tiles.length === 0) return;
    // Server orders by last-focused (recently interacted last); use the last entry
    const focused = w.tiles[w.tiles.length - 1];
    if (!focused) return;
    // Fetch the SVG via the thumb endpoint
    const svgResp = await fetch(`/api/library/${encodeURIComponent(focused.diagramSlug)}/thumb`);
    if (!svgResp.ok) return;
    const svg = await svgResp.text();
    const { svgToBlob, getExportFilename } = await import("../lib/export");
    const blob = await svgToBlob(svg, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getExportFilename(focused.diagramSlug, format);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <header className="topbar">
      <h1>PrixmaViz</h1>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {diagram ? `${diagram.engine} · ${diagram.kind}` : "no diagram"}
      </span>
      <ToolPalette />
      <div className="spacer" />
      <div style={{ position: "relative", display: "inline-block" }}>
        <button className="topbar-button" onClick={() => setExportMenuOpen((v) => !v)} title="Export focused tile">⬇ Export</button>
        {exportMenuOpen && (
          <div className="tile-export-menu" style={{ top: 32 }}>
            <button onClick={() => onTopbarExport("svg")}>Download as SVG</button>
            <button onClick={() => onTopbarExport("png")}>Download as PNG</button>
            <button onClick={() => onTopbarExport("jpeg")}>Download as JPEG</button>
          </div>
        )}
      </div>
      <button className="topbar-button" onClick={onOpenSettings} title="Settings">⚙ Settings</button>
      <div className="status">
        <span className={`dot ${dot}`} />
        <span>ws · {wsStatus}</span>
      </div>
    </header>
  );
}
