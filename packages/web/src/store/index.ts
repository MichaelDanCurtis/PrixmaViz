import { create } from "zustand";
import type { Diagram, DiagramId, GraphIR, LibraryEntry } from "@prixmaviz/shared";

export type WsStatus = "idle" | "connecting" | "open" | "closed";

export interface AppState {
  diagram: Diagram | null;
  svg: string;
  dsl: string;
  library: LibraryEntry[];
  wsStatus: WsStatus;
  error: string | null;
  pending: boolean;

  setDiagram: (d: Diagram | null) => void;
  setRender: (diagramId: DiagramId, svg: string, dsl: string, ir?: GraphIR) => void;
  setLibrary: (entries: LibraryEntry[]) => void;
  setWsStatus: (s: WsStatus) => void;
  setError: (e: string | null) => void;
  setPending: (p: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  diagram: null,
  svg: "",
  dsl: "",
  library: [],
  wsStatus: "idle",
  error: null,
  pending: false,

  setDiagram: (d) => set({ diagram: d, svg: "", dsl: d?.dsl ?? "" }),
  setRender: (id, svg, dsl, ir) =>
    set((s) =>
      s.diagram?.id === id
        ? { svg, dsl, diagram: ir ? { ...s.diagram, ir } : s.diagram }
        : { svg, dsl },
    ),
  setLibrary: (entries) => set({ library: entries }),
  setWsStatus: (status) => set({ wsStatus: status }),
  setError: (error) => set({ error }),
  setPending: (pending) => set({ pending }),
}));
