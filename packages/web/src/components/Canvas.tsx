import { useAppStore } from "../store";
import { DiagramView } from "./DiagramView";
import { EmptyState } from "./EmptyState";
import { ErrorPanel } from "./ErrorPanel";

export function Canvas() {
  const diagram = useAppStore((s) => s.diagram);
  const svg = useAppStore((s) => s.svg);
  const error = useAppStore((s) => s.error);

  return (
    <section className="viewport">
      {error && <ErrorPanel message={error} />}
      {!diagram && !svg && <EmptyState />}
      {diagram && svg && <DiagramView diagramId={diagram.id} svg={svg} />}
    </section>
  );
}
