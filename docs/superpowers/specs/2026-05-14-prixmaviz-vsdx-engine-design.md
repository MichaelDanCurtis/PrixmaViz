# PrixmaViz — VSDX as First-Class Engine

**Date:** 2026-05-14
**Status:** Design approved; pending implementation plan
**Predecessor:** [Cycle 4 — Service-First Architecture](2026-05-11-prixmaviz-cycle-4-design.md)

## Goal

Add Microsoft Visio (`.vsdx`) as a first-class diagram engine in PrixmaViz, with **lossless round-trip read/write**. Users can drag a `.vsdx` onto the canvas and have it render natively; export any graph-engine diagram (Mermaid, D2, Graphviz) as a `.vsdx` containing real, Visio-editable shapes. Maintains PrixmaViz's deterministic-server model — no server-side LLM is added.

## Where this fits

This is a **format-bridge cycle**, not an architectural shift. PrixmaViz today owns the AI-native diagram authoring experience; enterprise users have asked repeatedly to bring legacy Visio assets into that experience and to hand finished diagrams back to colleagues who still live in Visio. This cycle delivers both directions while preserving:

- The server-stays-deterministic invariant (Cycle 4)
- The "everything is SVG to the client" invariant (Tile.tsx does not learn about a new format)
- The host-side-AI model (any AI translation between vsdx and a native engine happens in the calling MCP host, not on the server)

| Cycle | Theme |
|---|---|
| 4 (shipped) | Service-first Docker stack, multi-tenant |
| 5 | Codex plugin (shim port) |
| **VSDX (this)** | **Lossless `.vsdx` read/write as a first-class engine** |
| later | Free vs paid tier, embed-code UI |

## Design decisions (the brainstorm resolution)

| # | Decision | Rationale |
|---|---|---|
| 1 | **`.vsdx` is a first-class source format**, not a transit format | Round-trip fidelity is the whole reason users insist on `.vsdx` over `.drawio` or `.png`. An imported `.vsdx` exports byte-identical. |
| 2 | **Native rendering via `unoserver` sidecar** (persistent UNO bridge over LibreOffice) | No JS vsdx renderer is trustworthy. `unoserver` keeps a warm UNO process so per-render cost is ~200–500ms, not LibreOffice's 1–2s cold-start. |
| 3 | **AI translation is an optional separate path**, surfaced via a `analyze_vsdx` MCP tool that returns parsed structured JSON | The AI host (Claude/GPT/etc.) does the language translation if and when the user asks. Server stays deterministic; no Anthropic API key on server. |
| 4 | **Tile rendering is unchanged** — Tile.tsx still consumes a pre-rendered SVG string | New `kind: "binary"` on the server side; clients see the same SVG payload they always have. |
| 5 | **New diagram `kind: "binary"`** alongside `"graph"` and `"passthrough"` | Source is bytes (vsdx ZIP), not text DSL. One new branch in `render.ts`. |
| 6 | **Write path emits structured Visio shapes** (Visio-editable) for graph engines; image-embed fallback for everything else | The 4-shape v1 cap is rejected — day-one support targets the Basic Flowchart + Basic Shapes stencils (~35 shapes), which covers the realistic enterprise audience. |
| 7 | **Re-use `LruSvgCache` pattern** for vsdx→SVG conversions, keyed on `sha256(vsdx_bytes)` | Existing infrastructure; conversions hit cache on repeated renders. |
| 8 | **Postgres `BYTEA` column** holds vsdx bytes | Direct, transactional with the rest of the diagram row; no separate object storage needed for v1. Typical vsdx is well under 1MB. |

## Architecture

### New sidecar: `prixmaviz-vsdx` (unoserver)

```
                ┌─────────────────────────────────────────────────┐
                │            prixmaviz host                       │
   browser ─────┤  ┌─────────────┐                                │
                │  │  prixmaviz  │ ← Bun: HTTP + WS + MCP         │
                │  │   :5180     │                                │
                │  └─────┬───────┘                                │
                │        │                                        │
                │        ├── postgres                             │
                │        ├── kroki ─── (existing sidecars)        │
                │        │                                        │
                │        └── prixmaviz-vsdx                       │
                │            :2003 (unoserver/UNO bridge)         │
                │                                                 │
                └─────────────────────────────────────────────────┘
```

**Service definition** (additive to existing compose):

```yaml
prixmaviz-vsdx:
  image: ghcr.io/unoconv/unoserver:<pinned-sha>
  restart: unless-stopped
  expose: ["2003"]
  # No external port; only reachable from prixmaviz container
```

**Env vars** (additive):

| Variable | Default | Purpose |
|---|---|---|
| `VSDX_RENDERER_URL` | `http://prixmaviz-vsdx:2003` | Override to use external converter |
| `VSDX_RENDERER_TIMEOUT_MS` | `10000` | Per-conversion budget |
| `VSDX_MAX_BYTES` | `5242880` (5MB) | Upload size cap; protects against `.vsdx` payloads that would DoS unoserver |

### Engine model changes

`packages/shared/src/engines.ts`:

```ts
DiagramEngine = ...existing | "vsdx"
ENGINE_FAMILY.vsdx = "freeform"
KROKI_PATH.vsdx     // ✗ — not a Kroki engine; renderer dispatches to unoserver
```

`packages/shared/src/index.ts` — the `Diagram` type grows:

```ts
type Diagram = {
  id: string
  name: string
  engine: DiagramEngine
  kind: "graph" | "passthrough" | "binary"   // ← new variant
  ir?: GraphIR        // for kind=graph
  dsl?: string        // for kind=passthrough
  bytes?: Uint8Array  // for kind=binary
  meta: DiagramMeta
}
```

### Render pipeline changes

`packages/server/src/render.ts` gains a third branch:

```
renderDiagram(diagram)
  ├── kind=graph        → IrRenderer → DSL → Kroki → SVG
  ├── kind=passthrough  → DSL → Kroki → SVG
  └── kind=binary       → bytes → unoserver → SVG    ← NEW
```

New file: `packages/server/src/renderers/vsdx-render.ts` — HTTP POSTs vsdx bytes to `VSDX_RENDERER_URL`, receives SVG, returns it. Uses the existing `LruSvgCache` keyed on `sha256(bytes)`.

### Write path (export)

`packages/web/src/lib/export.ts` grows a `"vsdx"` format. Server endpoint `POST /api/diagrams/:id/export.vsdx` returns the bytes. Three server-side strategies, selected by the diagram's `kind` and `engine`:

| Source | Strategy | File |
|---|---|---|
| `engine === "vsdx"` | Return stored `bytes` verbatim | Trivial — re-uses persisted bytes |
| `kind === "graph"` **with an IR-aware renderer registered** (today: `mermaid`; this cycle also extends to `d2` and `graphviz` — see below) | Walk IR → emit vsdx XML with positioned `<Shape>` + connectors. Layout coordinates come from graphviz `-Tjson` invoked on a translated DOT. | New: `packages/server/src/renderers/vsdx-writer.ts` |
| Everything else (sequence, chart, c4plantuml, structurizr, all currently-passthrough engines) | Rasterize stored SVG → PNG → embed inside minimal vsdx page wrapper | Same writer, image-fallback path |

**Note on graph-IR coverage**: today only Mermaid has an IR renderer in [`renderers/registry.ts`](packages/server/src/renderers/registry.ts). To deliver "broad" structured-vsdx output for the common graph engines, this cycle adds IR-extraction adapters for `d2` and `graphviz` so they can route through `vsdx-writer` too:

- **`graphviz`**: parse the user's DOT via graphviz's own `-Tjson` output (no new parser needed; graphviz emits a structured JSON layout). Map nodes/edges to IR.
- **`d2`**: D2 has a `--ast` JSON output we can shell out to.
- Other graph-family engines (c4plantuml, structurizr, blockdiag, nomnoml) stay on the image-embed path for v1 — their DSLs are more elaborate and would each need their own IR extractor.

This makes the structured-vsdx write path concretely cover three engines on day one: **Mermaid, D2, Graphviz**. The rest get image-embed (still a valid `.vsdx` file, just not Visio-editable shapes).

### Stencil coverage (day-one)

Day-one writer supports these mappings from IR node `shape` → Visio master:

**Basic Flowchart stencil** (matches IR `shape` hints from Mermaid/D2/Graphviz):

| IR `shape` | Visio master | Common in |
|---|---|---|
| `rect` / `process` | Process | flowchart default |
| `roundedRect` / `terminator` | Terminator | start/end |
| `diamond` / `decision` | Decision | conditionals |
| `parallelogram` / `data` | Data | I/O |
| `document` | Document | reports |
| `cylinder` / `database` | Stored Data | DB nodes |
| `cloud` | Cloud (Basic Shapes) | services |
| `subroutine` / `predefined` | Predefined Process | reusable steps |
| `manualInput` | Manual Input | user entry |
| `display` | Display | screen output |
| `connector` (small circle) | Connector | flow merge |
| `offPageConnector` | Off-page Connector | cross-page jumps |

**Basic Shapes stencil**:

| IR `shape` | Visio master |
|---|---|
| `circle` | Circle |
| `ellipse` | Ellipse |
| `triangle` | Triangle |
| `pentagon` | Pentagon |
| `hexagon` | Hexagon |
| `octagon` | Octagon |
| `star` | 5-Point Star |
| `arrow` | Right Arrow |

**Edges**: default connector (single arrowhead end). Dashed/double/labeled variants follow IR edge style hints. No spline routing — straight line plus right-angle elbow.

**Swim lanes / subgraphs**: rendered as `<Shape>` groups with `LineWeight` boundaries. Inner shapes have their position translated into the lane's local coordinate space. Mermaid `subgraph` and D2 containers map to this.

Anything not in the above tables falls back to a labeled rectangle with a comment annotation explaining the substitution. This is honest, doesn't silently lose information, and gives the user something to manually correct in Visio.

### Data model

`packages/server/migrations/<n>_add_vsdx_bytes.sql`:

```sql
ALTER TABLE diagrams ADD COLUMN bytes BYTEA NULL;
-- kind already TEXT NOT NULL; the application enforces "binary" → bytes NOT NULL
```

No schema change to `annotations` — annotations on a vsdx tile use the same SVG-bbox model as any other tile (the bbox refers to the rendered SVG, which is what's on the canvas).

### Upload pipeline

```
browser drag-drop .vsdx
  │
  ▼ POST /api/import (multipart, file part = .vsdx bytes)
http handler ─▶ validates extension + size + magic bytes (PK\x03\x04 ZIP)
              ─▶ creates diagram row (engine="vsdx", kind="binary", bytes=…)
              ─▶ calls renderDiagram() → unoserver → SVG
              ─▶ writes svg back to row
              ─▶ broadcasts on WS
              ─▶ returns { diagramId, slug }
```

The `/api/import` endpoint is also reachable from the MCP shim (so an AI host can ingest a vsdx the user pastes a path to). MCP tool wraps it.

## MCP surface

Two new tools, plus implicit `engine: "vsdx"` support in `create_diagram`:

### `import_vsdx`

```jsonc
{
  "name": "import_vsdx",
  "description": "Import a Microsoft Visio (.vsdx) file into the workspace. Renders natively via the server-side converter. Returns the new diagram ID.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "base64Source": { "type": "string", "description": "Base64-encoded vsdx file bytes" }
    },
    "required": ["name", "base64Source"]
  }
}
```

Returns: `{ diagramId, slug, render: { svg } }`.

### `analyze_vsdx`

```jsonc
{
  "name": "analyze_vsdx",
  "description": "Parse a previously-imported vsdx diagram into structured JSON (shapes, connectors, labels, layout). Use this as the input to your own translation step if the user asks to convert a Visio diagram into Mermaid/D2/BPMN.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "diagramId": { "type": "string" }
    },
    "required": ["diagramId"]
  }
}
```

Returns:

```ts
{
  pages: Array<{
    name: string
    shapes: Array<{
      id: string
      master: string   // e.g. "Process", "Decision"
      text: string
      x: number, y: number, w: number, h: number
    }>
    connectors: Array<{
      id: string
      from: string    // shape id
      to: string      // shape id
      text?: string
    }>
  }>
  metadata: { title?: string, author?: string, lastSaved?: string }
}
```

vsdx parsing lives in `packages/server/src/renderers/vsdx-parse.ts`. It's plain ZIP + XML; uses `jszip` (already a transitive dep) + a thin XML reader. No external service needed for parsing (only rendering goes through unoserver).

### `create_diagram` (existing, gains vsdx)

If `engine === "vsdx"` and no `bytes` are supplied, the call is rejected — `vsdx` diagrams must be created via `import_vsdx`. This keeps tool semantics clean (`create_diagram` does not take binary payloads).

## Web client changes

| Change | File |
|---|---|
| Drag-drop zone on canvas accepts `.vsdx` files, posts to `/api/import` | `packages/web/src/components/InfiniteCanvas.tsx` |
| Tile menu: "Download as VSDX" alongside existing SVG/PNG/JPEG | `packages/web/src/components/Tile.tsx` |
| Export utility: new `"vsdx"` branch that GETs `/api/diagrams/:id/export.vsdx` instead of converting in-browser | `packages/web/src/lib/export.ts` |
| Optional: "Convert to Mermaid" button on vsdx tiles (calls `analyze_vsdx` then prompts the user to ask the AI host to do the translation, since web UI itself has no LLM) | `packages/web/src/components/Tile.tsx` — deferred to v2 unless trivially small |

**No change** to `Tile.tsx` rendering itself, `AnnotationLayer.tsx`, `PublicViewToggle.tsx`, or the WebSocket protocol. Vsdx tiles broadcast SVG payloads the same way any other tile does.

## Component boundaries

```
┌── packages/shared
│   └── engines.ts          + "vsdx" engine, family
│       index.ts            + kind="binary", bytes? field on Diagram
│
├── packages/server
│   └── renderers/
│       ├── vsdx-render.ts  ← NEW: bytes → unoserver → SVG (cached)
│       ├── vsdx-writer.ts  ← NEW: IR → vsdx XML (graph engines)
│       └── vsdx-parse.ts   ← NEW: vsdx XML → structured JSON
│   render.ts               + binary branch dispatches to vsdx-render
│   mcp/tools.ts            + import_vsdx, analyze_vsdx
│   http/upload.ts          ← NEW: POST /api/import
│   http/export.ts          + GET /api/diagrams/:id/export.vsdx
│   db/diagrams.ts          + read/write bytes column
│   migrations/             + add bytes BYTEA
│
├── packages/web
│   └── components/
│       ├── InfiniteCanvas.tsx  + drag-drop accept .vsdx
│       └── Tile.tsx            + "Download as VSDX" menu item
│   lib/export.ts               + vsdx format branch
│
└── docker-compose.yaml     + prixmaviz-vsdx service
```

Each unit has one clear purpose, communicates over typed boundaries, and can be tested independently. The new server code is ~3 files (render, write, parse) plus 1 HTTP endpoint plus 2 MCP tool defs — fits comfortably in the existing renderer/registry pattern.

## Testing

| Layer | Test |
|---|---|
| `vsdx-render` | Given a fixture `.vsdx`, returns non-empty SVG within timeout. Cached on second call. |
| `vsdx-parse` | Given fixtures of 4 vsdx flavors (single-page flowchart, multi-page, swim-lane, basic-shapes-only), returns expected shape/connector counts and labels. |
| `vsdx-writer` (graph) | Given a Mermaid flowchart IR, the emitted vsdx round-trips through `vsdx-parse` and recovers the same shape/connector graph. |
| `vsdx-writer` (image fallback) | Given a sequence diagram, emitted vsdx contains a PNG with non-zero dimensions on page 1. |
| `vsdx-writer` (passthrough) | Given an imported vsdx diagram, the export equals the original bytes (byte-identical round-trip). |
| MCP `import_vsdx` | End-to-end: accepts base64, creates diagram, SVG returned. |
| MCP `analyze_vsdx` | Returns structured JSON matching the parse fixture. |
| Upload limits | `>VSDX_MAX_BYTES` rejected with 413. Non-vsdx file (wrong magic bytes) rejected with 400. |
| Renderer down | If `prixmaviz-vsdx` is unreachable, `/api/import` returns 503 (not 500) and the diagram row is not created. |

Integration test on the unoserver sidecar uses a checked-in `.vsdx` fixture (no live LibreOffice in unit tests).

## Risks and open questions

| Risk | Mitigation |
|---|---|
| **`unoserver` image stability**: the upstream image is community-maintained, not from a major vendor | Pin to a specific image digest. Vendored build recipe checked in so we can rebuild ourselves if upstream disappears. |
| **Per-conversion latency**: 200–500ms even warm; 5MB vsdx might hit several seconds | LRU cache absorbs repeat renders. WebSocket "rendering…" status frame keeps the UI honest about wait time. |
| **Stencil coverage gaps**: a Visio with engineering or network shapes will fall back to labeled rectangles | Substitution is logged and surfaced as an annotation on the tile. Honest about the limitation. |
| **Layout fidelity on write**: graphviz `-Tjson` coordinates are good for hierarchical layouts but mediocre for free-positioned diagrams | Day-one scope is graph engines only (mermaid, d2, graphviz). Sequence/chart/etc. fall back to image-embed — no layout to preserve. |
| **vsdx XML parser surface**: vsdx is a complex schema; we only parse a subset | `vsdx-parse` is best-effort and tolerant of unknown elements. Fixtures cover the common shape/edge/label cases; pathological files fall back to rendering-without-analysis (you can still see and export, just can't translate to Mermaid). |
| **DoS via crafted vsdx**: a malicious zip bomb could exhaust unoserver | `VSDX_MAX_BYTES` cap (5MB default) on upload. unoserver has its own resource limits we don't manage. |

## LOE

| Piece | Days |
|---|---|
| Engine/kind plumbing + shared types + DB migration | 1 |
| `unoserver` sidecar Dockerfile + compose wiring + healthcheck | 2 |
| `vsdx-render.ts` (binary → SVG via sidecar, cache integration) | 2 |
| `/api/import` upload endpoint + `import_vsdx` MCP tool | 2 |
| `vsdx-parse.ts` + `analyze_vsdx` MCP tool | 3 |
| `vsdx-writer.ts` (graph path, ~35-shape stencil mapping, graphviz layout integration) | 10 |
| `vsdx-writer.ts` (image-embed fallback) | 2 |
| `/api/diagrams/:id/export.vsdx` endpoint + client export wiring | 1 |
| Web drag-drop UX + tile download menu wiring | 2 |
| Tests (parse fixtures, writer round-trip, render, upload limits) | 4 |
| Docs (README section, MCP tool descriptions, fixture story) | 1 |
| **Total** | **~30 days / 6 calendar weeks (single dev)** |

## Out of scope (this cycle)

- **In-browser editing of vsdx**: users round-trip through Visio for edits, or convert to Mermaid via `analyze_vsdx` to edit in PrixmaViz
- **Server-side AI translation**: stays host-side, per Cycle 4 invariant
- **Visio Online integration / OneDrive sync**: not requested, large surface
- **`.vsd` (legacy binary format)**: unoserver supports it for read, but write is much harder; v1 is `.vsdx` only on both sides
- **Semantic annotations on vsdx tiles** (annotating "this shape" rather than "this region of the rendered SVG"): blocked on the same annotation-schema rework needed for Mol* later
