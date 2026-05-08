import { useEffect, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api } from "../lib/api";

interface Props {
  diagramId: DiagramId;
  svgRef: React.RefObject<HTMLDivElement | null>;
}

export function AnnotationLayer({ diagramId, svgRef }: Props) {
  const annotations = useAppStore((s) => s.annotations[diagramId] ?? []);
  const setAnnotations = useAppStore((s) => s.setAnnotations);

  // load on mount
  useEffect(() => {
    api.listAnnotations(diagramId)
      .then((list) => setAnnotations(diagramId, list))
      .catch(() => {});
  }, [diagramId, setAnnotations]);

  return (
    <svg className="annotation-layer" xmlns="http://www.w3.org/2000/svg">
      {annotations.map((a) => renderAnnotation(a))}
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
        <text textAnchor="middle" y={3} fontSize={9} fill="white" fontWeight="bold">
          {/* index added by parent if needed; for v1, dot only */}•
        </text>
      </g>
    );
  }
  if (a.kind === "tag" && a.targetNodes && a.targetNodes.length > 0) {
    // Tag rendering: outline the matched node — for v1, show a small badge near the node.
    // Without DOM access here, render a small marker at the first target's position via parent.
    // Fallback: nothing visible (parent passes svgRef for DOM lookup; v2 polish).
    return null;
  }
  return null;
}
