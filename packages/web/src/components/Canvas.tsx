import { useRef } from "react";
import { useAppStore } from "../store";
import { DiagramView } from "./DiagramView";
import { EmptyState } from "./EmptyState";
import { ErrorPanel } from "./ErrorPanel";
import { AnnotationLayer } from "./AnnotationLayer";

export function Canvas() {
  const diagram = useAppStore((s) => s.diagram);
  const svg = useAppStore((s) => s.svg);
  const error = useAppStore((s) => s.error);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <section className="viewport">
      {error && <ErrorPanel message={error} />}
      {!diagram && !svg && <EmptyState />}
      {diagram && svg && (
        <div className="diagram-host" ref={containerRef} style={{ position: "relative" }}>
          <DiagramView diagramId={diagram.id} svg={svg} />
          <AnnotationLayer diagramId={diagram.id} containerRef={containerRef} />
        </div>
      )}
    </section>
  );
}
