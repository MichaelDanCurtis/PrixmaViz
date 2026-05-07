import type { Annotation } from "@prixmaviz/shared";

const annotationsByDiagram = new Map<string, Annotation[]>();

export function addAnnotation(a: Annotation): Annotation[] {
  const list = annotationsByDiagram.get(a.diagramId) ?? [];
  list.push(a);
  annotationsByDiagram.set(a.diagramId, list);
  return list;
}

export function clearAnnotations(diagramId: string): void {
  annotationsByDiagram.delete(diagramId);
}

export function getAnnotations(diagramId: string): Annotation[] {
  return annotationsByDiagram.get(diagramId) ?? [];
}
