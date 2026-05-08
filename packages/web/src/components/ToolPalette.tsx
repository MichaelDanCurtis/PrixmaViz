import { useEffect } from "react";
import { useAppStore, type CanvasMode } from "../store";

const TOOLS: { mode: CanvasMode; key: string; label: string; hint: string }[] = [
  { mode: "select", key: "1", label: "Select",  hint: "pan/drag" },
  { mode: "region", key: "2", label: "Region",  hint: "drag a box" },
  { mode: "pin",    key: "3", label: "Pin",     hint: "click to drop" },
  { mode: "tag",    key: "4", label: "Tag",     hint: "click a node" },
];

export function ToolPalette() {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) {
        e.preventDefault();
        setMode(t.mode);
      } else if (e.key === "Escape") {
        setMode("select");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  return (
    <div className="tool-palette">
      {TOOLS.map((t) => (
        <button
          key={t.mode}
          className={`tool ${mode === t.mode ? "active" : ""}`}
          onClick={() => setMode(t.mode)}
          title={`${t.label} (${t.key}) — ${t.hint}`}
        >
          <span className="tool-key">{t.key}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
