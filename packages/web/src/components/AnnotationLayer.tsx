import { useEffect, useRef, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { CommentPopup } from "./CommentPopup";

function relativeSvgPos(
  clientX: number,
  clientY: number,
  container: HTMLElement | null
): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  // Find the rendered Mermaid/PlantUML/etc. SVG inside the container
  const renderedSvg = container.querySelector("svg") as SVGSVGElement | null;
  if (!renderedSvg) {
    // Fallback to container-relative if no SVG (annotation overlay still works visually)
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  // Convert viewport coords to SVG viewBox coords via the inverse screen CTM
  const pt = renderedSvg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = renderedSvg.getScreenCTM();
  if (!ctm) {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

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
  const [selected, setSelected] = useState<{ ann: Annotation; anchor: { x: number; y: number } } | null>(null);

  useEffect(() => {
    api.listAnnotations(diagramId)
      .then((list) => setAnnotations(diagramId, list))
      .catch(() => {});
  }, [diagramId, setAnnotations]);

  function onMouseDown(e: React.MouseEvent) {
    if (mode !== "region") return;
    e.preventDefault();
    const p = relativeSvgPos(e.clientX, e.clientY, containerRef.current);
    startRef.current = p;
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (mode !== "region" || !startRef.current) return;
    const p = relativeSvgPos(e.clientX, e.clientY, containerRef.current);
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

  async function onClick(e: React.MouseEvent) {
    if (mode !== "pin" && mode !== "tag") return;
    if (drag) return;  // active drag handles its own commit
    const p = relativeSvgPos(e.clientX, e.clientY, containerRef.current);
    try {
      const created = await api.createAnnotation({
        diagramId,
        kind: mode,
        point: p,
      });
      useAppStore.getState().addAnnotation(diagramId, created);
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <svg
        ref={svgEl}
        className={`annotation-layer ${mode !== "select" ? "active" : ""}`}
        style={{
          pointerEvents:
            mode === "region" || mode === "pin" || mode === "tag" || mode === "select" ? "auto" : "none",
          cursor:
            mode === "region" ? "crosshair" :
            mode === "pin" ? "crosshair" :
            mode === "tag" ? "pointer" : "default",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onMouseLeave={() => { setDrag(null); startRef.current = null; }}
      >
        {annotations.map((a) => {
          const onSelect = (e: React.MouseEvent) => {
            if (mode !== "select") return;
            e.stopPropagation();
            const p = relativeSvgPos(e.clientX, e.clientY, containerRef.current);
            setSelected({ ann: a, anchor: p });
          };
          if (a.kind === "region" && a.bboxPixel) {
            return (
              <rect key={a.id}
                className="pickable"
                x={a.bboxPixel.x} y={a.bboxPixel.y}
                width={a.bboxPixel.w} height={a.bboxPixel.h}
                fill="rgba(247,118,142,0.10)" stroke="#f7768e"
                strokeWidth={2} strokeDasharray="6 4"
                opacity={a.resolvedAt ? 0.3 : 1}
                onClick={onSelect}
              />
            );
          }
          if (a.kind === "pin" && a.point) {
            return (
              <g key={a.id} transform={`translate(${a.point.x}, ${a.point.y})`}
                 className="pickable" onClick={onSelect}>
                <circle r={9} fill="#f7768e" opacity={a.resolvedAt ? 0.3 : 1} />
              </g>
            );
          }
          if (a.kind === "tag") {
            const pt = a.point ?? { x: 0, y: 0 };
            return (
              <g key={a.id} transform={`translate(${pt.x}, ${pt.y})`}
                 className="pickable" onClick={onSelect}>
                <circle r={7} fill="none" stroke="#7aa2f7" strokeWidth={2} strokeDasharray="3 2"
                        opacity={a.resolvedAt ? 0.3 : 1} />
              </g>
            );
          }
          return null;
        })}
        {drag && (
          <rect x={drag.x} y={drag.y} width={drag.w} height={drag.h}
                fill="rgba(247,118,142,0.10)" stroke="#f7768e" strokeWidth={2} strokeDasharray="4 3" />
        )}
      </svg>
      {selected && (
        <CommentPopup
          diagramId={diagramId}
          annotation={selected.ann}
          anchor={selected.anchor}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
