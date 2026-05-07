import type { DiagramEngine, GraphIR } from "@prixmaviz/shared";
import { irToMermaid, type RenderOutput } from "./mermaid";

export type IrRenderer = (ir: GraphIR) => RenderOutput;

const RENDERERS: Partial<Record<DiagramEngine, IrRenderer>> = {
  mermaid: irToMermaid,
};

export function getIrRenderer(engine: DiagramEngine): IrRenderer | null {
  return RENDERERS[engine] ?? null;
}

export function hasIrRenderer(engine: DiagramEngine): boolean {
  return engine in RENDERERS;
}
