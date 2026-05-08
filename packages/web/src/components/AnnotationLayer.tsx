import { useEffect, useRef, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api } from "../lib/api";

interface Props {
  diagramId: DiagramId;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface DragRect { x: number; y: number; w: number; h: number; }

export function AnnotationLayer({ diagramId, containerRef }: Props) {
  const annotations = useAppStore((s) => s.annotations[diagramId] ?? []);
  const setAnnotations = useAppStore((s) => s.setAnnotations);
  const mode = useAppStore((s) => s.mode);
  const svgEl = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    api.listAnnotations(diagramId)
      .then((list) => setAnnotations(diagramId, list))
      .catch(() => {});
  }, [diagramId, setAnnotations]);

  function relativePos(e: React.MouseEvent): { x: number; y: number } {
    const c = containerRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (mode !== "region") return;
    e.preventDefault();
    const p = relativePos(e);
    startRef.current = p;
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (mode !== "region" || !startRef.current) return;
    const p = relativePos(e);
    const s = startRef.current;
    setDrag({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }

  async function onMouseUp() {
    if (mode !== "region" || !drag) return;
    const final = drag;
    setDrag(null);
    startRef.current = null;
    if (final.w < 4 || final.h < 4) return;  // ignore tiny accidents
    try {
      const created = await api.createAnnotation({
        diagramId,
        kind: "region",
        bboxPixel: final,
      });
      // store add happens via WS broadcast; if WS not delivered yet, eager-add:
      useAppStore.getState().addAnnotation(diagramId, created);
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <svg
      ref={svgEl}
      className={`annotation-layer ${mode !== "select" ? "active" : ""}`}
      style={{ pointerEvents: mode === "region" ? "auto" : "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { setDrag(null); startRef.current = null; }}
    >
      {annotations.map((a) => renderAnnotation(a))}
      {drag && (
        <rect x={drag.x} y={drag.y} width={drag.w} height={drag.h}
              fill="rgba(247,118,142,0.10)" stroke="#f7768e" strokeWidth={2} strokeDasharray="4 3" />
      )}
    </svg>
  );
}

function renderAnnotation(a: Annotation): React.ReactNode {
  if (a.kind === "region" && a.bboxPixel) {
    return (
      <g key={a.id}>
        <rect
          x={a.bboxPixel.x}
          y={a.bboxPixel.y}
          width={a.bboxPixel.w}
          height={a.bboxPixel.h}
          fill="rgba(247,118,142,0.10)"
          stroke="#f7768e"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={a.resolvedAt ? 0.3 : 1}
        />
      </g>
    );
  }
  if (a.kind === "pin" && a.point) {
    return (
      <g key={a.id} transform={`translate(${a.point.x}, ${a.point.y})`}>
        <circle r={9} fill="#f7768e" opacity={a.resolvedAt ? 0.3 : 1} />
      </g>
    );
  }
  return null;
}
