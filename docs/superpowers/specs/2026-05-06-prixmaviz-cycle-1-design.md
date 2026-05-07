# PrixmaViz — Cycle 1 (v1) Design

**Date:** 2026-05-06
**Status:** approved (brainstorming) — pending implementation plan
**Cycle:** 1 of 4 (Foundation)

## Problem

AI coding agents (Claude Code, Codex, VSCode-AI) frequently produce diagrams as part of their output: architecture sketches, sequence flows, ER models. Today these surface as ASCII, inline Mermaid blocks, or static images that disappear after the conversation. The user can't keep them, refine them across sessions, or feed feedback back into the agent's context. The agent can't iterate on a diagram structurally — every "update" rewrites the whole DSL from scratch.

PrixmaViz is an AI-native diagram workspace: a persistent canvas where AI builds and refines diagrams via structured patches, the user saves and recalls them per-project, and the visual stays alive across turns.

## Scope: Cycle 1

This document specifies **Cycle 1** only. The full project decomposes into four cycles:

| Cycle | Theme | Out of scope here |
|---|---|---|
| **1 — Foundation** *(this doc)* | AI paints diagrams that persist | — |
| 2 — Voice | User talks back through diagrams (annotations → AI) | annotation overlay UI, persisting annotations in `.pviz`, exposing annotations to AI via MCP. (Cycle 1 already uses IR↔SVG node mapping for animation diff; Cycle 2 reuses it to map user clicks to IR nodes.) |
| 3 — Tether | Diagrams stay true to source code | `regen_from_source` tool, file-watcher auto-tether, source-path metadata |
| 4 — Hosts | Available everywhere AI lives | Codex pane adapter, VSCode extension, browser-standalone fallback |

Cycle 1 ships **standalone**: Tauri shell + CC MCP plugin. Cycles 2-4 each get their own brainstorm → spec → plan → ship cycle.

## Goals (Cycle 1)

1. AI agent can create, modify, save, load, and list diagrams via 6 MCP tools.
2. User sees a live canvas that animates AI's edits stepwise (motion between patches).
3. Diagrams persist as JSON in `<project>/.prixmaviz/diagrams/*.pviz`, travel with repo.
4. User can browse saved diagrams in a sidebar library, click to load.
5. Ships as a single distributable Tauri app (mac/win/linux) with embedded Bun sidecar.
6. CC MCP plugin can be installed once, talks to PrixmaViz whether the app is open or not.

## Non-Goals (Cycle 1)

- No annotations, no user-draws-on-diagram (Cycle 2)
- No code-tethering or file watching (Cycle 3)
- No Codex pane, VSCode extension, or browser-standalone host (Cycle 4)
- No multi-user or cloud sync
- No engine-IR support beyond Mermaid for the graph family (other engines = passthrough only)
- No undo/redo across committed patches (deferred). Atomicity within a single `apply_patch` call is guaranteed (failed batch = IR untouched), but once a batch commits there is no history stack in v1.
- No code-signed builds, no auto-update

## Architecture (Approach A: Bun canonical, Tauri optional shell)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tauri shell (v2)  — native window, manages sidecar lifecycle           │
│                                                                        │
│   ┌──────────────────────────┐         ┌─────────────────────────┐     │
│   │ Webview (React + motion) │ ◄─HTTP/WS (localhost)──►          │     │
│   │  canvas / sidebar /      │         │ Bun sidecar (process)   │     │
│   │  editor                  │         │  ┌────────────────────┐ │     │
│   └──────────────────────────┘         │  │ HTTP / WS / static │ │     │
│                                        │  │ Graph IR engine    │ │     │
│                                        │  │ Kroki client (LRU) │ │     │
│                                        │  │ .pviz I/O          │ │     │
│                                        │  │ MCP stdio entry    │ │     │
│                                        │  └────────────────────┘ │     │
└────────────────────────────────────────┴────────────┬────────────┴─────┘
                                                      │
                  ┌───────────────────────────────────┤
                  │                                   │
                  │ MCP stdio (JSON-RPC)              │ HTTPS
                  ▼                                   ▼
          ┌──────────────────┐               ┌──────────────────────┐
          │ Claude Code      │               │ Kroki                │
          │ (or future host) │               │ (public or self-host)│
          └──────────────────┘               └──────────────────────┘

                                                      ▲
                                                      │ reads/writes
          ┌──────────────────────────────────────────┐
          │ <project>/.prixmaviz/                    │
          │   diagrams/*.pviz   diagrams/*.svg       │
          │   cache/<sha256>.svg   config.json       │
          └──────────────────────────────────────────┘
```

Note: when Cycle 4 hosts (Codex pane, VSCode webview) point at Bun directly, Tauri box is removed; everything else is identical.

**Process model:**
- **Bun sidecar** is the canonical server. Single source of truth for IR, save/load, render. Runs even without Tauri.
- **Tauri shell** provides a native desktop window. Optional — Cycle 4 hosts (Codex, VSCode) point at the same Bun server with no Tauri.
- **Webview** (React + motion) connects via localhost HTTP+WS. Same bundle, same code path regardless of host.
- **Filesystem**: `<project>/.prixmaviz/diagrams/*.pviz` (JSON), sibling `*.svg` (thumbnail), `cache/` (Kroki LRU, gitignored).

**Distribution:** one Tauri app bundle per OS, Bun binary baked in via `tauri.conf.json` `externalBin`. Total ~50-80MB per platform.

## Graph IR

Diagrams divide into two kinds:

- **`kind: "graph"`** — graph family of engines (Mermaid flowchart, D2, Graphviz, blockdiag, nomnoml, c4plantuml, structurizr). Has structured `ir` field. Patches mutate IR; DSL regenerated.
- **`kind: "passthrough"`** — all other engines (sequence, BPMN, ER, signal/bit, charts, free-form). Has raw `dsl` field. AI sends DSL strings directly via `render_dsl`. No patches.

### Type definitions

```ts
type DiagramEngine = "mermaid" | "d2" | "graphviz" | ... // 28 supported

type DiagramKind = "graph" | "passthrough";

type Diagram = {
  id: string;
  name: string;            // human-readable, e.g. "auth-flow"
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;            // when kind=graph
  dsl?: string;            // when kind=passthrough
  meta: DiagramMeta;
};

type GraphIR = {
  nodes: Record<NodeId, Node>;
  edges: Record<EdgeId, Edge>;
  groups: Record<GroupId, Group>;
  layout: Layout;
};

type Node = {
  id: NodeId;
  label: string;
  shape?: "rect" | "round" | "circle" | "diamond" | "hex" | "cyl";
  attrs?: Record<string, unknown>;
  groupId?: GroupId;
};

type Edge = {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  label?: string;
  kind?: "solid" | "dashed" | "dotted" | "thick";
  arrow?: "normal" | "open" | "none";
  attrs?: Record<string, unknown>;
};

type Group = {
  id: GroupId;
  label: string;
  members: NodeId[];
  parent?: GroupId;        // single-level v1; nesting structure free for later
  attrs?: Record<string, unknown>;
};

type Layout = {
  direction: "LR" | "RL" | "TB" | "BT";
  spacing?: number;
  theme?: string;
};

type DiagramMeta = {
  createdAt: string;       // ISO 8601
  updatedAt: string;
  tags: string[];
  sourcePaths: string[];   // empty in v1, populated by Cycle 3
};
```

**Design choices:**
- Records keyed by id (not arrays) → O(1) lookup, simpler patch ops, deterministic JSON.
- Node IDs: AI-chosen strings. Server validates uniqueness, rejects collisions.
- `attrs` bag is engine-flavored. Renderer strips unsupported keys, returns warnings.
- No node positions stored — engine handles layout. Manual positioning out of scope.
- No annotation field — Cycle 2 adds.

### Patch operations

```ts
type PatchOp =
  | { op: "add_node"; node: Node }
  | { op: "update_node"; id: NodeId; patch: Partial<Node> }
  | { op: "remove_node"; id: NodeId }
  | { op: "add_edge"; edge: Edge }
  | { op: "update_edge"; id: EdgeId; patch: Partial<Edge> }
  | { op: "remove_edge"; id: EdgeId }
  | { op: "add_group"; group: Group }
  | { op: "update_group"; id: GroupId; patch: Partial<Group> }
  | { op: "remove_group"; id: GroupId }
  | { op: "set_layout"; patch: Partial<Layout> }
  | { op: "set_meta"; key: string; value: unknown };
```

Validation rules:
- `add_node`: id must not already exist.
- `add_edge`: from/to must reference existing nodes.
- `remove_node`: cascades — all edges referencing it are also removed in the same atomic batch.
- `update_*`: id must exist; patch fields type-checked.
- `add_group` members must reference existing nodes.

Atomicity: deep-clone IR, apply all ops, commit on success. Single op failure rejects whole batch. IR remains unchanged.

### .pviz file format

```json
{
  "version": 1,
  "id": "d_01HXYZ...",
  "name": "auth-flow",
  "engine": "mermaid",
  "kind": "graph",
  "ir": {
    "nodes": { "a": { "id": "a", "label": "Auth" }, ... },
    "edges": { "e1": { "id": "e1", "from": "a", "to": "d", "label": "reads" } },
    "groups": {},
    "layout": { "direction": "LR" }
  },
  "meta": {
    "createdAt": "2026-05-06T10:30:00Z",
    "updatedAt": "2026-05-06T10:42:11Z",
    "tags": ["auth"],
    "sourcePaths": []
  }
}
```

For `kind: "passthrough"`, the envelope omits `ir` and adds `dsl: string`.

## MCP Tool Surface (6 tools)

The Bun process exposes one MCP server over stdio. Coarse-grained: AI batches structured ops in single calls.

### `create_diagram`

```
Input:  { name, engine, kind?, initialDsl? }
Output: { diagramId, render: { svg, dsl } }
```

Creates new diagram in memory. Not saved to disk until `save_diagram`. `kind` auto-inferred from `engine` if omitted (graph family → graph; others → passthrough). `initialDsl` is required for passthrough, optional seed for graph.

### `apply_patch` *(workhorse)*

```
Input:  { diagramId, ops: PatchOp[] }
Output: {
  diagramId,
  ir: GraphIR,
  render: { svg, dsl },
  warnings?: string[]    // e.g. "shape 'foo' not supported, fell back to 'rect'"
}
```

Apply N ops atomically. Server validates all-or-nothing. Returns updated render. Broadcasts to webview via WS for live motion. Errors: unknown `diagramId`, ref-to-missing-node, duplicate id, render failure → whole batch rejected, IR untouched.

### `save_diagram`

```
Input:  { diagramId, name?, tags? }
Output: { path, meta }
```

Writes IR + DSL + last-rendered SVG to `<project>/.prixmaviz/diagrams/<slug>.pviz` and sibling `.svg`. `name` arg = rename. Slug rules: kebab-case ASCII, conflict resolution via `-2`, `-3` suffixes.

### `load_diagram`

```
Input:  { name }                  // or path
Output: { diagramId, ir?, dsl?, render: { svg, dsl } }
```

Reads `.pviz` from disk into memory, returns full state. Re-renders if sibling SVG is stale.

### `list_diagrams`

```
Input:  { tag?, search? }
Output: { diagrams: Array<{ name, path, engine, kind, tags, createdAt, updatedAt }> }
```

Directory scan of `.prixmaviz/diagrams/`. Substring match on `meta.name` and `meta.tags`.

### `render_dsl` *(passthrough only)*

```
Input:  { engine, source, name? }
Output: { diagramId, render: { svg, dsl } }
```

For non-graph engines. AI emits raw DSL, server passes to Kroki, optionally saves with `name`.

### Tool conventions

- All mutating tools return `render: { svg, dsl }` — AI never has to re-call to see state.
- WS push to webview happens inside tool handlers — UI updates without polling.
- Output payloads are JSON; SVG strings can be large (~50-200KB). Implementation may truncate to URL reference if >100KB threshold; defer measurement.

## Render Pipeline

End-to-end flow when AI calls `apply_patch`:

```
[1] AI agent
      apply_patch({ diagramId, ops:[...] })
[2] Bun · MCP handler
      validate ops; reject batch if any op invalid
[3] Bun · IR engine
      deep-clone IR, apply ops, commit on success
[4] Bun · IR-to-DSL renderer (engine-specific; v1: Mermaid)
      walk IR, emit Mermaid flowchart syntax
      strip unsupported attrs, collect warnings
[5] Bun · Kroki client
      POST <kroki>/mermaid/svg, body=DSL
      cache key = sha256(engine + dsl) → in-memory LRU (~64MB cap)
[6] Kroki
      returns SVG
[7] Bun · broadcast
      ws.send({ type: "render", diagramId, ir, dsl, svg, warnings })
      mcp tool returns { ir, render, warnings }
[8] Webview
      diff prev SVG vs new SVG (added/removed/moved nodes by id)
      motion-animate: fade+scale-in for adds, fade-out for removes,
      spring-tween for moves, stroke-dashoffset draw-on for new edges
```

### IR-to-Mermaid renderer

Walks IR in three passes: groups (subgraphs), ungrouped nodes, edges. Maps:
- shape `rect` → `A[label]`, `round` → `A(label)`, `circle` → `A((label))`, `diamond` → `A{label}`, `cyl` → `A[(label)]`, `hex` → `A{{label}}`
- edge kind/arrow → `-->`, `-.->`, `==>`, `--label-->`, etc.

### SVG node-id diffing

Mermaid emits SVG with `id="flowchart-<NodeId>-<n>"` per node. Renderer strips the `flowchart-` prefix and trailing `-<n>` to recover IR node id. Same for edges (`id="L-<from>-<to>-<n>"`).

**Risk:** Mermaid SVG ID convention is not part of its public contract. Mitigation: pin Mermaid version (the version Kroki ships). Detect deviation via regex pattern check on first render; fall back to position-based diffing if pattern fails.

### Motion animation

`<motion.svg>` containing `<motion.g layout key={nodeId}>` for each node, wrapped in `<AnimatePresence>`:
- Added: `initial={{opacity:0, scale:.85}}`, `animate={{opacity:1, scale:1}}`
- Removed: `exit={{opacity:0, scale:.85}}`
- Moved: `layout` prop → FLIP-style spring tween
- Edges: stroke-dashoffset animated from full-length to 0 on add

Transition: `{type:"spring", stiffness:240, damping:26}`.

**Risk:** Mermaid re-layouts on every render — even an `add_node` may shift unrelated nodes. Heavy edits = visual chaos. Mitigation: dampen motion duration when >30% of nodes moved; option to disable motion in settings.

## Save/Load + Library UI

### File layout

```
<project>/
  .prixmaviz/
    diagrams/
      auth-flow.pviz          # JSON envelope
      auth-flow.svg           # last render, for thumbnails
      data-model.pviz
      data-model.svg
    cache/                    # Kroki LRU, gitignore'd
      <sha256>.svg
    config.json               # project-level settings
```

`.prixmaviz/diagrams/` is committable. `.prixmaviz/cache/` is gitignored. Recommend project `.gitignore` rule: `.prixmaviz/cache/`.

### Slug rules

- Filename = `slugify(name)` → kebab-case, ASCII alphanumerics + hyphens, max 80 chars.
- Conflict: append `-2`, `-3`, etc. Original name preserved in `meta.name`.
- Save with `name` arg = rename: writes new file, optionally deletes old (UI prompts user).
- Library UI shows `meta.name`, slug only on hover.

### UI behaviors

- **Library sidebar** (240px): thumbnails (sibling SVG), search box (substring on name + tags), tag chips color-coded by hash. Live-updates via `fs.watch`.
- **Load**: click sidebar item → HTTP GET `/api/diagrams/<slug>` → canvas re-renders with new state.
- **Save**: button + ⌘S. Unsaved-changes indicator next to name.
- **New**: opens engine picker, creates blank diagram. AI also creates via MCP.
- **Rename / delete**: right-click context menu. UI-only ops (not exposed via MCP in v1).
- **Search**: in-memory substring match indexed at scan time.

### Auto-scan

Bun runs `fs.watch` on `.prixmaviz/diagrams/`; emits WS message when files change. Webview re-fetches library list. `fs.watch` coalesces rapid changes on macOS — fine for v1.

## Tauri Shell

### Repo structure

```
PrixmaViz/
  packages/
    shared/                       # existing
    server/                       # existing — Bun, builds binary
    web/                          # existing — Vite + React
  src-tauri/                      # NEW
    Cargo.toml
    tauri.conf.json
    src/main.rs                   # sidecar lifecycle
    icons/
    binaries/                     # bun binaries per target (built by CI)
      prixmaviz-server-aarch64-apple-darwin
      prixmaviz-server-x86_64-apple-darwin
      prixmaviz-server-x86_64-pc-windows-msvc.exe
      prixmaviz-server-x86_64-unknown-linux-gnu
```

### tauri.conf.json (key fields)

```json
{
  "productName": "PrixmaViz",
  "identifier": "io.prixmaviz.app",
  "build": {
    "frontendDist": "../packages/web/dist",
    "devUrl": "http://localhost:5181"
  },
  "app": {
    "windows": [{ "title": "PrixmaViz", "width": 1280, "height": 820, "minWidth": 800, "minHeight": 560 }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "deb", "appimage"],
    "externalBin": ["binaries/prixmaviz-server"]
  }
}
```

### Sidecar lifecycle

1. User opens PrixmaViz.app.
2. Tauri determines `project-root` (CLI arg, last-used setting, or current cwd).
3. Tauri ensures `.prixmaviz/` exists.
4. Tauri spawns `prixmaviz-server --port 0 --project-root <path>` as sidecar.
5. Bun picks free ephemeral port, prints `{"port":N}` to stdout on ready.
6. Tauri parses handshake, calls `webview.navigate("http://127.0.0.1:N")`.
7. Webview boots React, opens WS to `ws://127.0.0.1:N/ws`.
8. Webview fetches library list via HTTP, renders sidebar.
9. Splash screen visible until step 6 completes (~150-300ms).
10. On app close: drop sidecar handle → Tauri kills Bun process.

`tauri-plugin-single-instance` ensures relaunch focuses existing window per `project-root`.

## CC MCP Plugin Packaging

### Modes

The `prixmaviz-server` binary has two run modes:

- **Server mode** (default): `prixmaviz-server [--port N] [--project-root PATH]` — runs HTTP/WS, no MCP. Tauri uses this.
- **MCP mode**: `prixmaviz-server --mcp [--project-root PATH]` — runs as MCP stdio server. Spawns its own internal HTTP/WS backend on an ephemeral port if no existing PrixmaViz instance is found at the project root.

When the MCP process detects an existing instance (via `.prixmaviz/state/instance.json` lockfile written by Tauri at startup), it forwards tool calls to that instance over the local HTTP API. Otherwise it owns the instance.

### Install path

Two install methods:

1. **Tauri app installs MCP entry on first run**: Tauri detects `~/Library/Application Support/Claude/claude_desktop_config.json` (mac) / equivalent on win/linux, prompts user to add the MCP entry pointing at the bundled binary path.
2. **Standalone install** (no Tauri): brew formula or curl install script drops `prixmaviz-server` binary into `~/.local/bin/` or `/usr/local/bin/`, prints the JSON snippet for `claude_desktop_config.json`.

Example `claude_desktop_config.json` entry:

```json
{
  "mcpServers": {
    "prixmaviz": {
      "command": "/Applications/PrixmaViz.app/Contents/Resources/binaries/prixmaviz-server",
      "args": ["--mcp"]
    }
  }
}
```

CC discovers the MCP server, lists the 6 tools, AI can call them.

### Cross-instance behavior

- AI calls `create_diagram` while no PrixmaViz UI is running → MCP process starts an internal headless Bun core, creates the diagram in memory, persists if AI calls `save_diagram`.
- AI calls `create_diagram` while PrixmaViz Tauri app is running → MCP process forwards to running instance via HTTP. Webview shows diagram appear live.
- AI calls `list_diagrams` from project A while PrixmaViz is open on project B → MCP process determines project root from `--project-root` arg or cwd of CC, scans correct directory.

## Error Handling

| Failure | Behavior |
|---|---|
| Kroki unreachable | First, hit local cache. If miss, return `{ ok:false, error:"kroki unreachable" }` to AI. Webview shows error panel with "retry" button. |
| Kroki rate-limited (429) | Server queues with exponential backoff up to 30s. AI sees `warnings: ["rate-limited, retrying"]` until success or final failure. |
| Invalid IR (cycle in groups, dangling edges) | `apply_patch` rejects whole batch. Returns `{ ok:false, error:"<reason>", op_index: N }` to AI so it knows which op failed. |
| Bun sidecar crash | Tauri restarts once after 1s delay. Second crash → splash error screen with logs path. |
| WS disconnect | Webview reconnects with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s). On reconnect, server pushes current state for currently-open diagram. |
| Concurrent saves (mtime mismatch) | Server checks file mtime before write. Mismatch → return `{ ok:false, error:"diagram changed externally", current: <fresh state> }`. AI/UI decide to retry or merge. |
| File system permission errors | Surface to UI with actionable message ("can't write `.prixmaviz/`, check permissions"). |
| Invalid engine | `create_diagram` returns clear error; list of supported engines included in error message. |
| Mermaid SVG ID pattern mismatch | First successful render after Mermaid version change: validate pattern. On mismatch, log warning, fall back to position-based diffing for that diagram. |

## Testing Approach

### Unit tests (Bun test runner)
- **IR engine**: each patch op type, invariants (no orphan edges after `remove_node`, group membership consistency, no group cycles via `parent`).
- **IR-to-Mermaid renderer**: snapshot tests, input IR fixtures → expected DSL strings.
- **Slug**: name → slug roundtrip, conflict resolution, unicode handling.

### Integration tests (Bun)
- **HTTP endpoints**: `/api/render`, `/api/diagrams/*`, `/api/library`. Hit with fixture requests, assert JSON response shape.
- **WS broadcast**: open mock client, trigger `apply_patch`, assert WS message arrives.
- **MCP tool dispatch**: invoke tools via fake MCP client (stdio), assert outputs.

### Webview tests (Vitest + happy-dom or Playwright)
- **Components**: library sidebar renders given mock data, search filters correctly.
- **SVG diff**: given two SVG strings, diff produces expected added/removed/moved sets.
- **Motion**: smoke test that `<motion.g>` elements receive correct props (full motion behavior is visual; cover with manual smoke).

### Manual smoke (per-platform, before release)
- Cold start under 1s.
- Create diagram via fake MCP call from a script, see motion animation.
- Save diagram, kill Tauri, relaunch, see diagram in library, click to load.
- Kroki offline (block via firewall), confirm graceful error.

### Out of scope for v1
- Tauri E2E test harness (defer to Cycle 4 when host adapters multiply).
- Visual regression tests (SVG output).
- Cross-OS automated CI E2E (smoke manually).

## Out of Scope (Future Cycles)

| Feature | Cycle | Notes |
|---|---|---|
| Annotation overlay (draw, circle, pin) | 2 | Reserved space in `.pviz` envelope (`annotations: []` field added in Cycle 2). |
| IR↔SVG node-id mapping for annotations | 2 | Builds on Section "SVG node-id diffing" of this doc. |
| Annotation feedback to AI (structured node refs) | 2 | New MCP tool `get_annotations(diagramId)`. |
| `regen_from_source` MCP tool | 3 | Reads `meta.sourcePaths` (already in v1 envelope, empty). |
| File-watcher auto-tether | 3 | Bun watches source files registered to a diagram, triggers AI agent wake-up via TBD protocol. |
| Codex pane adapter | 4 | Webview bundle unchanged; new boot path that skips Tauri, runs as iframe inside Codex pane. |
| VSCode extension webview | 4 | Separate npm package, embeds bundle in webview panel, talks to Bun via VSCode HTTP proxy. |
| Browser-standalone host | 4 | Open `localhost:PORT` in browser when no IDE host present. |
| Other graph-family IR renderers (D2, Graphviz, blockdiag, ...) | post-v1 | Each = new IR-to-DSL renderer file in `packages/server/src/renderers/`. Modular, additive. |
| Sequence/ER/Process IR families | post-v1 | New IR shape per family. Major work. |
| Multi-engine selection per diagram | post-v1 | "Render this graph IR via D2 instead of Mermaid" — needs all renderers feature-complete first. |
| Code-signed builds, auto-update | post-v1 | Tauri updater plugin. |
| Cloud sync, sharing, multi-user editing | post-v1 | Not on roadmap; out of project scope unless requested. |

## Open Questions

These are flagged for the implementation plan to resolve, not blockers for spec approval:

1. **Mermaid version pinning.** Which Kroki release (or self-hosted Mermaid version) do we target? Verify SVG ID format stable.
2. **Project-root discovery.** How does Tauri determine project root on first launch when no CLI arg is passed? Walk up from cwd looking for `.git`, fall back to home directory? UI picker?
3. **MCP cross-instance lockfile.** Exact format of `.prixmaviz/state/instance.json` (PID, port, timestamp, hostname). Stale-lock detection (old PID, different boot timestamp).
4. **Splash screen behavior.** Native Tauri splash, or HTML splash served by Bun? Latter is simpler (no native code).
5. **Settings location.** `<project>/.prixmaviz/config.json` vs. `~/.config/prixmaviz/`. Probably both: project overrides global.

These get answered in the writing-plans phase or first implementation pass.

## Acceptance Criteria

Cycle 1 is complete when:

- [ ] User installs PrixmaViz Tauri app (mac/win/linux).
- [ ] User opens a project (or uses cwd default), Tauri window shows empty library.
- [ ] User runs `claude` in the same project, MCP plugin auto-detected (after install step).
- [ ] AI calls `create_diagram` → diagram appears in PrixmaViz canvas with motion.
- [ ] AI calls `apply_patch` with multiple ops → diagram updates with stepwise motion.
- [ ] AI calls `save_diagram` → file appears in `.prixmaviz/diagrams/`, library sidebar updates.
- [ ] User closes app, reopens, saved diagram is in sidebar, clicking loads it.
- [ ] AI in a fresh session calls `list_diagrams` → sees previously saved.
- [ ] AI calls `load_diagram` → state restored, AI can patch from there.
- [ ] AI calls `render_dsl` with a passthrough engine (e.g. wavedrom) → diagram renders correctly.
- [ ] Kroki unreachable → graceful error, app still usable for cached renders.
- [ ] App quits cleanly: Bun sidecar terminates, no orphan processes.
