import { useAppStore } from "../store";
import { api, authFetch } from "./api";
import { toastError, toastSuccess } from "./toast";

/**
 * Issue #10 — command palette commands. Each command is a self-contained
 * `{ id, name, run }` object so the palette stays a dumb list renderer; new
 * commands are added by appending here, not by editing the palette UI.
 *
 * `keywords` blends extra text into the fuzzy haystack so e.g. "cheatsheet"
 * still finds "Show shortcuts". `hint` is the trailing accelerator hint
 * shown in the palette row (e.g. "?" or "Cmd K").
 */
export interface PaletteCommand {
  id: string;
  name: string;
  keywords?: string;
  hint?: string;
  run: () => void | Promise<void>;
}

/**
 * Build the static command list. We build it lazily inside a function
 * (rather than as a top-level constant) so the closures grab the latest
 * store getters at invoke time — and so tests can stub the store.
 */
export function buildCommands(): PaletteCommand[] {
  const store = useAppStore;

  // Use `renderDsl` (which both creates a diagram *and* returns the slug)
  // rather than `createDiagram` — the latter's `kind` is constrained to
  // "graph" | "passthrough" so the palette's mermaid kinds (sequence, state,
  // class) don't fit there. `renderDsl` always seeds a passthrough diagram
  // and returns `{ diagramId, slug }`, which is what we need to create a
  // tile.
  async function createDiagram(kind: "graph" | "sequence" | "state" | "class") {
    const seedDsl: Record<typeof kind, string> = {
      graph: "graph LR\n  A[Start] --> B[End]",
      sequence: "sequenceDiagram\n  Alice->>Bob: Hello",
      state: "stateDiagram-v2\n  [*] --> Idle",
      class: "classDiagram\n  class Foo { +bar() }",
    };
    try {
      const created = await api.renderDsl({
        engine: "mermaid",
        source: seedDsl[kind],
        name: `Untitled ${kind}`,
      }) as { diagramId: string; slug: string; render: { svg: string; dsl: string } };
      // Drop a tile near the current camera so the user sees the new diagram.
      const cam = store.getState().camera;
      await api.createTile({
        diagramId: created.diagramId,
        diagramSlug: created.slug,
        x: cam.x + 60,
        y: cam.y + 60,
        w: 600,
        h: 400,
      });
      toastSuccess(`Created ${kind} diagram`);
    } catch (e) {
      toastError(`Create diagram failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function exportFocused(format: "svg" | "png" | "jpeg") {
    const tiles = store.getState().tiles;
    const focusedId = store.getState().focusedTileId;
    const focused = tiles.find((t) => t.id === focusedId) ?? tiles[tiles.length - 1];
    if (!focused) {
      toastError("No tile to export");
      return;
    }
    // The actual download is implemented inside ./export — lazy-loaded so the
    // palette payload stays minimal. authFetch is a static import here to
    // avoid a duplicated dynamic-import chunk per Rollup's warning.
    import("./export")
      .then(async ({ downloadDiagramAs }) => {
        const r = await authFetch(`/api/library/${encodeURIComponent(focused.diagramSlug)}/thumb`);
        const svg = r.ok ? await r.text() : "";
        if (!svg) {
          toastError("Export failed: could not fetch SVG");
          return;
        }
        await downloadDiagramAs(focused.diagramId, focused.diagramSlug, format, svg);
      })
      .catch((e) => toastError(`Export failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  return [
    {
      id: "create.mermaid.graph",
      name: "Create diagram (mermaid graph)",
      keywords: "new flowchart mermaid",
      run: () => createDiagram("graph"),
    },
    {
      id: "create.mermaid.sequence",
      name: "Create diagram (sequence)",
      keywords: "new mermaid sequence",
      run: () => createDiagram("sequence"),
    },
    {
      id: "create.mermaid.state",
      name: "Create diagram (state)",
      keywords: "new mermaid state machine",
      run: () => createDiagram("state"),
    },
    {
      id: "create.mermaid.class",
      name: "Create diagram (class)",
      keywords: "new mermaid class uml",
      run: () => createDiagram("class"),
    },
    {
      id: "export.svg",
      name: "Export focused tile as SVG",
      keywords: "download save image",
      run: () => exportFocused("svg"),
    },
    {
      id: "export.png",
      name: "Export focused tile as PNG",
      keywords: "download save image bitmap",
      run: () => exportFocused("png"),
    },
    {
      id: "export.jpeg",
      name: "Export focused tile as JPEG",
      keywords: "download save image",
      run: () => exportFocused("jpeg"),
    },
    {
      id: "toggle.snap",
      name: "Toggle snap-to-grid",
      keywords: "grid align snap",
      hint: "G",
      run: () => {
        const next = !store.getState().snapEnabled;
        store.getState().setSnapEnabled(next);
        toastSuccess(`Snap-to-grid ${next ? "enabled" : "disabled"}`);
      },
    },
    {
      id: "toggle.minimap",
      name: "Toggle minimap",
      keywords: "overview map navigator",
      hint: "M",
      run: () => {
        const next = !store.getState().minimapVisible;
        store.getState().setMinimapVisible(next);
      },
    },
    {
      id: "help.shortcuts",
      name: "Show shortcuts",
      keywords: "help cheatsheet keyboard ?",
      hint: "?",
      run: () => {
        store.getState().setShortcutsHelpOpen(true);
      },
    },
    {
      id: "view.reset-zoom",
      name: "Reset zoom",
      keywords: "fit center camera",
      run: () => {
        const cam = store.getState().camera;
        store.getState().setCamera({ x: cam.x, y: cam.y, zoom: 1 });
        api.setCamera({ x: cam.x, y: cam.y, zoom: 1 }).catch(() => {});
      },
    },
  ];
}
