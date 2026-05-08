import { create } from "zustand";
import type {
  Annotation, Diagram, DiagramId, GraphIR, LibraryEntry,
} from "@prixmaviz/shared";

export type WsStatus = "idle" | "connecting" | "open" | "closed";
export type CanvasMode = "select" | "region" | "pin" | "tag";

export interface AppState {
  diagram: Diagram | null;
  svg: string;
  dsl: string;
  library: LibraryEntry[];
  wsStatus: WsStatus;
  error: string | null;
  pending: boolean;

  // Cycle 2: annotations + mode
  annotations: Record<DiagramId, Annotation[]>;
  mode: CanvasMode;

  setDiagram: (d: Diagram | null) => void;
  setRender: (diagramId: DiagramId, svg: string, dsl: string, ir?: GraphIR) => void;
  setLibrary: (entries: LibraryEntry[]) => void;
  setWsStatus: (s: WsStatus) => void;
  setError: (e: string | null) => void;
  setPending: (p: boolean) => void;

  setAnnotations: (id: DiagramId, list: Annotation[]) => void;
  addAnnotation: (id: DiagramId, a: Annotation) => void;
  updateAnnotation: (id: DiagramId, a: Annotation) => void;
  deleteAnnotation: (id: DiagramId, annotationId: string) => void;
  setMode: (m: CanvasMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  diagram: null,
  svg: "",
  dsl: "",
  library: [],
  wsStatus: "idle",
  error: null,
  pending: false,
  annotations: {},
  mode: "select",

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

  setAnnotations: (id, list) =>
    set((s) => ({ annotations: { ...s.annotations, [id]: list } })),
  addAnnotation: (id, a) =>
    set((s) => ({ annotations: { ...s.annotations, [id]: [...(s.annotations[id] ?? []), a] } })),
  updateAnnotation: (id, a) =>
    set((s) => ({
      annotations: {
        ...s.annotations,
        [id]: (s.annotations[id] ?? []).map((x) => (x.id === a.id ? a : x)),
      },
    })),
  deleteAnnotation: (id, annotationId) =>
    set((s) => ({
      annotations: {
        ...s.annotations,
        [id]: (s.annotations[id] ?? []).filter((x) => x.id !== annotationId),
      },
    })),
  setMode: (m) => set({ mode: m }),
}));
