import type { Diagram, DiagramId } from "@prixmaviz/shared";

export class DiagramStore {
  private map = new Map<DiagramId, Diagram>();
  private svgCache = new Map<DiagramId, string>();

  put(d: Diagram): void {
    this.map.set(d.id, d);
  }

  get(id: DiagramId): Diagram | undefined {
    return this.map.get(id);
  }

  delete(id: DiagramId): void {
    this.map.delete(id);
    this.svgCache.delete(id);
  }

  list(): Diagram[] {
    return Array.from(this.map.values());
  }

  touch(id: DiagramId): void {
    const d = this.map.get(id);
    if (!d) return;
    d.meta.updatedAt = new Date().toISOString();
  }

  setSvg(id: DiagramId, svg: string): void {
    this.svgCache.set(id, svg);
  }

  getSvg(id: DiagramId): string | undefined {
    return this.svgCache.get(id);
  }
}

export function newDiagramId(): DiagramId {
  return `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
