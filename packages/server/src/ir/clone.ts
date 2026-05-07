import type { GraphIR } from "@prixmaviz/shared";

export function cloneIR(ir: GraphIR): GraphIR {
  return structuredClone(ir);
}
