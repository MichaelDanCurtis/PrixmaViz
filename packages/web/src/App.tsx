import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DiagramEngine, RenderResponse } from "@prixmaviz/shared";
import { SAMPLES } from "./samples";

type Status = "idle" | "connecting" | "open" | "closed";

const ENGINES: DiagramEngine[] = ["mermaid", "plantuml", "graphviz", "d2", "nomnoml"];

export function App() {
  const [engine, setEngine] = useState<DiagramEngine>("mermaid");
  const [source, setSource] = useState<string>(SAMPLES.mermaid);
  const [result, setResult] = useState<RenderResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [wsStatus, setWsStatus] = useState<Status>("idle");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;
    setWsStatus("connecting");
    ws.onopen = () => setWsStatus("open");
    ws.onclose = () => setWsStatus("closed");
    ws.onerror = () => setWsStatus("closed");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "render") {
          setResult(msg.res);
          setPending(false);
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const render = useCallback(async () => {
    setPending(true);
    const id = crypto.randomUUID();
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, engine, source }),
      });
      const json = (await res.json()) as RenderResponse;
      setResult(json);
    } catch (e) {
      setResult({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPending(false);
    }
  }, [engine, source]);

  useEffect(() => {
    void render();
  }, []);

  const onEngineChange = (next: DiagramEngine) => {
    setEngine(next);
    if (SAMPLES[next]) setSource(SAMPLES[next]);
  };

  const statusClass = useMemo(() => {
    if (wsStatus === "open") return "ok";
    if (wsStatus === "closed") return "err";
    return "";
  }, [wsStatus]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>PrixmaViz</h1>
        <select value={engine} onChange={(e) => onEngineChange(e.target.value as DiagramEngine)}>
          {ENGINES.map((eng) => (
            <option key={eng} value={eng}>
              {eng}
            </option>
          ))}
        </select>
        <button className="primary" onClick={render} disabled={pending}>
          {pending ? "Rendering…" : "Render"}
        </button>
        <div className="spacer" />
        <div className="status">
          <span className={`dot ${statusClass}`} />
          <span>ws · {wsStatus}</span>
        </div>
      </header>
      <div className="workspace">
        <section className="editor">
          <div className="editor-toolbar">
            <span className="status">source · {engine}</span>
          </div>
          <textarea
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void render();
              }
            }}
          />
        </section>
        <section className="viewport">
          <DiagramView result={result} pending={pending} />
        </section>
      </div>
    </div>
  );
}

function DiagramView({ result, pending }: { result: RenderResponse | null; pending: boolean }) {
  if (!result && !pending) return <div className="empty">⌘↵ to render</div>;

  return (
    <AnimatePresence mode="wait">
      {result && result.ok ? (
        <motion.div
          key={result.id}
          className="diagram"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 220, damping: 26 }}
          dangerouslySetInnerHTML={
            result.format === "svg"
              ? { __html: result.data }
              : undefined
          }
        >
          {result.format === "png" ? (
            <img src={`data:image/png;base64,${result.data}`} alt="diagram" />
          ) : null}
        </motion.div>
      ) : result && !result.ok ? (
        <motion.pre
          key={result.id}
          className="error"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {result.error}
        </motion.pre>
      ) : (
        <motion.div
          key="pending"
          className="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          rendering…
        </motion.div>
      )}
    </AnimatePresence>
  );
}
