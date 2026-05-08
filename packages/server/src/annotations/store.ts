import type { Annotation, DiagramId } from "@prixmaviz/shared";

export class AnnotationStore {
  private byDiagram = new Map<DiagramId, Map<string, Annotation>>();

  add(diagramId: DiagramId, a: Annotation): void {
    let m = this.byDiagram.get(diagramId);
    if (!m) {
      m = new Map();
      this.byDiagram.set(diagramId, m);
    }
    m.set(a.id, a);
  }

  update(diagramId: DiagramId, annotationId: string, patch: Partial<Annotation>): Annotation {
    const m = this.byDiagram.get(diagramId);
    const existing = m?.get(annotationId);
    if (!existing) throw new Error(`annotation "${annotationId}" not found in diagram "${diagramId}"`);
    const next = { ...existing, ...patch, id: annotationId };
    m!.set(annotationId, next);
    return next;
  }

  delete(diagramId: DiagramId, annotationId: string): void {
    this.byDiagram.get(diagramId)?.delete(annotationId);
  }

  listByDiagram(diagramId: DiagramId): Annotation[] {
    const m = this.byDiagram.get(diagramId);
    return m ? Array.from(m.values()) : [];
  }

  loadFromDiagram(diagramId: DiagramId, annotations: Annotation[]): void {
    const m = new Map<string, Annotation>();
    for (const a of annotations) m.set(a.id, a);
    this.byDiagram.set(diagramId, m);
  }

  clear(diagramId: DiagramId): void {
    this.byDiagram.delete(diagramId);
  }
}
