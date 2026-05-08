# PrixmaViz — Cycle 2.plus (v2) Design

**Date:** 2026-05-07
**Status:** approved (brainstorming) — pending implementation plan
**Cycle:** 2.plus of 4 (Voice + Workspace + Real-Install)

## Problem

Cycle 1 shipped: AI agents create diagrams via 6 MCP tools, library persists across sessions, single-canvas Tauri shell. Tire-kicking proved the architecture handles far more than diagrams — Mandelbrot fractals, Game of Life simulations, Lorenz attractors, rotating cubes, real-data charts, hardware timing traces, math equations. The "diagram tool" frame is too narrow; it's a structured-data-to-SVG canvas with AI integration.

But three gaps remain between "neat prototype" and "thing people use":
1. **No bidirectional loop** — AI emits diagrams, user sees them, user can't talk back through the diagram
2. **One-at-a-time canvas** — user can't compare diagrams side by side or watch AI evolve a workspace
3. **No real install path** — MCP plugin is theoretical; no clean way for a real user to wire PrixmaViz into Claude Code

Cycle 2.plus closes all three. Combines the original Cycle 2 (annotations) with the deferred Cycle 1.5 (multi-canvas) plus distribution polish.

## Scope: Cycle 2.plus

This document specifies **Cycle 2.plus**. Cycles 3-4 placeholders unchanged from Cycle 1 spec (`docs/superpowers/specs/2026-05-06-prixmaviz-cycle-1-design.md`).

| Cycle | Theme | Status |
|---|---|---|
| 1 — Foundation | AI paints diagrams that persist | shipped |
| **2.plus — Voice + Workspace + Install** *(this doc)* | Bidirectional loop, infinite canvas, real distribution | this design |
| 3 — Tether | Code-tethered diagrams (auto-regen from source) | placeholder |
| 4 — Hosts | Codex pane, VSCode extension, browser-standalone | placeholder |

## Goals

1. User can annotate any diagram via three primitives: tag (click), region (drag), pin (point + comment)
2. Annotations persist with the diagram, broadcast across tiles showing the same diagram
3. Server-side hit-test enriches annotations with engine-aware structure (graph node IDs, chart data ranges, point coordinates)
4. AI calls `get_annotations(diagramId)` to receive enriched annotations as context
5. User can open multiple diagrams as draggable, resizable tiles on an infinite canvas with pan + zoom
6. AI calls `update_tile`, `set_view` to programmatically arrange the workspace
7. Workspace state (camera + tiles) persists across launches in `.prixmaviz/workspace.json`
8. Real install: Tauri app first-launch writes MCP config entry into Claude Code; standalone install via brew + curl script
9. Real-AI smoke acceptance: install on clean machine, drive annotation + canvas via Claude Code, full loop verified

## Non-Goals

- **Freehand stroke annotations** — beautiful, deferred to Cycle 3
- **Tab + split layouts** — chose infinite canvas; tabs explicit non-goal
- **AI creating annotations** — annotations are user voice; AI uses `apply_patch` or chat for its output
- **Annotation threading / replies** — single comment per annotation; threads later
- **Annotation export** (markdown, PDF) — screenshot for now
- **Codex pane / VSCode extension hosts** — Cycle 4 territory
- **Code-tethered diagrams** — Cycle 3 territory
- **Cloud sync / multi-user editing** — not on roadmap
- **Real-time AI annotation suggestions** ("AI thinks user might want to circle this") — out of scope

## Architecture

Extends Cycle 1's Bun + Tauri + 6-tool MCP without breaking changes.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tauri shell                                                            │
│                                                                        │
│   ┌──────────────────────────────────┐  ┌────────────────────────────┐ │
│   │ Webview (React + motion)         │◄─┤ Bun sidecar               │ │
│   │                                   │  │                            │ │
│   │  InfiniteCanvas                   │  │  HTTP / WS / static        │ │
│   │   ├ Camera (pan, zoom)            │  │  Graph IR engine           │ │
│   │   ├ Tile (drag, resize)           │  │  Kroki client (LRU)        │ │
│   │   │  ├ DiagramView (Cycle 1)      │  │  .pviz I/O                 │ │
│   │   │  └ AnnotationLayer (NEW)      │  │  Workspace store (NEW)     │ │
│   │   └ ToolPalette (mode switcher)   │  │  Annotation store (NEW)    │ │
│   │  Library sidebar (Cycle 1)        │  │  Hit-test family (NEW)     │ │
│   │                                   │  │  MCP stdio entry — 10 tools│ │
│   └──────────────────────────────────┘  └────────────────────────────┘ │
│                                                                        │
└────────────┬───────────────────────────────────────┬───────────────────┘
             │                                       │
             │ MCP stdio (JSON-RPC)                  │ HTTPS
             ▼                                       ▼
     ┌────────────────┐                     ┌────────────────┐
     │ Claude Code    │                     │ Kroki          │
     │ (or other host)│                     │ (engines)      │
     └────────────────┘                     └────────────────┘

         File system (per project):
         <project>/.prixmaviz/diagrams/*.pviz   — diagram + annotations
         <project>/.prixmaviz/workspace.json    — camera + tiles
         <project>/.prixmaviz/cache/            — Kroki LRU
```

**Core architectural choices:**
- **Annotations live inside `.pviz` envelope** (diagram-state, follows the diagram everywhere)
- **Tile/camera state lives in `workspace.json`** (workspace-state, separate from diagrams)
- **Hit-test runs server-side** (server has SVG + IR; client doesn't need engine-specific knowledge)
- **Two coordinate spaces in webview**: canvas (where tiles live) and viewport (pixels). Camera maps between
- **GPU rendering for canvas**: outer viewport `<div>` overflow-hidden, inner canvas-plane uses CSS `transform: translate scale` — no per-frame React re-renders for camera moves

## Annotation Data Model

### Type definitions

```ts
export type AnnotationKind = "tag" | "region" | "pin";

export interface Annotation {
  id: string;                     // ann_<ulid>
  kind: AnnotationKind;
  text?: string;                  // user comment
  color?: string;                 // optional UI color
  createdAt: string;              // ISO 8601
  resolvedAt?: string;            // resolution timestamp
  // tag-specific:
  targetNodes?: string[];         // IR node IDs (graph engines)
  // region-specific:
  bboxPixel?: { x: number; y: number; w: number; h: number };
  bboxData?: unknown;             // engine-translated (e.g. { x: ["mermaid","d2"], y: [3,14] })
  // pin-specific:
  point?: { x: number; y: number };  // pixel-space
  nearestNode?: string;           // for graph engines
}
```

`Diagram` envelope extends:
```ts
export interface Diagram {
  // ...existing Cycle 1 fields...
  annotations?: Annotation[];     // NEW
}
```

### Hit-testing per engine family

Server-side enrichment runs on every persisted annotation. One hit-tester per engine family in `packages/server/src/hit-test/`:

```ts
export interface HitTester {
  byPoint(svg: string, x: number, y: number): { nodes: string[]; data?: unknown };
  byRegion(svg: string, bbox: BBox): { nodes: string[]; dataRange?: unknown };
}
```

| Family | Strategy |
|---|---|
| **graph** (Mermaid flow, D2, Graphviz, blockdiag, nomnoml, c4plantuml, structurizr) | Walk SVG `<g id="flowchart-...">` (Mermaid pattern). For region: AABB-test each node bbox |
| **sequence** (PlantUML, seqdiag) | Best-effort: parse PlantUML `<g>` per actor. If pattern fails → bbox-only |
| **chart** (vega, vegalite) | Inspect Vega spec (parsed from .pviz `dsl`) → extract scale domain → invert pixel ranges to data ranges |
| **er, process** (mermaid ER, dbml, BPMN, actdiag) | Best-effort SVG `<g>` parsing. Fall back to bbox-only |
| **signal, freeform, network** | bbox-only. No structural enrichment |

Hit-test failure modes (Mermaid version change, malformed SVG) → annotation still saves with `bbox` only; no exception. Annotations are never lost due to enrichment errors.

## Infinite Canvas

### State

```ts
export interface Camera {
  x: number;
  y: number;
  zoom: number;       // 0.1 ≤ zoom ≤ 4
}

export interface Tile {
  id: string;         // t_<ulid>
  diagramId: DiagramId;
  diagramSlug: string;       // for re-loading from disk
  x: number; y: number;      // canvas-space top-left
  w: number; h: number;      // canvas-space size (in canvas units, not viewport pixels)
  z: number;                  // stacking order
}

export interface WorkspaceState {
  version: 1;
  camera: Camera;
  tiles: Tile[];
}
```

Stored in `<project>/.prixmaviz/workspace.json`. Loaded at app open, written debounced 500ms after last change.

### Coordinate math

```ts
function toViewport(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}
function toCanvas(p: Point, cam: Camera): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}
```

### Interaction modes (mutually exclusive)

| Mode | Default key | Cursor | On drag empty | On drag tile | On click in tile body |
|---|---|---|---|---|---|
| Select | `1` | grab | pan canvas | move tile (header) / resize (corner) | (passes through to SVG; drag = pan tile contents — no, just no-op) |
| Region | `2` | crosshair | (no-op) | drag = create region annotation | drag = create region annotation |
| Pin | `3` | crosshair-dot | (no-op) | (no-op) | click = drop pin + popup |
| Tag | `4` | pointer | (no-op) | (no-op) | click = hit-test, tag matched node |

### Bounds, snap, perf

- **Bounds**: soft-clamp camera to ±50000 canvas units; tiles to ±50000 (prevents fly-aways)
- **Snap to grid**: 20px snap by default for tile drag/resize; toggle via Cmd-drag (no snap)
- **Perf cap**: 16 visible tiles soft-warning; offscreen tiles still rendered (no virtualization in v1)

### MCP-driven canvas

`update_tile` and `set_view` mutate the workspace store and broadcast WS message `{type: "workspace", camera, tiles}`. Webview animates camera transitions via motion (300ms spring).

## Annotation Overlay UI

### Mode switcher (toolbar)

Top-of-window strip extends Cycle 1's Topbar:
```
[ PRIXMAVIZ ] [ engine · kind ]   [1 select] [2 region] [3 pin] [4 tag]   [Save]   [ws · open]
```

Active mode highlighted. Number keys switch (when no input has focus). Escape returns to Select.

### Per-tile layout

```tsx
<Tile>
  <TileHeader>
    {diagram.name}
    <span>{diagram.engine}</span>
    <button onClick={focus}>focus</button>
    <button onClick={close}>×</button>
  </TileHeader>
  <TileBody>
    <DiagramView svg={...} />
    <AnnotationLayer
      annotations={diagram.annotations ?? []}
      mode={canvasMode}
      tileBounds={...}
      onCreate={persistAnnotation}
      onSelect={openCommentPopup}
    />
  </TileBody>
  <ResizeHandle corner="se" />
</Tile>
```

### Visual rendering

- **Tag**: 2px dashed outline (color from annotation) around the hit SVG node, looked up by IR id
- **Region**: filled translucent rect (10% opacity) with 2px dashed border, label badge top-left ("R1")
- **Pin**: 16px numbered circle (1, 2, 3 in creation order), drop-shadow. Hover reveals comment text. Click expands sticky-note popup

### Comment popup

Anchored to annotation. Inline:
```
┌──────────────────────────┐
│ [textarea: 3 lines]      │
│                          │
│ [Save] [Resolve] [Delete]│
└──────────────────────────┘
```
Esc closes without save. ⌘Enter saves.

### Cross-tile coherence

If diagram D is open in tiles T1 and T2 (allowed: same diagram in two tiles), an annotation created in T1 broadcasts via WS and renders in T2 simultaneously. Annotations are diagram-state, not tile-state.

## MCP Tool Surface (10 tools total)

Cycle 1's 6 tools unchanged. 4 new:

### Tool 7: `get_annotations`

```
Input:  { diagramId, includeResolved?: boolean }
Output: { annotations: Annotation[] }
```

Reads enriched annotations. AI does not create or modify annotations; this is read-only.

### Tool 8: `update_tile`

```
Input:  { tileId, patch: { x?, y?, w?, h?, focused?: boolean } }
Output: { tile: Tile }
```

Move, resize, or focus a tile. `focused: true` triggers camera animation to center the tile in viewport.

### Tool 9: `set_view`

```
Input: {
  camera?: { x, y, zoom },
  arrange?: {
    style: "grid" | "horizontal" | "vertical",
    diagrams: DiagramId[],
    padding?: number
  }
}
Output: { camera, tiles }
```

Two modes:
- `camera` — direct viewport jump
- `arrange` — auto-layout: opens (or repositions) listed diagrams, computes positions per `style`, returns final state

### Tool 10: `install_mcp_plugin`

```
Input:  { host: "claude-code" | "codex" | "vscode", confirm: boolean }
Output: { configPath, entryAdded, snippet }
```

Writes MCP config entry to host's config file. Idempotent. `confirm: false` returns the snippet without writing (dry-run).

### Tool conventions

- All mutating tools broadcast WS update post-mutation
- Output payloads remain JSON; no large SVG returns from tile/view tools
- `get_annotations` truncated to 1000 annotations max per response (paginate if needed in v3)

## MCP Install Path

### Mode A: Tauri app first-launch bootstrap

On first launch (or via menu "Install MCP plugin"):

1. Detect host config files:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%/Claude/claude_desktop_config.json`
2. Show one-shot dialog: "Add PrixmaViz to Claude Code?"
3. On approval, write JSON entry pointing at bundled `prixmaviz-server` binary
4. Idempotent: skip if entry already exists; merge into existing `mcpServers` map
5. Backup existing config to `claude_desktop_config.json.bak.<timestamp>` before write
6. Persistent flag at `~/.config/prixmaviz/state.json` records install offered → not asked again

JSON entry written:
```json
{
  "mcpServers": {
    "prixmaviz": {
      "command": "/Applications/PrixmaViz.app/Contents/Resources/binaries/prixmaviz-server-aarch64-apple-darwin",
      "args": ["--mcp"]
    }
  }
}
```

`--project-root` resolved at MCP-call time via lockfile detection (single-instance-per-machine model from Cycle 1).

### Mode B: Standalone install (no Tauri)

Two paths:

**curl install script** (`install.sh` hosted on prixmaviz.io):
```bash
curl -fsSL https://prixmaviz.io/install.sh | sh
```
- Detects platform, downloads matching binary into `~/.local/bin/`
- Prints JSON snippet for Claude Code config
- Exits

**brew formula**:
```bash
brew install prixmaviz/prixmaviz/prixmaviz-server
```
Binary into `/opt/homebrew/bin/`, prints config snippet.

### Mode C: Manual

Documented in README:
- Binary path
- JSON snippet
- Where to put it

### Edge cases

- **Config file doesn't exist**: create it with `{ "mcpServers": {} }` and add entry
- **Config file exists but invalid JSON**: abort, prompt user to fix manually, do not overwrite
- **Existing `prixmaviz` entry**: skip (idempotent)
- **Sibling MCP entries** (e.g., `filesystem`, `github`): preserve via merge
- **Permission denied writing config**: surface clear error, fall back to printing snippet

## Implementation Waves

Five shippable waves. Each ends in mergeable, working state.

### Wave 1 — Annotation foundation (local-only)
**Goal**: User can create + persist + dismiss annotations. AI doesn't see them yet.

- Shared types: `Annotation`, `AnnotationKind`, extend `Diagram`
- Server: annotation in-memory store, persist to `.pviz`
- Server: HTTP routes `POST /api/annotations`, `GET /api/diagrams/:id/annotations`, `DELETE /api/annotations/:id`, `PUT /api/annotations/:id` (resolve)
- Server: WS broadcast variants (`annotation:created`, `annotation:resolved`, `annotation:deleted`)
- Web: ToolPalette (mode switcher), keyboard shortcuts
- Web: AnnotationLayer overlay
- Web: comment popup
- Web: hit-test stub for graph (returns matched nodes; other engines return bbox-only)
- **Mergeable when**: User can create + see + dismiss annotations across reload. AI surface untouched.

### Wave 2 — AI sees annotations
**Goal**: Bidirectional loop closes.

- Server: hit-test for sequence (PlantUML pattern), chart (Vega scale inversion)
- Server: hit-test enrichment runs on every persisted annotation
- MCP: new `get_annotations` tool registered + dispatched
- Web: minor — annotation count badge in tile header
- **Mergeable when**: User circles a node, AI calls `get_annotations`, sees `targetNodes: ["auth"]` plus text. PlantUML sequence + Vega chart hit-tests work.

### Wave 3 — Multi-canvas (user-driven)
**Goal**: Infinite canvas with pan, zoom, drag tiles. AI doesn't drive yet.

- Shared: `Tile`, `Camera`, `WorkspaceState`
- Server: workspace store + I/O + watcher
- Server: HTTP routes `GET/PUT /api/workspace`, `POST /api/tiles`, `PATCH /api/tiles/:id`, `DELETE /api/tiles/:id`
- Web: refactor `Canvas.tsx` → `InfiniteCanvas.tsx` with camera transform
- Web: `Tile.tsx` (header, body, resize handle)
- Web: pan/zoom interactions (drag empty = pan, scroll = zoom, drag tile header = move)
- Web: open library item → place tile in next free slot
- Web: workspace persistence
- **Mergeable when**: User opens 3 diagrams, drags them around, pans/zooms, reloads — state preserved.

### Wave 4 — AI drives canvas
**Goal**: AI tools to control workspace.

- MCP: `update_tile`, `set_view` tools
- Server: `set_view({arrange})` auto-layout (grid, horizontal, vertical)
- Web: receive workspace updates via WS, animate camera + tile transitions via motion
- **Mergeable when**: AI calls `set_view({arrange:{style:"grid",diagrams:[...]}})` → 4 tiles laid out. AI calls `update_tile({focused:true})` → camera animates.

### Wave 5 — Real install + acceptance
**Goal**: Cross the chasm.

- Tauri: first-launch install dialog (Rust + plugin-fs)
- Tauri menu: "Install MCP plugin" command (re-runs prompt)
- Server: `install_mcp_plugin` tool + HTTP route mirror
- Standalone: brew formula skeleton + `install.sh` script
- Docs: README updates with all install paths
- Acceptance: clean Mac, install via Mode A, drive full annotation + canvas session via real Claude Code
- **Mergeable when**: Real-AI smoke passes. Full loop verified end-to-end.

## Acceptance Criteria

Cycle 2.plus is complete when:

- [ ] User creates tag/region/pin annotations on graph, sequence, chart, and passthrough engines
- [ ] Annotations persist in `.pviz` and survive reload
- [ ] Annotations broadcast via WS — opening same diagram in two tiles shows mirrored annotations
- [ ] Server-side hit-test enriches: graph annotations gain `targetNodes`; chart annotations gain `bboxData` (data-space ranges)
- [ ] AI calls `get_annotations(diagramId)` → receives full enriched list
- [ ] Annotation hit-test failures (e.g. Mermaid version drift) gracefully fall back to bbox-only — no annotation loss
- [ ] User opens multiple diagrams as tiles on infinite canvas
- [ ] User pans canvas (drag empty space), zooms (scroll/pinch), drags tiles (header), resizes tiles (corner)
- [ ] Camera + tile state persists in `workspace.json`, restored on reload
- [ ] AI calls `update_tile({patch})` to move/resize/focus tiles
- [ ] AI calls `set_view({arrange:{style,diagrams}})` to auto-layout
- [ ] Tauri first-launch shows install dialog; on accept, writes config entry to Claude Code config; idempotent
- [ ] Standalone install via `install.sh` and brew formula works on macOS + Linux
- [ ] **Real-AI smoke**: clean Mac, install via Tauri, ask CC "make a flowchart of the prixmaviz repo, then I'll annotate", full loop completes

## Risk Register

| Risk | Mitigation |
|---|---|
| Server-side SVG parsing fragile (Mermaid changes IDs) | Pin Mermaid version via Kroki; parser falls back to bbox-only on pattern mismatch |
| Hit-test on Vega charts requires scale inversion | Read scale.domain from spec; for non-trivial scales, fall back to pixel-bbox-only |
| Camera + zoom hits perf wall with many tiles | Soft-cap at 16 visible; CSS transform; offscreen rendering acceptable in v1 |
| Tauri can't write CC config without entitlements on macOS | Use `tauri-plugin-fs` with explicit user grant; fall back to printing snippet |
| MCP install dialog is annoying | One-shot, dismissible, "don't ask again" sticky |
| Mermaid foreignObject text-width clipping (known from Cycle 1 tire-kicking) | Document as known issue; fix is in-browser Mermaid (Cycle 3+) |
| Coordinate-space confusion (canvas vs viewport) | Pure functions for `toCanvas`/`toViewport`; tests for roundtrip |
| Workspace file corruption | Backup on every write; load fallback to empty workspace if parse fails |

## Plan-Defects-from-Cycle-1 Mitigations

Hard-won lessons:

1. **Plan code blocks include test fixtures with assertions.** Cycle 1's plan had `edgeOp` with bugs that compiled fine and only got caught post-impl. This time: every code block in plan has at least one `expect(...)` assertion.
2. **Each task acceptance has explicit "done when" lines.** Not just numbered steps. Subagents drift when "done" is implicit.
3. **Pin upstream surfaces:** Mermaid version (via Kroki tag), MCP SDK version, motion lib version, Tauri version. Lockfile committed.
4. **Mock Kroki at test boundary.** Cycle 1 had flakes from live kroki.io. This time: hit-test tests use fixture SVGs, not live renders.
5. **Hard YAGNI gate at end of each wave.** "Did anything land that isn't in spec? Revert before next wave."
6. **First-action verification in subagent prompts.** Each implementer prompt opens with `pwd && git rev-parse --abbrev-ref HEAD` to confirm correct worktree + branch (Cycle 1 had a wrong-worktree incident).

## Open Questions

For implementation plan to resolve:

1. **Vega scale inversion for non-linear scales** (log, time): start with linear-only support; document as Wave-2 limitation
2. **Annotation IDs across server restarts**: regenerate from .pviz on load (server-side ULIDs), or persist as written. Recommend persist (deterministic across reloads)
3. **Tile id vs diagramId**: tiles are display state, can have multiple tiles per diagram. Use distinct ids
4. **Camera "follow" mode** during AI auto-arrange: animate or jump? Recommend animate with motion's spring (spring stiffness 240, damping 26 — same as Cycle 1)
5. **Install script hosting**: prixmaviz.io domain — registered? If not, defer to GitHub raw URL until domain ready
