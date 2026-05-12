import { create } from "zustand";
import type {
  Annotation, Camera, Diagram, DiagramId, GraphIR, LibraryEntry, Tile,
} from "@prixmaviz/shared";

export type WsStatus = "idle" | "connecting" | "open" | "closed";
export type CanvasMode = "select" | "region" | "pin" | "tag";

export interface AppState {
  // Cycle 4: workspace identity
  workspaceId: string | null;
  workspaceName: string | null;
  setWorkspaceId: (id: string | null) => void;
  setWorkspaceName: (n: string | null) => void;

  // Cycle 4: first-session welcome panel
  welcomeSeen: boolean;
  setWelcomeSeen: (v: boolean) => void;

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

  // Cycle 2.plus: camera + tiles
  camera: Camera;
  tiles: Tile[];
  setCamera: (c: Camera) => void;
  setTiles: (t: Tile[]) => void;
  upsertTile: (t: Tile) => void;
  removeTile: (id: string) => void;

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
  workspaceId: null,
  workspaceName: null,
  setWorkspaceId: (workspaceId) => set({ workspaceId }),
  setWorkspaceName: (workspaceName) => set({ workspaceName }),

  welcomeSeen:
    typeof localStorage !== "undefined" &&
    localStorage.getItem("prixmaviz_welcome_seen") === "1",
  setWelcomeSeen: (v) => {
    try { localStorage.setItem("prixmaviz_welcome_seen", v ? "1" : "0"); } catch {}
    set({ welcomeSeen: v });
  },

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
    set((s) => {
      const existing = s.annotations[id] ?? [];
      if (existing.some((x) => x.id === a.id)) return s;
      return { annotations: { ...s.annotations, [id]: [...existing, a] } };
    }),
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

  camera: { x: 0, y: 0, zoom: 1 },
  tiles: [],
  setCamera: (c) => set({ camera: c }),
  setTiles: (t) => set({ tiles: t }),
  upsertTile: (t) => set((s) => ({
    tiles: s.tiles.some(x => x.id === t.id)
      ? s.tiles.map(x => x.id === t.id ? t : x)
      : [...s.tiles, t],
  })),
  removeTile: (id) => set((s) => ({ tiles: s.tiles.filter(x => x.id !== id) })),
}));
