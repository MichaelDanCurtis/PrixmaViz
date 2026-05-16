import { create } from "zustand";
import type {
  Annotation, Camera, Diagram, DiagramId, GraphIR, LibraryEntry, Tile,
} from "@prixmaviz/shared";

export type WsStatus = "idle" | "connecting" | "open" | "closed";
export type CanvasMode = "select" | "region" | "pin" | "tag";

// Issue #4: client-side sort keys for the Library sidebar. Persisted to
// localStorage so the user's choice survives reload. "updated" matches the
// server's default ORDER BY updated_at DESC.
export type LibrarySortKey =
  | "updated"
  | "created"
  | "name-asc"
  | "name-desc"
  | "engine";

const LIBRARY_SORT_KEYS: readonly LibrarySortKey[] = [
  "updated",
  "created",
  "name-asc",
  "name-desc",
  "engine",
];

const LIBRARY_SORT_STORAGE_KEY = "prixmaviz_library_sort";

function readPersistedSortKey(): LibrarySortKey {
  if (typeof localStorage === "undefined") return "updated";
  try {
    const raw = localStorage.getItem(LIBRARY_SORT_STORAGE_KEY);
    if (raw && (LIBRARY_SORT_KEYS as readonly string[]).includes(raw)) {
      return raw as LibrarySortKey;
    }
  } catch {}
  return "updated";
}

/**
 * Issue #4: client-side comparator for the Library sort dropdown. Pure;
 * exported so tests can pin behavior without rendering the component.
 *
 * Sorts are stable for equal keys because [...arr].sort() in modern engines
 * is spec-stable (Array.prototype.sort, ECMA-262 §23.1.3.30).
 */
export function compareLibraryEntries(
  a: LibraryEntry,
  b: LibraryEntry,
  key: LibrarySortKey,
): number {
  switch (key) {
    case "updated":
      return b.updatedAt.localeCompare(a.updatedAt);
    case "created":
      return b.createdAt.localeCompare(a.createdAt);
    case "name-asc":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "name-desc":
      return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
    case "engine": {
      const e = a.engine.localeCompare(b.engine);
      if (e !== 0) return e;
      // Stable within engine: most recently updated first.
      return b.updatedAt.localeCompare(a.updatedAt);
    }
  }
}

export const LIBRARY_SORT_LABELS: Record<LibrarySortKey, string> = {
  updated: "Recently updated",
  created: "Recently created",
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  engine: "By engine",
};

// Issue #7 Wave 2C: persisted set of folder paths that are open in the
// Library tree. We persist so the user's last expansion state survives
// reload. The empty-string key never appears in the set (workspace root
// is implicit).
const EXPANDED_FOLDERS_STORAGE_KEY = "prixmaviz_expanded_folders";

function readPersistedExpandedFolders(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string" && v.length > 0));
  } catch {
    return new Set();
  }
}

function persistExpandedFolders(set: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EXPANDED_FOLDERS_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

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
  // Issue #4: Library sidebar sort key, persisted to localStorage.
  librarySortKey: LibrarySortKey;
  setLibrarySortKey: (k: LibrarySortKey) => void;
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

  // Issue #3: transient "just got focused" highlight on Library re-open.
  // Tile.tsx reads this and adds the `.tile-just-focused` class; cleared
  // ~1500ms later by Library.tsx::focusExistingTile.
  recentlyFocusedTileId: string | null;
  setRecentlyFocusedTileId: (id: string | null) => void;

  // Issue #2: Library bulk-select mode + selection set keyed by diagram slug.
  selectMode: boolean;
  selectedSlugs: Set<string>;
  lastSelectedSlug: string | null;
  setSelectMode: (v: boolean) => void;
  toggleSelected: (slug: string) => void;
  selectRange: (slugs: string[], fromSlug: string, toSlug: string) => void;
  selectAll: (slugs: string[]) => void;
  clearSelection: () => void;

  // Issue #7 Wave 2C: folder tree state for the Library sidebar.
  //
  // expandedFolderPaths — set of folder paths whose subtree is currently
  // visible in the tree. Persisted to localStorage so the user's last
  // expansion state survives reload.
  //
  // selectedFolderPath — currently focused folder. Empty string = no
  // folder selected (workspace root / all). When non-empty, the All
  // section of the Library is scoped to diagrams under that prefix.
  expandedFolderPaths: Set<string>;
  selectedFolderPath: string;
  toggleFolderExpanded: (path: string) => void;
  setSelectedFolderPath: (path: string) => void;

  // Issue #10: canvas UX. Snap-to-grid + keyboard focus + floating surfaces.
  snapEnabled: boolean;
  setSnapEnabled: (v: boolean) => void;
  focusedTileId: string | null;
  setFocusedTileId: (id: string | null) => void;
  minimapVisible: boolean;
  setMinimapVisible: (v: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (v: boolean) => void;

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
  librarySortKey: readPersistedSortKey(),
  setLibrarySortKey: (k) => {
    try { localStorage.setItem(LIBRARY_SORT_STORAGE_KEY, k); } catch {}
    set({ librarySortKey: k });
  },
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

  recentlyFocusedTileId: null,
  setRecentlyFocusedTileId: (id) => set({ recentlyFocusedTileId: id }),

  selectMode: false,
  selectedSlugs: new Set<string>(),
  lastSelectedSlug: null,
  setSelectMode: (v) =>
    set(() => (v
      ? { selectMode: true }
      : { selectMode: false, selectedSlugs: new Set<string>(), lastSelectedSlug: null })),
  toggleSelected: (slug) =>
    set((s) => {
      const next = new Set(s.selectedSlugs);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { selectedSlugs: next, lastSelectedSlug: slug };
    }),
  selectRange: (slugs, fromSlug, toSlug) =>
    set((s) => {
      const fromIdx = slugs.indexOf(fromSlug);
      const toIdx = slugs.indexOf(toSlug);
      if (fromIdx === -1 || toIdx === -1) {
        const next = new Set(s.selectedSlugs);
        if (next.has(toSlug)) next.delete(toSlug);
        else next.add(toSlug);
        return { selectedSlugs: next, lastSelectedSlug: toSlug };
      }
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      const next = new Set(s.selectedSlugs);
      for (let i = lo; i <= hi; i++) next.add(slugs[i]!);
      return { selectedSlugs: next, lastSelectedSlug: toSlug };
    }),
  selectAll: (slugs) =>
    set(() => ({ selectedSlugs: new Set(slugs), lastSelectedSlug: slugs[slugs.length - 1] ?? null })),
  clearSelection: () => set({ selectedSlugs: new Set<string>(), lastSelectedSlug: null }),

  // Issue #7 Wave 2C — folder tree.
  expandedFolderPaths: readPersistedExpandedFolders(),
  selectedFolderPath: "",
  toggleFolderExpanded: (path) =>
    set((s) => {
      if (!path) return s; // root is implicit, never toggled
      const next = new Set(s.expandedFolderPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      persistExpandedFolders(next);
      return { expandedFolderPaths: next };
    }),
  setSelectedFolderPath: (path) => set({ selectedFolderPath: path }),

  // Issue #10
  snapEnabled:
    typeof localStorage !== "undefined"
      ? localStorage.getItem("prixmaviz_snap_enabled") !== "0"
      : true,
  setSnapEnabled: (v) => {
    try { localStorage.setItem("prixmaviz_snap_enabled", v ? "1" : "0"); } catch {}
    set({ snapEnabled: v });
  },
  focusedTileId: null,
  setFocusedTileId: (id) => set({ focusedTileId: id }),
  minimapVisible:
    typeof localStorage !== "undefined"
      ? localStorage.getItem("prixmaviz_minimap_visible") !== "0"
      : true,
  setMinimapVisible: (v) => {
    try { localStorage.setItem("prixmaviz_minimap_visible", v ? "1" : "0"); } catch {}
    set({ minimapVisible: v });
  },
  commandPaletteOpen: false,
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  shortcutsHelpOpen: false,
  setShortcutsHelpOpen: (v) => set({ shortcutsHelpOpen: v }),
}));
