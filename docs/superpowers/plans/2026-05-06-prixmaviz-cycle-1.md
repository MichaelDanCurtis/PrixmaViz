# PrixmaViz Cycle 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Cycle 1 of PrixmaViz: AI agents create, modify, persist, and recall diagrams via 6 MCP tools, viewed in a Tauri-shelled webview that animates patches stepwise via Framer Motion.

**Architecture:** Bun is canonical server (HTTP+WS+Kroki+IR+MCP). Tauri shell is optional — wraps webview, manages Bun sidecar via Tauri externalBin sidecar pattern. Webview (React + motion) connects to Bun on localhost. .pviz files (JSON) persist in `<project>/.prixmaviz/diagrams/`. Mermaid is the only graph-family IR renderer in v1; the other 27 Kroki engines pass through raw DSL.

**Tech Stack:** Bun 1.3+, TypeScript 5.6+, React 18, Vite 5, motion 11, Tauri 2 (Rust), Kroki (HTTP). Test runners: `bun test` for server, Vitest for web.

**Spec reference:** `docs/superpowers/specs/2026-05-06-prixmaviz-cycle-1-design.md` (commit `ad379f4`).

**Existing prototype:** ~30% of Cycle 1 surface is scaffolded. Reused: workspaces, tsconfig, Vite config, embed system, basic Bun.serve skeleton. Refactored: server `index.ts`, `kroki.ts`, web `App.tsx`. Deleted: `state.ts` (annotations are Cycle 2). New: IR engine, MCP server, Tauri shell, persistence, library UI.

---

## File Structure

### packages/shared/src/

| File | Responsibility |
|---|---|
| `engines.ts` | `DiagramEngine` union, `ENGINE_FAMILY`, `KROKI_PATH` map |
| `ir.ts` | `Diagram`, `GraphIR`, `Node`, `Edge`, `Group`, `Layout`, `DiagramMeta`, ID brands |
| `patches.ts` | `PatchOp` discriminated union |
| `protocol.ts` | WS messages: `ServerToClient`, `ClientToServer`, render request/response types |
| `index.ts` | Re-exports |

### packages/server/src/

| File | Responsibility |
|---|---|
| `args.ts` | CLI flag parsing (`--port`, `--project-root`, `--mcp`) |
| `bootstrap.ts` | Project root resolution, `.prixmaviz/` directory creation |
| `ir/clone.ts` | Structured deep clone of `GraphIR` |
| `ir/validate.ts` | Patch op validators (one per op) |
| `ir/engine.ts` | `applyPatch(ir, ops): { ir, warnings }` atomic |
| `renderers/registry.ts` | Engine → renderer lookup |
| `renderers/mermaid.ts` | `irToMermaid(ir): { dsl, warnings }` |
| `kroki/cache.ts` | LRU keyed by sha256(engine+dsl) |
| `kroki/client.ts` | `renderViaKroki(req, cache): Promise<RenderResponse>` |
| `pviz/slug.ts` | `slugify(name): string`, conflict resolution |
| `pviz/io.ts` | Read/write `.pviz` + sibling `.svg` |
| `pviz/watch.ts` | `fs.watch` on diagrams dir, emits library-change events |
| `store/diagrams.ts` | In-memory diagram registry, lifecycle |
| `http/routes.ts` | Express-style route table for HTTP API |
| `ws/broadcast.ts` | Typed WS broadcast helper, socket registry |
| `mcp/server.ts` | MCP stdio server entry, tool registry |
| `mcp/tools.ts` | The 6 tool implementations |
| `mcp/lockfile.ts` | `.prixmaviz/state/instance.json` write/read |
| `mcp/forward.ts` | Forward calls to running instance via HTTP |
| `static.ts` | Embedded asset serving (existing `embedded.ts` pattern) |
| `index.ts` | Top-level entry, orchestrates server start in normal vs --mcp mode |
| `embedded.ts` | (generated) |

### packages/server/scripts/

| File | Responsibility |
|---|---|
| `gen-embed.ts` | (existing) embeds `packages/web/dist/` into binary |

### packages/server/test/

| File | Responsibility |
|---|---|
| `ir/clone.test.ts` | Clone semantics |
| `ir/validate.test.ts` | Patch validation per op |
| `ir/engine.test.ts` | Atomic apply, cascading remove |
| `renderers/mermaid.test.ts` | Snapshot fixtures |
| `kroki/cache.test.ts` | LRU eviction |
| `pviz/slug.test.ts` | Slug + conflict |
| `pviz/io.test.ts` | Roundtrip read/write |
| `store/diagrams.test.ts` | Registry semantics |
| `http/routes.test.ts` | Endpoint integration |
| `mcp/tools.test.ts` | Tool dispatch |

### packages/web/src/

| File | Responsibility |
|---|---|
| `App.tsx` | Top-level shell, layout |
| `main.tsx` | React root (existing) |
| `styles.css` | Theme (existing, lightly extended) |
| `lib/svg-diff.ts` | Parse SVG, diff prev/next nodes by id |
| `lib/mermaid-ids.ts` | Extract IR node id from Mermaid SVG id |
| `lib/api.ts` | HTTP fetch helpers |
| `lib/ws.ts` | WS hook with auto-reconnect |
| `store/index.ts` | Zustand store: diagrams, current, library |
| `components/Topbar.tsx` | Title, engine select, save button, ws status |
| `components/Library.tsx` | Sidebar with thumbnails + search |
| `components/Canvas.tsx` | Wraps DiagramView with viewport background |
| `components/DiagramView.tsx` | Motion-animated SVG render |
| `components/DslEditor.tsx` | Textarea (right pane) |
| `components/EmptyState.tsx` | Placeholder when no diagram |
| `components/ErrorPanel.tsx` | Render error display |

### packages/web/test/

| File | Responsibility |
|---|---|
| `lib/svg-diff.test.ts` | Diff correctness |
| `lib/mermaid-ids.test.ts` | ID extraction |
| `store/index.test.ts` | State transitions |

### src-tauri/

| File | Responsibility |
|---|---|
| `Cargo.toml` | Rust deps |
| `tauri.conf.json` | Tauri config |
| `src/main.rs` | Sidecar lifecycle, window setup |
| `binaries/` | Per-target Bun sidecar (gitignored, built by CI) |
| `icons/` | App icons (placeholder for now) |

### Files deleted

- `packages/server/src/state.ts` — annotation state, Cycle 2 only
- `packages/web/src/samples.ts` — kept temporarily as test fixture, deleted after Wave 4

---

## Implementation Waves

The plan organizes into 7 waves. Each wave produces working, testable software:

| Wave | Theme | Tasks |
|---|---|---|
| 1 | Workspace prep + IR types | 1-3 |
| 2 | IR engine (clone, validate, apply) | 4-6 |
| 3 | Renderers + Kroki cache | 7-10 |
| 4 | Persistence (slug, .pviz, watch, store) | 11-15 |
| 5 | Bun server (HTTP/WS/static, no MCP yet) | 16-21 |
| 6 | Web UI (rebuild on the new server) | 22-30 |
| 7 | MCP server | 31-36 |
| 8 | Tauri shell | 37-41 |
| 9 | Smoke test + acceptance | 42-43 |

---

## Wave 1 — Workspace prep + IR types

### Task 1: Add Bun test runner config + install Vitest

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`

- [ ] **Step 1: Add `bun test` glob pattern to server package.json**

Edit `packages/server/package.json`. Add `"test": "bun test"` to `scripts`:

```json
{
  "name": "@prixmaviz/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test",
    "embed": "bun scripts/gen-embed.ts",
    "build:bin": "bun run embed && bun build ./src/index.ts --compile --outfile ../../dist/prixmaviz",
    "build:bin:linux-x64": "bun run embed && bun build ./src/index.ts --compile --target=bun-linux-x64 --outfile ../../dist/prixmaviz-linux-x64",
    "build:bin:darwin-arm64": "bun run embed && bun build ./src/index.ts --compile --target=bun-darwin-arm64 --outfile ../../dist/prixmaviz-darwin-arm64",
    "build:bin:darwin-x64": "bun run embed && bun build ./src/index.ts --compile --target=bun-darwin-x64 --outfile ../../dist/prixmaviz-darwin-x64",
    "build:bin:windows-x64": "bun run embed && bun build ./src/index.ts --compile --target=bun-windows-x64 --outfile ../../dist/prixmaviz-windows-x64.exe"
  },
  "dependencies": {
    "@prixmaviz/shared": "workspace:*"
  }
}
```

- [ ] **Step 2: Add Vitest to web package**

Edit `packages/web/package.json`:

```json
{
  "name": "@prixmaviz/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@prixmaviz/shared": "workspace:*",
    "motion": "^11.11.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.4"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "happy-dom": "^15.7.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create Vitest config**

Create `packages/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
  },
});
```

- [ ] **Step 4: Install + verify**

Run from repo root:
```
bun install
```
Expected: succeeds; `node_modules` contains zustand, vitest, happy-dom.

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json packages/web/package.json packages/web/vitest.config.ts
git commit -m "chore: add test runners (bun test, vitest)"
```

---

### Task 2: Define `DiagramEngine` + engine families in shared

**Files:**
- Create: `packages/shared/src/engines.ts`

- [ ] **Step 1: Write `engines.ts`**

Create `packages/shared/src/engines.ts`:

```ts
export type DiagramEngine =
  | "actdiag" | "blockdiag" | "bpmn" | "bytefield"
  | "c4plantuml" | "d2" | "dbml" | "diagramsnet"
  | "ditaa" | "erd" | "excalidraw" | "graphviz"
  | "mermaid" | "nomnoml" | "nwdiag" | "packetdiag"
  | "pikchr" | "plantuml" | "rackdiag" | "seqdiag"
  | "structurizr" | "svgbob" | "symbolator" | "tikz"
  | "umlet" | "vega" | "vegalite" | "wavedrom" | "wireviz";

export type EngineFamily =
  | "graph" | "sequence" | "er" | "process"
  | "signal" | "chart" | "freeform" | "network";

export const ENGINE_FAMILY: Record<DiagramEngine, EngineFamily> = {
  mermaid: "graph",
  d2: "graph",
  graphviz: "graph",
  blockdiag: "graph",
  nomnoml: "graph",
  c4plantuml: "graph",
  structurizr: "graph",
  plantuml: "sequence",
  seqdiag: "sequence",
  erd: "er",
  dbml: "er",
  bpmn: "process",
  actdiag: "process",
  wavedrom: "signal",
  packetdiag: "signal",
  bytefield: "signal",
  vega: "chart",
  vegalite: "chart",
  tikz: "freeform",
  excalidraw: "freeform",
  ditaa: "freeform",
  svgbob: "freeform",
  pikchr: "freeform",
  diagramsnet: "freeform",
  symbolator: "freeform",
  umlet: "freeform",
  nwdiag: "network",
  rackdiag: "network",
  wireviz: "freeform",
};

export const KROKI_PATH: Record<DiagramEngine, string> = {
  actdiag: "actdiag", blockdiag: "blockdiag", bpmn: "bpmn",
  bytefield: "bytefield", c4plantuml: "c4plantuml", d2: "d2",
  dbml: "dbml", diagramsnet: "diagramsnet", ditaa: "ditaa",
  erd: "erd", excalidraw: "excalidraw", graphviz: "graphviz",
  mermaid: "mermaid", nomnoml: "nomnoml", nwdiag: "nwdiag",
  packetdiag: "packetdiag", pikchr: "pikchr", plantuml: "plantuml",
  rackdiag: "rackdiag", seqdiag: "seqdiag", structurizr: "structurizr",
  svgbob: "svgbob", symbolator: "symbolator", tikz: "tikz",
  umlet: "umlet", vega: "vega", vegalite: "vegalite",
  wavedrom: "wavedrom", wireviz: "wireviz",
};

export const ALL_ENGINES = Object.keys(ENGINE_FAMILY) as DiagramEngine[];

export function inferKind(engine: DiagramEngine): "graph" | "passthrough" {
  return ENGINE_FAMILY[engine] === "graph" ? "graph" : "passthrough";
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/engines.ts
git commit -m "feat(shared): add DiagramEngine + family/kroki tables"
```

---

### Task 3: Define IR types + Diagram envelope + PatchOp + Protocol

**Files:**
- Create: `packages/shared/src/ir.ts`
- Create: `packages/shared/src/patches.ts`
- Create: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write `ir.ts`**

Create `packages/shared/src/ir.ts`:

```ts
import type { DiagramEngine } from "./engines";

export type NodeId = string;
export type EdgeId = string;
export type GroupId = string;
export type DiagramId = string;

export type NodeShape =
  | "rect" | "round" | "circle" | "diamond" | "hex" | "cyl";

export type EdgeKind = "solid" | "dashed" | "dotted" | "thick";
export type EdgeArrow = "normal" | "open" | "none";

export type LayoutDirection = "LR" | "RL" | "TB" | "BT";

export interface Node {
  id: NodeId;
  label: string;
  shape?: NodeShape;
  attrs?: Record<string, unknown>;
  groupId?: GroupId;
}

export interface Edge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  label?: string;
  kind?: EdgeKind;
  arrow?: EdgeArrow;
  attrs?: Record<string, unknown>;
}

export interface Group {
  id: GroupId;
  label: string;
  members: NodeId[];
  parent?: GroupId;
  attrs?: Record<string, unknown>;
}

export interface Layout {
  direction: LayoutDirection;
  spacing?: number;
  theme?: string;
}

export interface GraphIR {
  nodes: Record<NodeId, Node>;
  edges: Record<EdgeId, Edge>;
  groups: Record<GroupId, Group>;
  layout: Layout;
}

export type DiagramKind = "graph" | "passthrough";

export interface DiagramMeta {
  createdAt: string;
  updatedAt: string;
  tags: string[];
  sourcePaths: string[];
}

export interface Diagram {
  id: DiagramId;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  meta: DiagramMeta;
}

export const PVIZ_VERSION = 1;

export interface PvizFile {
  version: typeof PVIZ_VERSION;
  id: DiagramId;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  meta: DiagramMeta;
}

export function emptyGraphIR(direction: LayoutDirection = "LR"): GraphIR {
  return {
    nodes: {},
    edges: {},
    groups: {},
    layout: { direction },
  };
}

export function emptyMeta(now: string = new Date().toISOString()): DiagramMeta {
  return {
    createdAt: now,
    updatedAt: now,
    tags: [],
    sourcePaths: [],
  };
}
```

- [ ] **Step 2: Write `patches.ts`**

Create `packages/shared/src/patches.ts`:

```ts
import type {
  Edge, EdgeId, Group, GroupId, Layout, Node, NodeId,
} from "./ir";

export type PatchOp =
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

export type PatchOpType = PatchOp["op"];
```

- [ ] **Step 3: Write `protocol.ts`**

Create `packages/shared/src/protocol.ts`:

```ts
import type { DiagramEngine } from "./engines";
import type { Diagram, DiagramId, GraphIR } from "./ir";
import type { PatchOp } from "./patches";

export interface RenderResult {
  svg: string;
  dsl: string;
}

export interface ApplyPatchResponse {
  diagramId: DiagramId;
  ir: GraphIR;
  render: RenderResult;
  warnings?: string[];
}

export interface CreateDiagramRequest {
  name: string;
  engine: DiagramEngine;
  kind?: "graph" | "passthrough";
  initialDsl?: string;
}

export interface CreateDiagramResponse {
  diagramId: DiagramId;
  render: RenderResult;
}

export interface RenderDslRequest {
  engine: DiagramEngine;
  source: string;
  name?: string;
}

export interface RenderDslResponse {
  diagramId: DiagramId;
  render: RenderResult;
}

export interface LibraryEntry {
  name: string;
  path: string;
  engine: DiagramEngine;
  kind: "graph" | "passthrough";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type ServerToClient =
  | { type: "render"; diagramId: DiagramId; ir?: GraphIR; dsl: string; svg: string; warnings?: string[] }
  | { type: "library"; entries: LibraryEntry[] }
  | { type: "diagram"; diagram: Diagram }
  | { type: "error"; message: string };

export type ClientToServer =
  | { type: "open"; diagramId: DiagramId }
  | { type: "patch"; diagramId: DiagramId; ops: PatchOp[] }
  | { type: "ping" };
```

- [ ] **Step 4: Replace `shared/src/index.ts` with re-exports**

Overwrite `packages/shared/src/index.ts`:

```ts
export * from "./engines";
export * from "./ir";
export * from "./patches";
export * from "./protocol";
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```
bun --filter @prixmaviz/shared exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ir.ts packages/shared/src/patches.ts packages/shared/src/protocol.ts packages/shared/src/index.ts
git commit -m "feat(shared): IR types, patch ops, WS protocol"
```

---

## Wave 2 — IR engine

### Task 4: IR deep clone

**Files:**
- Create: `packages/server/src/ir/clone.ts`
- Create: `packages/server/test/ir/clone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/ir/clone.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { cloneIR } from "../../src/ir/clone";
import type { GraphIR } from "@prixmaviz/shared";

describe("cloneIR", () => {
  it("returns a structurally equal but distinct object", () => {
    const ir: GraphIR = {
      nodes: { a: { id: "a", label: "A", attrs: { color: "red" } } },
      edges: { e1: { id: "e1", from: "a", to: "a" } },
      groups: { g1: { id: "g1", label: "G", members: ["a"] } },
      layout: { direction: "LR" },
    };
    const c = cloneIR(ir);
    expect(c).toEqual(ir);
    expect(c).not.toBe(ir);
    expect(c.nodes).not.toBe(ir.nodes);
    expect(c.nodes.a).not.toBe(ir.nodes.a);
    expect(c.nodes.a.attrs).not.toBe(ir.nodes.a.attrs);
    expect(c.groups.g1.members).not.toBe(ir.groups.g1.members);
  });

  it("survives mutation of clone without touching original", () => {
    const ir: GraphIR = {
      nodes: { a: { id: "a", label: "A" } },
      edges: {},
      groups: {},
      layout: { direction: "LR" },
    };
    const c = cloneIR(ir);
    c.nodes.b = { id: "b", label: "B" };
    expect(ir.nodes.b).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/server && bun test test/ir/clone.test.ts
```
Expected: FAIL — module `../../src/ir/clone` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/src/ir/clone.ts`:

```ts
import type { GraphIR } from "@prixmaviz/shared";

export function cloneIR(ir: GraphIR): GraphIR {
  return structuredClone(ir);
}
```

- [ ] **Step 4: Run test to verify it passes**

```
bun test test/ir/clone.test.ts
```
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ir/clone.ts packages/server/test/ir/clone.test.ts
git commit -m "feat(ir): deep clone helper"
```

---

### Task 5: Patch validation rules

**Files:**
- Create: `packages/server/src/ir/validate.ts`
- Create: `packages/server/test/ir/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/ir/validate.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { validateOp } from "../../src/ir/validate";
import { emptyGraphIR } from "@prixmaviz/shared";

describe("validateOp", () => {
  it("rejects add_node when id already exists", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    const err = validateOp(ir, { op: "add_node", node: { id: "a", label: "A" } });
    expect(err).toMatch(/exists/);
  });

  it("rejects add_edge with missing from", () => {
    const ir = emptyGraphIR();
    ir.nodes.b = { id: "b", label: "B" };
    const err = validateOp(ir, {
      op: "add_edge",
      edge: { id: "e1", from: "a", to: "b" },
    });
    expect(err).toMatch(/from.*missing/);
  });

  it("rejects update_node when id missing", () => {
    const ir = emptyGraphIR();
    const err = validateOp(ir, { op: "update_node", id: "x", patch: { label: "Y" } });
    expect(err).toMatch(/missing/);
  });

  it("accepts add_node with new id", () => {
    const ir = emptyGraphIR();
    expect(validateOp(ir, { op: "add_node", node: { id: "a", label: "A" } })).toBeNull();
  });

  it("accepts remove_node even with edges (cascade handled in engine)", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    expect(validateOp(ir, { op: "remove_node", id: "a" })).toBeNull();
  });

  it("rejects add_group with members referencing missing nodes", () => {
    const ir = emptyGraphIR();
    const err = validateOp(ir, {
      op: "add_group",
      group: { id: "g", label: "G", members: ["a"] },
    });
    expect(err).toMatch(/member.*missing/);
  });

  it("accepts set_layout with partial patch", () => {
    const ir = emptyGraphIR();
    expect(validateOp(ir, { op: "set_layout", patch: { direction: "TB" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test test/ir/validate.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/ir/validate.ts`:

```ts
import type { GraphIR, PatchOp } from "@prixmaviz/shared";

export function validateOp(ir: GraphIR, op: PatchOp): string | null {
  switch (op.op) {
    case "add_node":
      if (ir.nodes[op.node.id]) return `node "${op.node.id}" exists`;
      if (op.node.groupId && !ir.groups[op.node.groupId])
        return `groupId "${op.node.groupId}" missing`;
      return null;

    case "update_node":
      if (!ir.nodes[op.id]) return `node "${op.id}" missing`;
      return null;

    case "remove_node":
      if (!ir.nodes[op.id]) return `node "${op.id}" missing`;
      return null;

    case "add_edge":
      if (ir.edges[op.edge.id]) return `edge "${op.edge.id}" exists`;
      if (!ir.nodes[op.edge.from]) return `edge from "${op.edge.from}" missing`;
      if (!ir.nodes[op.edge.to]) return `edge to "${op.edge.to}" missing`;
      return null;

    case "update_edge":
      if (!ir.edges[op.id]) return `edge "${op.id}" missing`;
      return null;

    case "remove_edge":
      if (!ir.edges[op.id]) return `edge "${op.id}" missing`;
      return null;

    case "add_group":
      if (ir.groups[op.group.id]) return `group "${op.group.id}" exists`;
      for (const m of op.group.members) {
        if (!ir.nodes[m]) return `group member "${m}" missing`;
      }
      if (op.group.parent && !ir.groups[op.group.parent])
        return `parent group "${op.group.parent}" missing`;
      return null;

    case "update_group":
      if (!ir.groups[op.id]) return `group "${op.id}" missing`;
      return null;

    case "remove_group":
      if (!ir.groups[op.id]) return `group "${op.id}" missing`;
      return null;

    case "set_layout":
      return null;

    case "set_meta":
      return null;
  }
}
```

- [ ] **Step 4: Run test**

```
bun test test/ir/validate.test.ts
```
Expected: PASS 7/7.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ir/validate.ts packages/server/test/ir/validate.test.ts
git commit -m "feat(ir): patch op validation"
```

---

### Task 6: IR mutation engine (atomic apply)

**Files:**
- Create: `packages/server/src/ir/engine.ts`
- Create: `packages/server/test/ir/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/ir/engine.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { applyPatch } from "../../src/ir/engine";
import { emptyGraphIR } from "@prixmaviz/shared";
import type { GraphIR } from "@prixmaviz/shared";

describe("applyPatch", () => {
  it("applies multiple ops atomically", () => {
    const ir = emptyGraphIR();
    const result = applyPatch(ir, [
      { op: "add_node", node: { id: "a", label: "A" } },
      { op: "add_node", node: { id: "b", label: "B" } },
      { op: "add_edge", edge: { id: "e1", from: "a", to: "b" } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.ir.nodes)).toEqual(["a", "b"]);
      expect(Object.keys(result.ir.edges)).toEqual(["e1"]);
    }
  });

  it("rejects whole batch if one op invalid; original ir untouched", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    const result = applyPatch(ir, [
      { op: "add_node", node: { id: "b", label: "B" } },
      { op: "add_node", node: { id: "a", label: "Dup" } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.opIndex).toBe(1);
      expect(result.error).toMatch(/exists/);
    }
    expect(ir.nodes.b).toBeUndefined();
  });

  it("cascades remove_node to its edges", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    ir.nodes.b = { id: "b", label: "B" };
    ir.edges.e1 = { id: "e1", from: "a", to: "b" };
    ir.edges.e2 = { id: "e2", from: "b", to: "a" };
    const result = applyPatch(ir, [{ op: "remove_node", id: "a" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.ir.edges)).toEqual([]);
      expect(Object.keys(result.ir.nodes)).toEqual(["b"]);
    }
  });

  it("removes node from group members on remove_node", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    ir.nodes.b = { id: "b", label: "B" };
    ir.groups.g1 = { id: "g1", label: "G", members: ["a", "b"] };
    const result = applyPatch(ir, [{ op: "remove_node", id: "a" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.groups.g1.members).toEqual(["b"]);
    }
  });

  it("update_node merges patch", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A", shape: "rect" };
    const result = applyPatch(ir, [
      { op: "update_node", id: "a", patch: { label: "AA" } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.nodes.a.label).toBe("AA");
      expect(result.ir.nodes.a.shape).toBe("rect");
    }
  });

  it("set_layout merges direction", () => {
    const ir = emptyGraphIR("LR");
    const result = applyPatch(ir, [
      { op: "set_layout", patch: { direction: "TB", spacing: 40 } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ir.layout.direction).toBe("TB");
      expect(result.ir.layout.spacing).toBe(40);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test test/ir/engine.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/ir/engine.ts`:

```ts
import type { GraphIR, PatchOp } from "@prixmaviz/shared";
import { cloneIR } from "./clone";
import { validateOp } from "./validate";

export type ApplyResult =
  | { ok: true; ir: GraphIR; warnings: string[] }
  | { ok: false; error: string; opIndex: number };

export function applyPatch(ir: GraphIR, ops: PatchOp[]): ApplyResult {
  const draft = cloneIR(ir);
  const warnings: string[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const err = validateOp(draft, op);
    if (err) return { ok: false, error: err, opIndex: i };
    applyOp(draft, op);
  }

  return { ok: true, ir: draft, warnings };
}

function applyOp(ir: GraphIR, op: PatchOp): void {
  switch (op.op) {
    case "add_node":
      ir.nodes[op.node.id] = { ...op.node };
      break;

    case "update_node":
      ir.nodes[op.id] = { ...ir.nodes[op.id]!, ...op.patch, id: op.id };
      break;

    case "remove_node": {
      delete ir.nodes[op.id];
      for (const eid of Object.keys(ir.edges)) {
        const e = ir.edges[eid]!;
        if (e.from === op.id || e.to === op.id) delete ir.edges[eid];
      }
      for (const gid of Object.keys(ir.groups)) {
        const g = ir.groups[gid]!;
        const filtered = g.members.filter((m) => m !== op.id);
        if (filtered.length !== g.members.length) {
          ir.groups[gid] = { ...g, members: filtered };
        }
      }
      break;
    }

    case "add_edge":
      ir.edges[op.edge.id] = { ...op.edge };
      break;

    case "update_edge":
      ir.edges[op.id] = { ...ir.edges[op.id]!, ...op.patch, id: op.id };
      break;

    case "remove_edge":
      delete ir.edges[op.id];
      break;

    case "add_group":
      ir.groups[op.group.id] = {
        ...op.group,
        members: [...op.group.members],
      };
      break;

    case "update_group":
      ir.groups[op.id] = { ...ir.groups[op.id]!, ...op.patch, id: op.id };
      break;

    case "remove_group": {
      const g = ir.groups[op.id]!;
      delete ir.groups[op.id];
      for (const mid of g.members) {
        const node = ir.nodes[mid];
        if (node?.groupId === op.id) {
          ir.nodes[mid] = { ...node, groupId: undefined };
        }
      }
      break;
    }

    case "set_layout":
      ir.layout = { ...ir.layout, ...op.patch };
      break;

    case "set_meta":
      break;
  }
}
```

- [ ] **Step 4: Run test**

```
bun test test/ir/engine.test.ts
```
Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ir/engine.ts packages/server/test/ir/engine.test.ts
git commit -m "feat(ir): atomic patch application engine"
```

---

## Wave 3 — Renderers + Kroki cache

### Task 7: IR-to-Mermaid renderer

**Files:**
- Create: `packages/server/src/renderers/mermaid.ts`
- Create: `packages/server/test/renderers/mermaid.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/renderers/mermaid.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { irToMermaid } from "../../src/renderers/mermaid";
import { emptyGraphIR } from "@prixmaviz/shared";

describe("irToMermaid", () => {
  it("emits flowchart with direction", () => {
    const ir = emptyGraphIR("TB");
    const out = irToMermaid(ir);
    expect(out.dsl.split("\n")[0]).toBe("flowchart TB");
  });

  it("emits ungrouped nodes with shapes", () => {
    const ir = emptyGraphIR("LR");
    ir.nodes.a = { id: "a", label: "A", shape: "rect" };
    ir.nodes.b = { id: "b", label: "B", shape: "round" };
    ir.nodes.c = { id: "c", label: "C", shape: "diamond" };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain("a[A]");
    expect(out.dsl).toContain("b(B)");
    expect(out.dsl).toContain("c{C}");
  });

  it("emits edges with labels and kinds", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A" };
    ir.nodes.b = { id: "b", label: "B" };
    ir.edges.e1 = { id: "e1", from: "a", to: "b", label: "go", kind: "dashed" };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain("a -.->|go| b");
  });

  it("emits subgraphs for groups", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A", groupId: "g1" };
    ir.groups.g1 = { id: "g1", label: "Backend", members: ["a"] };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain("subgraph g1[Backend]");
    expect(out.dsl).toContain("end");
  });

  it("escapes labels containing brackets", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A[1]" };
    const out = irToMermaid(ir);
    expect(out.dsl).toContain('a["A[1]"]');
  });

  it("warns on unknown shape, falls back to rect", () => {
    const ir = emptyGraphIR();
    ir.nodes.a = { id: "a", label: "A", shape: "wat" as never };
    const out = irToMermaid(ir);
    expect(out.warnings.some((w) => /shape.*wat/.test(w))).toBe(true);
    expect(out.dsl).toContain("a[A]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test test/renderers/mermaid.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/renderers/mermaid.ts`:

```ts
import type { Edge, GraphIR, Node, NodeShape } from "@prixmaviz/shared";

export interface RenderOutput {
  dsl: string;
  warnings: string[];
}

const SHAPE_BRACKETS: Record<NodeShape, [string, string]> = {
  rect: ["[", "]"],
  round: ["(", ")"],
  circle: ["((", "))"],
  diamond: ["{", "}"],
  hex: ["{{", "}}"],
  cyl: ["[(", ")]"],
};

export function irToMermaid(ir: GraphIR): RenderOutput {
  const warnings: string[] = [];
  const lines: string[] = [`flowchart ${ir.layout.direction}`];

  const groupedNodeIds = new Set<string>();

  for (const g of Object.values(ir.groups)) {
    lines.push(`  subgraph ${g.id}[${escapeText(g.label)}]`);
    for (const nid of g.members) {
      const node = ir.nodes[nid];
      if (node) {
        lines.push(`    ${emitNode(node, warnings)}`);
        groupedNodeIds.add(nid);
      }
    }
    lines.push("  end");
  }

  for (const node of Object.values(ir.nodes)) {
    if (!groupedNodeIds.has(node.id)) lines.push(`  ${emitNode(node, warnings)}`);
  }

  for (const edge of Object.values(ir.edges)) {
    lines.push(`  ${emitEdge(edge)}`);
  }

  return { dsl: lines.join("\n"), warnings };
}

function emitNode(node: Node, warnings: string[]): string {
  const shape: NodeShape = node.shape ?? "rect";
  const brackets = SHAPE_BRACKETS[shape];
  if (!brackets) {
    warnings.push(`shape "${node.shape}" not supported, fell back to rect`);
    const [open, close] = SHAPE_BRACKETS.rect;
    return `${node.id}${open}${labelText(node.label)}${close}`;
  }
  const [open, close] = brackets;
  return `${node.id}${open}${labelText(node.label)}${close}`;
}

function emitEdge(edge: Edge): string {
  const op = edgeOp(edge.kind ?? "solid", edge.arrow ?? "normal");
  const label = edge.label ? `|${escapeText(edge.label)}|` : "";
  return `${edge.from} ${op}${label} ${edge.to}`;
}

function edgeOp(kind: string, arrow: string): string {
  const head = arrow === "none" ? "" : arrow === "open" ? "-" : ">";
  switch (kind) {
    case "dashed":
      return `-.-${head}`;
    case "dotted":
      return `-.-${head}`;
    case "thick":
      return `==${head}`;
    case "solid":
    default:
      return `--${head}`;
  }
}

function labelText(s: string): string {
  if (/[\[\](){}|"]/.test(s)) return `"${escapeText(s)}"`;
  return escapeText(s);
}

function escapeText(s: string): string {
  return s.replace(/"/g, '\\"');
}
```

- [ ] **Step 4: Run test**

```
bun test test/renderers/mermaid.test.ts
```
Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/renderers/mermaid.ts packages/server/test/renderers/mermaid.test.ts
git commit -m "feat(renderers): IR-to-Mermaid"
```

---

### Task 8: Renderer registry

**Files:**
- Create: `packages/server/src/renderers/registry.ts`

- [ ] **Step 1: Write `registry.ts`**

Create `packages/server/src/renderers/registry.ts`:

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/renderers/registry.ts
git commit -m "feat(renderers): registry stub (mermaid only)"
```

---

### Task 9: Kroki SVG LRU cache

**Files:**
- Create: `packages/server/src/kroki/cache.ts`
- Create: `packages/server/test/kroki/cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/kroki/cache.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { LruSvgCache } from "../../src/kroki/cache";

describe("LruSvgCache", () => {
  it("returns undefined on miss", () => {
    const c = new LruSvgCache(1024);
    expect(c.get("key")).toBeUndefined();
  });

  it("returns set value", () => {
    const c = new LruSvgCache(1024);
    c.set("k", "<svg/>");
    expect(c.get("k")).toBe("<svg/>");
  });

  it("evicts least-recently-used when over budget", () => {
    const c = new LruSvgCache(20);
    c.set("a", "0123456789"); // 10 bytes
    c.set("b", "0123456789"); // 10 bytes (cache full)
    c.set("c", "0123456789"); // forces eviction of a
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe("0123456789");
    expect(c.get("c")).toBe("0123456789");
  });

  it("get bumps recency", () => {
    const c = new LruSvgCache(20);
    c.set("a", "0123456789");
    c.set("b", "0123456789");
    c.get("a");
    c.set("c", "0123456789"); // should evict b, not a
    expect(c.get("a")).toBeDefined();
    expect(c.get("b")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```
bun test test/kroki/cache.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/kroki/cache.ts`:

```ts
export class LruSvgCache {
  private map = new Map<string, string>();
  private currentSize = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: string): void {
    if (this.map.has(key)) {
      this.currentSize -= this.map.get(key)!.length;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.currentSize += value.length;
    while (this.currentSize > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value as string;
      this.currentSize -= this.map.get(oldest)!.length;
      this.map.delete(oldest);
    }
  }

  size(): number {
    return this.currentSize;
  }
}

export function svgCacheKey(engine: string, dsl: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(engine);
  hasher.update("\0");
  hasher.update(dsl);
  return hasher.digest("hex");
}
```

- [ ] **Step 4: Run test**

```
bun test test/kroki/cache.test.ts
```
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/kroki/cache.ts packages/server/test/kroki/cache.test.ts
git commit -m "feat(kroki): SVG LRU cache"
```

---

### Task 10: Kroki client refactor with cache

**Files:**
- Modify: `packages/server/src/kroki.ts` → move to `packages/server/src/kroki/client.ts`
- Delete: `packages/server/src/kroki.ts`

- [ ] **Step 1: Write the new client**

Create `packages/server/src/kroki/client.ts`:

```ts
import type { DiagramEngine } from "@prixmaviz/shared";
import { KROKI_PATH } from "@prixmaviz/shared";
import { LruSvgCache, svgCacheKey } from "./cache";

const DEFAULT_BASE = "https://kroki.io";

export interface KrokiClientOptions {
  baseUrl?: string;
  cache?: LruSvgCache;
}

export class KrokiClient {
  private readonly baseUrl: string;
  private readonly cache: LruSvgCache;

  constructor(opts: KrokiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.KROKI_URL ?? DEFAULT_BASE;
    this.cache = opts.cache ?? new LruSvgCache(64 * 1024 * 1024);
  }

  async renderSvg(engine: DiagramEngine, dsl: string): Promise<string> {
    const key = svgCacheKey(engine, dsl);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const path = KROKI_PATH[engine];
    const url = `${this.baseUrl}/${path}/svg`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: dsl,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new KrokiError(`kroki ${res.status}: ${text.slice(0, 500)}`);
    }
    const svg = await res.text();
    this.cache.set(key, svg);
    return svg;
  }
}

export class KrokiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KrokiError";
  }
}
```

- [ ] **Step 2: Delete old `kroki.ts`**

```
git rm packages/server/src/kroki.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

Note: `index.ts` still imports old kroki — broken until Wave 5. Skip server typecheck for now, only verify the kroki module isolated:
```
bun --filter @prixmaviz/server exec tsc --noEmit src/kroki/client.ts src/kroki/cache.ts || true
```
Expected: kroki module compiles; index.ts errors are expected (fixed Wave 5).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/kroki/client.ts
git commit -m "refactor(kroki): split client + add cache (legacy kroki.ts deleted)"
```

---

## Wave 4 — Persistence

### Task 11: Slug + conflict resolution

**Files:**
- Create: `packages/server/src/pviz/slug.ts`
- Create: `packages/server/test/pviz/slug.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/pviz/slug.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { slugify, resolveSlug } from "../../src/pviz/slug";

describe("slugify", () => {
  it("kebab-cases simple names", () => {
    expect(slugify("Auth Flow")).toBe("auth-flow");
  });

  it("strips punctuation", () => {
    expect(slugify("data model: v2!")).toBe("data-model-v2");
  });

  it("replaces unicode with hyphen-fallback", () => {
    expect(slugify("café résumé")).toBe("caf-rsum");
  });

  it("collapses repeated hyphens", () => {
    expect(slugify("a___b...c")).toBe("a-b-c");
  });

  it("trims to 80 chars", () => {
    const s = slugify("x".repeat(200));
    expect(s.length).toBeLessThanOrEqual(80);
  });

  it("returns 'untitled' for empty input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!@#$%")).toBe("untitled");
  });
});

describe("resolveSlug", () => {
  it("returns base when no conflict", () => {
    expect(resolveSlug("auth-flow", new Set())).toBe("auth-flow");
  });

  it("appends -2 on first conflict", () => {
    expect(resolveSlug("auth-flow", new Set(["auth-flow"]))).toBe("auth-flow-2");
  });

  it("increments until free", () => {
    expect(
      resolveSlug("auth-flow", new Set(["auth-flow", "auth-flow-2", "auth-flow-3"])),
    ).toBe("auth-flow-4");
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```
bun test test/pviz/slug.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/pviz/slug.ts`:

```ts
const MAX_LEN = 80;

export function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN);
  if (!s) s = "untitled";
  return s;
}

export function resolveSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
```

- [ ] **Step 4: Run test**

```
bun test test/pviz/slug.test.ts
```
Expected: PASS 9/9.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pviz/slug.ts packages/server/test/pviz/slug.test.ts
git commit -m "feat(pviz): slugify + conflict resolution"
```

---

### Task 12: .pviz read/write + sibling SVG

**Files:**
- Create: `packages/server/src/pviz/io.ts`
- Create: `packages/server/test/pviz/io.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/pviz/io.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPviz, writePviz, listPvizEntries } from "../../src/pviz/io";
import { emptyGraphIR, emptyMeta, PVIZ_VERSION } from "@prixmaviz/shared";
import type { Diagram } from "@prixmaviz/shared";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pviz-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeDiagram(name: string): Diagram {
  return {
    id: "d_test",
    name,
    engine: "mermaid",
    kind: "graph",
    ir: emptyGraphIR(),
    meta: emptyMeta("2026-05-06T00:00:00Z"),
  };
}

describe("writePviz / readPviz", () => {
  it("roundtrips a graph diagram", async () => {
    const d = makeDiagram("hello world");
    const written = await writePviz(dir, d, "<svg/>");
    expect(written.path).toMatch(/hello-world\.pviz$/);
    const back = await readPviz(written.path);
    expect(back.version).toBe(PVIZ_VERSION);
    expect(back.id).toBe("d_test");
    expect(back.name).toBe("hello world");
    expect(back.kind).toBe("graph");
  });

  it("writes sibling .svg", async () => {
    const d = makeDiagram("svg-test");
    const written = await writePviz(dir, d, "<svg id='x'/>");
    const svgPath = written.path.replace(/\.pviz$/, ".svg");
    const svg = await Bun.file(svgPath).text();
    expect(svg).toContain("id='x'");
  });

  it("resolves slug conflicts", async () => {
    const a = makeDiagram("dup");
    const b = makeDiagram("dup");
    await writePviz(dir, a, "<svg/>");
    const second = await writePviz(dir, b, "<svg/>");
    expect(second.path).toMatch(/dup-2\.pviz$/);
  });
});

describe("listPvizEntries", () => {
  it("returns library entries from dir scan", async () => {
    const d = makeDiagram("one");
    await writePviz(dir, d, "<svg/>");
    const list = await listPvizEntries(dir);
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("one");
    expect(list[0]!.engine).toBe("mermaid");
  });

  it("returns empty list when dir missing", async () => {
    const list = await listPvizEntries(join(dir, "nope"));
    expect(list).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

```
bun test test/pviz/io.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/pviz/io.ts`:

```ts
import { readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Diagram, LibraryEntry, PvizFile } from "@prixmaviz/shared";
import { PVIZ_VERSION } from "@prixmaviz/shared";
import { resolveSlug, slugify } from "./slug";

export interface WriteResult {
  path: string;
  slug: string;
}

export async function writePviz(
  dir: string,
  diagram: Diagram,
  svg: string,
): Promise<WriteResult> {
  await mkdir(dir, { recursive: true });
  const taken = await collectSlugs(dir);
  const baseSlug = slugify(diagram.name);
  const slug = resolveSlug(baseSlug, taken);
  const path = join(dir, `${slug}.pviz`);
  const svgPath = join(dir, `${slug}.svg`);

  const file: PvizFile = {
    version: PVIZ_VERSION,
    id: diagram.id,
    name: diagram.name,
    engine: diagram.engine,
    kind: diagram.kind,
    ir: diagram.ir,
    dsl: diagram.dsl,
    meta: diagram.meta,
  };
  await Bun.write(path, JSON.stringify(file, null, 2));
  await Bun.write(svgPath, svg);
  return { path, slug };
}

export async function readPviz(path: string): Promise<PvizFile> {
  const raw = await Bun.file(path).text();
  const parsed = JSON.parse(raw) as PvizFile;
  if (parsed.version !== PVIZ_VERSION) {
    throw new Error(`unsupported .pviz version ${parsed.version}`);
  }
  return parsed;
}

export async function listPvizEntries(dir: string): Promise<LibraryEntry[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const entries: LibraryEntry[] = [];
  for (const n of names) {
    if (extname(n) !== ".pviz") continue;
    try {
      const path = join(dir, n);
      const file = await readPviz(path);
      entries.push({
        name: file.name,
        path,
        engine: file.engine,
        kind: file.kind,
        tags: file.meta.tags,
        createdAt: file.meta.createdAt,
        updatedAt: file.meta.updatedAt,
      });
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return entries;
}

async function collectSlugs(dir: string): Promise<Set<string>> {
  if (!existsSync(dir)) return new Set();
  const names = await readdir(dir);
  return new Set(
    names
      .filter((n) => extname(n) === ".pviz")
      .map((n) => basename(n, ".pviz")),
  );
}
```

- [ ] **Step 4: Run test**

```
bun test test/pviz/io.test.ts
```
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pviz/io.ts packages/server/test/pviz/io.test.ts
git commit -m "feat(pviz): read/write + sibling svg + listing"
```

---

### Task 13: fs.watch on diagrams dir

**Files:**
- Create: `packages/server/src/pviz/watch.ts`

- [ ] **Step 1: Write `watch.ts`**

Create `packages/server/src/pviz/watch.ts`:

```ts
import { watch, type FSWatcher } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";

export type WatchCallback = () => void;

export class DiagramsWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dir: string,
    private readonly onChange: WatchCallback,
    private readonly debounceMs: number = 80,
  ) {}

  start(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.watcher = watch(this.dir, () => this.fire());
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private fire(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChange();
    }, this.debounceMs);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/pviz/watch.ts
git commit -m "feat(pviz): debounced fs.watch wrapper"
```

---

### Task 14: In-memory diagram store

**Files:**
- Create: `packages/server/src/store/diagrams.ts`
- Create: `packages/server/test/store/diagrams.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/store/diagrams.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { DiagramStore } from "../../src/store/diagrams";
import { emptyGraphIR, emptyMeta } from "@prixmaviz/shared";
import type { Diagram } from "@prixmaviz/shared";

function fixture(id: string, name: string): Diagram {
  return {
    id,
    name,
    engine: "mermaid",
    kind: "graph",
    ir: emptyGraphIR(),
    meta: emptyMeta(),
  };
}

describe("DiagramStore", () => {
  it("create returns id and stores diagram", () => {
    const s = new DiagramStore();
    const d = fixture("d1", "test");
    s.put(d);
    expect(s.get("d1")).toEqual(d);
  });

  it("put with same id updates", () => {
    const s = new DiagramStore();
    s.put(fixture("d1", "old"));
    const updated = { ...fixture("d1", "new"), name: "new" };
    s.put(updated);
    expect(s.get("d1")?.name).toBe("new");
  });

  it("delete removes", () => {
    const s = new DiagramStore();
    s.put(fixture("d1", "x"));
    s.delete("d1");
    expect(s.get("d1")).toBeUndefined();
  });

  it("list returns all in insertion order", () => {
    const s = new DiagramStore();
    s.put(fixture("a", "a"));
    s.put(fixture("b", "b"));
    expect(s.list().map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("touch updates updatedAt", async () => {
    const s = new DiagramStore();
    const d = fixture("d1", "x");
    d.meta.updatedAt = "2020-01-01T00:00:00Z";
    s.put(d);
    s.touch("d1");
    const after = s.get("d1");
    expect(after?.meta.updatedAt).not.toBe("2020-01-01T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `packages/server/src/store/diagrams.ts`:

```ts
import type { Diagram, DiagramId } from "@prixmaviz/shared";

export class DiagramStore {
  private map = new Map<DiagramId, Diagram>();

  put(d: Diagram): void {
    this.map.set(d.id, d);
  }

  get(id: DiagramId): Diagram | undefined {
    return this.map.get(id);
  }

  delete(id: DiagramId): void {
    this.map.delete(id);
  }

  list(): Diagram[] {
    return Array.from(this.map.values());
  }

  touch(id: DiagramId): void {
    const d = this.map.get(id);
    if (!d) return;
    d.meta.updatedAt = new Date().toISOString();
  }
}

export function newDiagramId(): DiagramId {
  return `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
```

- [ ] **Step 4: Run test**

```
bun test test/store/diagrams.test.ts
```
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/store/diagrams.ts packages/server/test/store/diagrams.test.ts
git commit -m "feat(store): in-memory diagram registry"
```

---

### Task 15: Render engine — combine IR → DSL → Kroki → SVG

**Files:**
- Create: `packages/server/src/render.ts`

- [ ] **Step 1: Write `render.ts`**

Create `packages/server/src/render.ts`:

```ts
import type { Diagram, GraphIR, RenderResult } from "@prixmaviz/shared";
import { KrokiClient, KrokiError } from "./kroki/client";
import { getIrRenderer } from "./renderers/registry";

export interface RenderEngineDeps {
  kroki: KrokiClient;
}

export interface RenderOk {
  ok: true;
  result: RenderResult;
  warnings: string[];
}

export interface RenderFail {
  ok: false;
  error: string;
}

export type RenderOutcome = RenderOk | RenderFail;

export async function renderDiagram(
  diagram: Diagram,
  deps: RenderEngineDeps,
): Promise<RenderOutcome> {
  let dsl: string;
  let warnings: string[] = [];

  if (diagram.kind === "graph") {
    if (!diagram.ir) return { ok: false, error: "graph diagram missing ir" };
    const renderer = getIrRenderer(diagram.engine);
    if (!renderer)
      return {
        ok: false,
        error: `no IR renderer for engine "${diagram.engine}"`,
      };
    const out = renderer(diagram.ir);
    dsl = out.dsl;
    warnings = out.warnings;
  } else {
    if (diagram.dsl === undefined)
      return { ok: false, error: "passthrough diagram missing dsl" };
    dsl = diagram.dsl;
  }

  try {
    const svg = await deps.kroki.renderSvg(diagram.engine, dsl);
    return { ok: true, result: { svg, dsl }, warnings };
  } catch (e) {
    if (e instanceof KrokiError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renderIR(
  engine: Diagram["engine"],
  ir: GraphIR,
  deps: RenderEngineDeps,
): Promise<RenderOutcome> {
  return renderDiagram(
    { id: "_", name: "_", engine, kind: "graph", ir, meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] } },
    deps,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/render.ts
git commit -m "feat(render): unified render outcome (ir or passthrough)"
```

---

## Wave 5 — Bun server (HTTP + WS, no MCP yet)

### Task 16: CLI args parser

**Files:**
- Create: `packages/server/src/args.ts`

- [ ] **Step 1: Write `args.ts`**

Create `packages/server/src/args.ts`:

```ts
export interface CliArgs {
  port: number;
  projectRoot: string;
  mcpMode: boolean;
  krokiUrl?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    port: 0,
    projectRoot: process.cwd(),
    mcpMode: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--port":
        args.port = Number(argv[++i] ?? "0");
        break;
      case "--project-root":
        args.projectRoot = argv[++i] ?? process.cwd();
        break;
      case "--mcp":
        args.mcpMode = true;
        break;
      case "--kroki-url":
        args.krokiUrl = argv[++i];
        break;
    }
  }
  return args;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/args.ts
git commit -m "feat(server): CLI arg parser"
```

---

### Task 17: Bootstrap (project root, dirs)

**Files:**
- Create: `packages/server/src/bootstrap.ts`

- [ ] **Step 1: Write `bootstrap.ts`**

Create `packages/server/src/bootstrap.ts`:

```ts
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PrixmaPaths {
  projectRoot: string;
  prixmaDir: string;
  diagramsDir: string;
  cacheDir: string;
  stateDir: string;
  configFile: string;
}

export function resolvePaths(projectRoot: string): PrixmaPaths {
  const root = resolve(projectRoot);
  const prixmaDir = join(root, ".prixmaviz");
  return {
    projectRoot: root,
    prixmaDir,
    diagramsDir: join(prixmaDir, "diagrams"),
    cacheDir: join(prixmaDir, "cache"),
    stateDir: join(prixmaDir, "state"),
    configFile: join(prixmaDir, "config.json"),
  };
}

export function ensureDirs(paths: PrixmaPaths): void {
  for (const d of [paths.prixmaDir, paths.diagramsDir, paths.cacheDir, paths.stateDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/bootstrap.ts
git commit -m "feat(server): project paths + ensureDirs"
```

---

### Task 18: WS broadcast helper

**Files:**
- Create: `packages/server/src/ws/broadcast.ts`

- [ ] **Step 1: Write `broadcast.ts`**

Create `packages/server/src/ws/broadcast.ts`:

```ts
import type { ServerToClient } from "@prixmaviz/shared";

export interface WsMember {
  send(data: string): void;
}

export class WsHub {
  private members = new Set<WsMember>();

  add(m: WsMember): void {
    this.members.add(m);
  }

  remove(m: WsMember): void {
    this.members.delete(m);
  }

  broadcast(msg: ServerToClient): void {
    const data = JSON.stringify(msg);
    for (const m of this.members) m.send(data);
  }

  size(): number {
    return this.members.size;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws/broadcast.ts
git commit -m "feat(ws): typed broadcast hub"
```

---

### Task 19: Static asset serving (extract from existing index.ts)

**Files:**
- Create: `packages/server/src/static.ts`

- [ ] **Step 1: Write `static.ts`**

Create `packages/server/src/static.ts`:

```ts
import { join, normalize, resolve } from "node:path";
import { EMBEDDED } from "./embedded";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

export interface StaticDeps {
  webDist: string;
  fallbackHtml: string;
}

export async function serveStatic(pathname: string, deps: StaticDeps): Promise<Response> {
  const safe = "/" + normalize(pathname).replace(/^\/+/, "");

  const embeddedPath = EMBEDDED[safe];
  if (embeddedPath) {
    return new Response(Bun.file(embeddedPath), { headers: { "Content-Type": mimeFor(safe) } });
  }
  const embeddedIndex = EMBEDDED["/index.html"];
  if (embeddedIndex && safe !== "/index.html") {
    return new Response(Bun.file(embeddedIndex), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const rel = safe.replace(/^\/+/, "");
  const full = resolve(deps.webDist, rel);
  if (!full.startsWith(deps.webDist)) return new Response("forbidden", { status: 403 });
  const file = Bun.file(full);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": mimeFor(full) } });
  }
  const indexFile = Bun.file(join(deps.webDist, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(deps.fallbackHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/static.ts
git commit -m "feat(server): extract static asset serving"
```

---

### Task 20: HTTP routes module

**Files:**
- Create: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Write `routes.ts`**

Create `packages/server/src/http/routes.ts`:

```ts
import type {
  Diagram, DiagramId, PatchOp, ServerToClient,
} from "@prixmaviz/shared";
import { emptyGraphIR, emptyMeta, inferKind } from "@prixmaviz/shared";
import type { KrokiClient } from "../kroki/client";
import { applyPatch } from "../ir/engine";
import { renderDiagram } from "../render";
import { DiagramStore, newDiagramId } from "../store/diagrams";
import { listPvizEntries, readPviz, writePviz } from "../pviz/io";
import type { PrixmaPaths } from "../bootstrap";
import type { WsHub } from "../ws/broadcast";

export interface RouteDeps {
  paths: PrixmaPaths;
  store: DiagramStore;
  kroki: KrokiClient;
  hub: WsHub;
}

export async function handleApi(
  req: Request,
  url: URL,
  deps: RouteDeps,
): Promise<Response | undefined> {
  const p = url.pathname;

  if (p === "/api/health") return Response.json({ ok: true });

  if (p === "/api/library" && req.method === "GET") {
    const entries = await listPvizEntries(deps.paths.diagramsDir);
    return Response.json({ entries });
  }

  if (p === "/api/diagrams" && req.method === "POST") {
    const body = await req.json() as {
      name: string; engine: Diagram["engine"]; kind?: Diagram["kind"]; initialDsl?: string;
    };
    return await createDiagram(body, deps);
  }

  const patchMatch = p.match(/^\/api\/diagrams\/([^/]+)\/patch$/);
  if (patchMatch && req.method === "POST") {
    const id = patchMatch[1] as DiagramId;
    const body = await req.json() as { ops: PatchOp[] };
    return await patchDiagram(id, body.ops, deps);
  }

  const loadMatch = p.match(/^\/api\/diagrams\/([^/]+)\/load$/);
  if (loadMatch && req.method === "POST") {
    const slug = loadMatch[1]!;
    return await loadDiagramBySlug(slug, deps);
  }

  const saveMatch = p.match(/^\/api\/diagrams\/([^/]+)\/save$/);
  if (saveMatch && req.method === "POST") {
    const id = saveMatch[1] as DiagramId;
    const body = await req.json().catch(() => ({})) as { name?: string; tags?: string[] };
    return await saveDiagram(id, body, deps);
  }

  if (p === "/api/render-dsl" && req.method === "POST") {
    const body = await req.json() as { engine: Diagram["engine"]; source: string; name?: string };
    return await renderDsl(body, deps);
  }

  return undefined;
}

async function createDiagram(
  body: { name: string; engine: Diagram["engine"]; kind?: Diagram["kind"]; initialDsl?: string },
  deps: RouteDeps,
): Promise<Response> {
  const kind: Diagram["kind"] = body.kind ?? inferKind(body.engine);
  const id = newDiagramId();
  const diagram: Diagram = {
    id,
    name: body.name,
    engine: body.engine,
    kind,
    ir: kind === "graph" ? emptyGraphIR() : undefined,
    dsl: kind === "passthrough" ? body.initialDsl ?? "" : undefined,
    meta: emptyMeta(),
  };
  deps.store.put(diagram);

  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) {
    return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  }
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: id,
    render: outcome.result,
    warnings: outcome.warnings,
  });
}

async function patchDiagram(
  id: DiagramId,
  ops: PatchOp[],
  deps: RouteDeps,
): Promise<Response> {
  const d = deps.store.get(id);
  if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  if (d.kind !== "graph" || !d.ir)
    return Response.json({ ok: false, error: "patches only valid on graph diagrams" }, { status: 400 });
  const result = applyPatch(d.ir, ops);
  if (!result.ok)
    return Response.json({ ok: false, error: result.error, opIndex: result.opIndex }, { status: 400 });

  d.ir = result.ir;
  deps.store.touch(id);
  const outcome = await renderDiagram(d, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });

  broadcastRender(deps.hub, d, outcome.result.svg, [...result.warnings, ...outcome.warnings]);
  return Response.json({
    diagramId: id,
    ir: d.ir,
    render: outcome.result,
    warnings: [...result.warnings, ...outcome.warnings],
  });
}

async function loadDiagramBySlug(slug: string, deps: RouteDeps): Promise<Response> {
  const path = `${deps.paths.diagramsDir}/${slug}.pviz`;
  if (!(await Bun.file(path).exists()))
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const file = await readPviz(path);
  const id = file.id;
  const diagram: Diagram = {
    id,
    name: file.name,
    engine: file.engine,
    kind: file.kind,
    ir: file.ir,
    dsl: file.dsl,
    meta: file.meta,
  };
  deps.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: id,
    ir: diagram.ir,
    dsl: diagram.dsl,
    render: outcome.result,
  });
}

async function saveDiagram(
  id: DiagramId,
  body: { name?: string; tags?: string[] },
  deps: RouteDeps,
): Promise<Response> {
  const d = deps.store.get(id);
  if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  if (body.name) d.name = body.name;
  if (body.tags) d.meta.tags = body.tags;
  d.meta.updatedAt = new Date().toISOString();

  const outcome = await renderDiagram(d, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  const written = await writePviz(deps.paths.diagramsDir, d, outcome.result.svg);
  return Response.json({ path: written.path, slug: written.slug, meta: d.meta });
}

async function renderDsl(
  body: { engine: Diagram["engine"]; source: string; name?: string },
  deps: RouteDeps,
): Promise<Response> {
  const id = newDiagramId();
  const diagram: Diagram = {
    id,
    name: body.name ?? "untitled",
    engine: body.engine,
    kind: "passthrough",
    dsl: body.source,
    meta: emptyMeta(),
  };
  deps.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  if (body.name) {
    await writePviz(deps.paths.diagramsDir, diagram, outcome.result.svg);
  }
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({ diagramId: id, render: outcome.result });
}

function broadcastRender(
  hub: WsHub,
  d: Diagram,
  svg: string,
  warnings: string[],
): void {
  const msg: ServerToClient = {
    type: "render",
    diagramId: d.id,
    ir: d.ir,
    dsl: d.dsl ?? "",
    svg,
    warnings: warnings.length ? warnings : undefined,
  };
  hub.broadcast(msg);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/http/routes.ts
git commit -m "feat(http): API routes (library, diagrams CRUD, render-dsl)"
```

---

### Task 21: New top-level server entry

**Files:**
- Modify: `packages/server/src/index.ts` (overwrite)
- Delete: `packages/server/src/state.ts`

- [ ] **Step 1: Overwrite `index.ts`**

Replace `packages/server/src/index.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./args";
import { ensureDirs, resolvePaths } from "./bootstrap";
import { handleApi } from "./http/routes";
import { KrokiClient } from "./kroki/client";
import { DiagramStore } from "./store/diagrams";
import { DiagramsWatcher } from "./pviz/watch";
import { listPvizEntries } from "./pviz/io";
import { serveStatic } from "./static";
import { WsHub } from "./ws/broadcast";
import type { ServerToClient } from "@prixmaviz/shared";

const args = parseArgs(process.argv.slice(2));

if (args.mcpMode) {
  await import("./mcp/server").then((m) => m.runMcp(args));
} else {
  await runServer();
}

async function runServer(): Promise<void> {
  const paths = resolvePaths(args.projectRoot);
  ensureDirs(paths);

  const kroki = new KrokiClient({ baseUrl: args.krokiUrl });
  const store = new DiagramStore();
  const hub = new WsHub();

  const watcher = new DiagramsWatcher(paths.diagramsDir, async () => {
    const entries = await listPvizEntries(paths.diagramsDir);
    const msg: ServerToClient = { type: "library", entries };
    hub.broadcast(msg);
  });
  watcher.start();

  const webDist = process.env.PRIXMAVIZ_WEB_DIST ?? join(import.meta.dir, "../../web/dist");
  const fallbackHtml = `<!doctype html><meta charset="utf-8"><title>PrixmaViz</title><h1>PrixmaViz server up</h1><p>Web bundle missing at <code>${webDist}</code>.</p>`;

  const server = Bun.serve<{ id: string }, undefined>({
    port: args.port,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const ok = srv.upgrade(req, { data: { id: crypto.randomUUID() } });
        return ok ? undefined : new Response("upgrade failed", { status: 400 });
      }

      const apiResp = await handleApi(req, url, { paths, store, kroki, hub });
      if (apiResp) return apiResp;

      if (req.method === "GET") {
        return serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, {
          webDist,
          fallbackHtml,
        });
      }

      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        hub.add({ send: (s) => ws.send(s) });
      },
      close(ws) {
        // simple impl: socket identity tracked by closure capture; for v1 we just clear all on close
        // a per-socket member ref is added in Wave-7 polish if needed
      },
      message() {
        // open/patch via WS deferred to v2; HTTP suffices in v1
      },
    },
  });

  const bundleStatus = existsSync(webDist) ? "found" : "missing";
  const mode = `port=${server.port} project=${paths.projectRoot}`;
  console.log(JSON.stringify({ ready: true, port: server.port }));
  console.error(`prixmaviz server ${mode} web=${webDist} (${bundleStatus})`);
}
```

- [ ] **Step 2: Delete obsolete `state.ts`**

```
git rm packages/server/src/state.ts
```

- [ ] **Step 3: Verify server boots**

```
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-smoke 2>/dev/null &
sleep 1
curl -s http://localhost:5180/api/health
curl -s http://localhost:5180/api/library
kill %1
```
Expected: `{"ok":true}` and `{"entries":[]}`.

- [ ] **Step 4: Smoke render via HTTP**

```
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-smoke 2>/dev/null &
sleep 1
curl -s -X POST http://localhost:5180/api/diagrams \
  -H 'content-type: application/json' \
  -d '{"name":"smoke","engine":"mermaid"}' | head -c 100
kill %1
```
Expected: JSON with `diagramId` and `render.svg`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git rm packages/server/src/state.ts
git commit -m "refactor(server): wire new HTTP routes + watcher + delete annotations state"
```

---

## Wave 6 — Web UI

### Task 22: Web state store (Zustand)

**Files:**
- Create: `packages/web/src/store/index.ts`
- Create: `packages/web/test/store/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/store/index.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../../src/store";

beforeEach(() => {
  useAppStore.setState({
    diagram: null,
    library: [],
    wsStatus: "idle",
    error: null,
    pending: false,
  });
});

describe("useAppStore", () => {
  it("setDiagram sets current", () => {
    useAppStore.getState().setDiagram({
      id: "d1", name: "x", engine: "mermaid", kind: "graph",
      ir: { nodes: {}, edges: {}, groups: {}, layout: { direction: "LR" } },
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    });
    expect(useAppStore.getState().diagram?.id).toBe("d1");
  });

  it("setLibrary stores entries", () => {
    useAppStore.getState().setLibrary([
      { name: "a", path: "/x/a.pviz", engine: "mermaid", kind: "graph", tags: [], createdAt: "", updatedAt: "" },
    ]);
    expect(useAppStore.getState().library.length).toBe(1);
  });

  it("setWsStatus updates", () => {
    useAppStore.getState().setWsStatus("open");
    expect(useAppStore.getState().wsStatus).toBe("open");
  });

  it("setRender updates svg + dsl on current diagram", () => {
    useAppStore.getState().setDiagram({
      id: "d1", name: "x", engine: "mermaid", kind: "graph",
      ir: { nodes: {}, edges: {}, groups: {}, layout: { direction: "LR" } },
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    });
    useAppStore.getState().setRender("d1", "<svg/>", "flowchart LR");
    expect(useAppStore.getState().svg).toBe("<svg/>");
  });
});
```

- [ ] **Step 2: Verify failure**

```
cd packages/web && bun run test
```
Expected: FAIL.

- [ ] **Step 3: Write store**

Create `packages/web/src/store/index.ts`:

```ts
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
```

- [ ] **Step 4: Run test**

```
cd packages/web && bun run test
```
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/store/index.ts packages/web/test/store/index.test.ts
git commit -m "feat(web): zustand state store"
```

---

### Task 23: HTTP API client

**Files:**
- Create: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Write `api.ts`**

Create `packages/web/src/lib/api.ts`:

```ts
import type {
  ApplyPatchResponse, CreateDiagramRequest, CreateDiagramResponse,
  DiagramEngine, DiagramId, LibraryEntry, PatchOp, RenderDslRequest, RenderDslResponse,
} from "@prixmaviz/shared";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => r.json()),

  library: () =>
    fetch("/api/library")
      .then((r) => jsonOrThrow<{ entries: LibraryEntry[] }>(r))
      .then((j) => j.entries),

  createDiagram: (req: CreateDiagramRequest) =>
    fetch("/api/diagrams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<CreateDiagramResponse>(r)),

  patch: (diagramId: DiagramId, ops: PatchOp[]) =>
    fetch(`/api/diagrams/${diagramId}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    }).then((r) => jsonOrThrow<ApplyPatchResponse>(r)),

  loadBySlug: (slug: string) =>
    fetch(`/api/diagrams/${encodeURIComponent(slug)}/load`, { method: "POST" })
      .then((r) => jsonOrThrow<ApplyPatchResponse & { dsl?: string }>(r)),

  save: (diagramId: DiagramId, body: { name?: string; tags?: string[] }) =>
    fetch(`/api/diagrams/${diagramId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ path: string; slug: string }>(r)),

  renderDsl: (req: RenderDslRequest) =>
    fetch("/api/render-dsl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<RenderDslResponse>(r)),
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat(web): HTTP API client"
```

---

### Task 24: WS hook with auto-reconnect

**Files:**
- Create: `packages/web/src/lib/ws.ts`

- [ ] **Step 1: Write `ws.ts`**

Create `packages/web/src/lib/ws.ts`:

```ts
import { useEffect } from "react";
import { useAppStore } from "../store";
import type { ServerToClient } from "@prixmaviz/shared";

export function useWebSocket(): void {
  const setWsStatus = useAppStore((s) => s.setWsStatus);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const setRender = useAppStore((s) => s.setRender);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectDelay = 1000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      setWsStatus("connecting");
      ws.onopen = () => {
        reconnectDelay = 1000;
        setWsStatus("open");
      };
      ws.onclose = () => {
        setWsStatus("closed");
        if (!stopped) {
          timer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerToClient;
          handleMessage(msg, { setLibrary, setRender });
        } catch {}
      };
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [setWsStatus, setLibrary, setRender]);
}

function handleMessage(
  msg: ServerToClient,
  deps: {
    setLibrary: (e: import("@prixmaviz/shared").LibraryEntry[]) => void;
    setRender: (
      id: import("@prixmaviz/shared").DiagramId,
      svg: string,
      dsl: string,
      ir?: import("@prixmaviz/shared").GraphIR,
    ) => void;
  },
): void {
  if (msg.type === "render") {
    deps.setRender(msg.diagramId, msg.svg, msg.dsl, msg.ir);
  } else if (msg.type === "library") {
    deps.setLibrary(msg.entries);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/ws.ts
git commit -m "feat(web): WS hook with auto-reconnect"
```

---

### Task 25: Mermaid SVG node-id extractor + diff

**Files:**
- Create: `packages/web/src/lib/mermaid-ids.ts`
- Create: `packages/web/src/lib/svg-diff.ts`
- Create: `packages/web/test/lib/mermaid-ids.test.ts`
- Create: `packages/web/test/lib/svg-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/lib/mermaid-ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractMermaidNodeId, extractMermaidEdgeId } from "../../src/lib/mermaid-ids";

describe("extractMermaidNodeId", () => {
  it("extracts node id from typical mermaid svg id", () => {
    expect(extractMermaidNodeId("flowchart-Auth-3")).toBe("Auth");
  });

  it("returns null for non-matching id", () => {
    expect(extractMermaidNodeId("not-a-flowchart-id")).toBe(null);
  });

  it("handles ids with dashes in them", () => {
    expect(extractMermaidNodeId("flowchart-foo-bar-12")).toBe("foo-bar");
  });
});

describe("extractMermaidEdgeId", () => {
  it("extracts L-from-to-N", () => {
    expect(extractMermaidEdgeId("L-Auth-DB-0")).toEqual({ from: "Auth", to: "DB" });
  });

  it("returns null on bad pattern", () => {
    expect(extractMermaidEdgeId("nope")).toBe(null);
  });
});
```

Create `packages/web/test/lib/svg-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffSvgNodeIds } from "../../src/lib/svg-diff";

describe("diffSvgNodeIds", () => {
  it("computes added/removed/kept", () => {
    const r = diffSvgNodeIds(["a", "b"], ["b", "c"]);
    expect(r.added).toEqual(["c"]);
    expect(r.removed).toEqual(["a"]);
    expect(r.kept).toEqual(["b"]);
  });

  it("empty prev → all added", () => {
    const r = diffSvgNodeIds([], ["a", "b"]);
    expect(r.added).toEqual(["a", "b"]);
    expect(r.removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

```
cd packages/web && bun run test
```
Expected: FAIL.

- [ ] **Step 3: Write implementations**

Create `packages/web/src/lib/mermaid-ids.ts`:

```ts
const NODE_RE = /^flowchart-(.+)-\d+$/;
const EDGE_RE = /^L-(.+)-(.+)-\d+$/;

export function extractMermaidNodeId(svgId: string): string | null {
  const m = svgId.match(NODE_RE);
  return m ? m[1]! : null;
}

export function extractMermaidEdgeId(svgId: string): { from: string; to: string } | null {
  const m = svgId.match(EDGE_RE);
  if (!m) return null;
  return { from: m[1]!, to: m[2]! };
}
```

Create `packages/web/src/lib/svg-diff.ts`:

```ts
export interface NodeIdDiff {
  added: string[];
  removed: string[];
  kept: string[];
}

export function diffSvgNodeIds(prev: string[], next: string[]): NodeIdDiff {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((id) => !prevSet.has(id)),
    removed: prev.filter((id) => !nextSet.has(id)),
    kept: next.filter((id) => prevSet.has(id)),
  };
}

export function parseSvgNodes(svg: string): string[] {
  const ids: string[] = [];
  const re = /<g[^>]*\sid="(flowchart-[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) ids.push(m[1]!);
  return ids;
}
```

- [ ] **Step 4: Run test**

```
cd packages/web && bun run test
```
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/mermaid-ids.ts packages/web/src/lib/svg-diff.ts packages/web/test/lib/mermaid-ids.test.ts packages/web/test/lib/svg-diff.test.ts
git commit -m "feat(web): mermaid id extraction + svg diff"
```

---

### Task 26: Topbar component

**Files:**
- Create: `packages/web/src/components/Topbar.tsx`

- [ ] **Step 1: Write component**

Create `packages/web/src/components/Topbar.tsx`:

```tsx
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { ALL_ENGINES } from "@prixmaviz/shared";

export function Topbar() {
  const diagram = useAppStore((s) => s.diagram);
  const wsStatus = useAppStore((s) => s.wsStatus);
  const pending = useAppStore((s) => s.pending);
  const setPending = useAppStore((s) => s.setPending);
  const setError = useAppStore((s) => s.setError);

  const dot =
    wsStatus === "open" ? "ok" :
    wsStatus === "closed" ? "err" :
    "";

  async function onSave() {
    if (!diagram) return;
    setPending(true);
    try {
      await api.save(diagram.id, { name: diagram.name, tags: diagram.meta.tags });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <header className="topbar">
      <h1>PrixmaViz</h1>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {diagram ? `${diagram.engine} · ${diagram.kind}` : "no diagram"}
      </span>
      <div className="spacer" />
      {diagram && (
        <button className="primary" onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      )}
      <div className="status">
        <span className={`dot ${dot}`} />
        <span>ws · {wsStatus}</span>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/Topbar.tsx
git commit -m "feat(web): Topbar component"
```

---

### Task 27: Library sidebar component

**Files:**
- Create: `packages/web/src/components/Library.tsx`

- [ ] **Step 1: Write component**

Create `packages/web/src/components/Library.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { basename } from "../lib/path";

export function Library() {
  const library = useAppStore((s) => s.library);
  const diagram = useAppStore((s) => s.diagram);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const setError = useAppStore((s) => s.setError);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.library().then(setLibrary).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [setLibrary, setError]);

  const filtered = useMemo(() => {
    if (!search) return library;
    const q = search.toLowerCase();
    return library.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [library, search]);

  async function open(slug: string) {
    try {
      await api.loadBySlug(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <aside className="library">
      <div className="library-header">
        <div className="library-title">Library</div>
      </div>
      <div className="library-search">
        <input
          placeholder="Search diagrams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="library-count">
        {filtered.length} diagram{filtered.length === 1 ? "" : "s"}
      </div>
      <div className="library-list">
        {filtered.map((entry) => {
          const slug = basename(entry.path).replace(/\.pviz$/, "");
          const active = diagram?.name === entry.name;
          return (
            <div
              key={entry.path}
              className={`library-item ${active ? "active" : ""}`}
              onClick={() => open(slug)}
            >
              <div className="library-thumb">
                <img src={`/api/library/${encodeURIComponent(slug)}/thumb`} alt="" />
              </div>
              <div className="library-name">{entry.name}</div>
              <div className="library-meta">
                {entry.engine} · {relativeTime(entry.updatedAt)}
              </div>
              {entry.tags.length > 0 && (
                <div className="library-tags">
                  {entry.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
```

Create `packages/web/src/lib/path.ts`:

```ts
export function basename(p: string): string {
  return p.split("/").pop() ?? p;
}
```

- [ ] **Step 2: Add the thumbnail HTTP route**

Modify `packages/server/src/http/routes.ts` — add after `/api/library` block:

```ts
  const thumbMatch = p.match(/^\/api\/library\/([^/]+)\/thumb$/);
  if (thumbMatch && req.method === "GET") {
    const slug = thumbMatch[1]!;
    const path = `${deps.paths.diagramsDir}/${slug}.svg`;
    const file = Bun.file(path);
    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": "image/svg+xml" } });
    }
    return new Response("not found", { status: 404 });
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/Library.tsx packages/web/src/lib/path.ts packages/server/src/http/routes.ts
git commit -m "feat(web): Library sidebar + thumb route"
```

---

### Task 28: Canvas with motion-animated SVG

**Files:**
- Create: `packages/web/src/components/Canvas.tsx`
- Create: `packages/web/src/components/DiagramView.tsx`
- Create: `packages/web/src/components/EmptyState.tsx`
- Create: `packages/web/src/components/ErrorPanel.tsx`

- [ ] **Step 1: Write `EmptyState.tsx`**

```tsx
export function EmptyState() {
  return (
    <div className="empty">
      <p>No diagram open. Ask an AI agent to create one, or click an item in the library.</p>
    </div>
  );
}
```

- [ ] **Step 2: Write `ErrorPanel.tsx`**

```tsx
import { useAppStore } from "../store";

export function ErrorPanel({ message }: { message: string }) {
  const setError = useAppStore((s) => s.setError);
  return (
    <div className="error">
      <pre>{message}</pre>
      <button onClick={() => setError(null)}>Dismiss</button>
    </div>
  );
}
```

- [ ] **Step 3: Write `DiagramView.tsx`**

```tsx
import { motion, AnimatePresence } from "motion/react";
import { useMemo } from "react";

export function DiagramView({ svg, diagramId }: { svg: string; diagramId: string }) {
  const html = useMemo(() => svg, [svg]);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${diagramId}-${html.length}`}
        className="diagram"
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </AnimatePresence>
  );
}
```

(Note: full per-node motion animation via `<motion.g>` is enabled in Wave 9 polish, after smoke testing the pipeline. v1 ships with whole-svg crossfade as a baseline; per-node motion is a later refinement against the diff util.)

- [ ] **Step 4: Write `Canvas.tsx`**

```tsx
import { useAppStore } from "../store";
import { DiagramView } from "./DiagramView";
import { EmptyState } from "./EmptyState";
import { ErrorPanel } from "./ErrorPanel";

export function Canvas() {
  const diagram = useAppStore((s) => s.diagram);
  const svg = useAppStore((s) => s.svg);
  const error = useAppStore((s) => s.error);

  return (
    <section className="viewport">
      {error && <ErrorPanel message={error} />}
      {!diagram && !svg && <EmptyState />}
      {diagram && svg && <DiagramView diagramId={diagram.id} svg={svg} />}
    </section>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Canvas.tsx packages/web/src/components/DiagramView.tsx packages/web/src/components/EmptyState.tsx packages/web/src/components/ErrorPanel.tsx
git commit -m "feat(web): Canvas + DiagramView + empty/error states"
```

---

### Task 29: Wire App.tsx + extend styles.css

**Files:**
- Overwrite: `packages/web/src/App.tsx`
- Modify: `packages/web/src/styles.css`
- Delete: `packages/web/src/samples.ts`

- [ ] **Step 1: Overwrite App.tsx**

```tsx
import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { Canvas } from "./components/Canvas";
import { useWebSocket } from "./lib/ws";

export function App() {
  useWebSocket();
  return (
    <div className="app">
      <Topbar />
      <div className="workspace">
        <Library />
        <Canvas />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append styles for library/empty/error**

Append to `packages/web/src/styles.css`:

```css
.workspace {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 0;
}

.library {
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.library-header { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.library-title { font-weight: 600; font-size: 13px; }
.library-search { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.library-search input {
  width: 100%; padding: 6px 8px; border-radius: 6px;
  background: var(--bg); border: 1px solid var(--border); color: var(--fg);
  font-size: 12px;
}
.library-count {
  padding: 8px 12px; color: var(--muted);
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
}
.library-list { flex: 1; overflow: auto; }
.library-item {
  margin: 4px 8px; padding: 10px;
  border: 1px solid var(--border); border-radius: 8px;
  cursor: pointer; transition: border-color 120ms, background 120ms;
}
.library-item:hover { background: #1c1f26; }
.library-item.active { background: #1c1f26; border-color: var(--accent); }
.library-thumb {
  height: 60px; background: var(--bg); border-radius: 4px;
  margin-bottom: 8px; display: grid; place-items: center; overflow: hidden;
}
.library-thumb img { max-width: 100%; max-height: 100%; }
.library-name { font-weight: 600; font-size: 12px; }
.library-meta { color: var(--muted); font-size: 10px; margin-top: 2px; }
.library-tags { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.tag {
  font-size: 10px; background: var(--bg); color: var(--muted);
  padding: 1px 6px; border-radius: 3px;
}

.empty p { color: var(--muted); }
```

- [ ] **Step 3: Delete obsolete samples.ts**

```
git rm packages/web/src/samples.ts
```

- [ ] **Step 4: Verify web build**

```
cd packages/web && bun run build 2>&1 | tail -10
```
Expected: build succeeds, `dist/` produced.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/styles.css
git rm packages/web/src/samples.ts
git commit -m "feat(web): wire App with library + canvas; remove sample fixture"
```

---

### Task 30: End-to-end web smoke

**Files:** none (test only)

- [ ] **Step 1: Build web bundle**

```
bun --filter @prixmaviz/web build
```
Expected: success.

- [ ] **Step 2: Boot server with smoke project**

```
mkdir -p /tmp/prixma-smoke
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-smoke 2>&1 &
sleep 1
```

- [ ] **Step 3: Create + patch via HTTP**

```
DID=$(curl -s -X POST http://localhost:5180/api/diagrams \
  -H 'content-type: application/json' \
  -d '{"name":"smoke-test","engine":"mermaid"}' | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).diagramId)')
echo "diagramId=$DID"

curl -s -X POST "http://localhost:5180/api/diagrams/$DID/patch" \
  -H 'content-type: application/json' \
  -d '{"ops":[{"op":"add_node","node":{"id":"a","label":"Auth"}},{"op":"add_node","node":{"id":"b","label":"DB"}},{"op":"add_edge","edge":{"id":"e1","from":"a","to":"b","label":"reads"}}]}' \
  | head -c 200
```
Expected: 200 with `ir`, `render.svg`.

- [ ] **Step 4: Save**

```
curl -s -X POST "http://localhost:5180/api/diagrams/$DID/save" \
  -H 'content-type: application/json' \
  -d '{"name":"smoke-test"}'
```
Expected: `{ path, slug }`.

- [ ] **Step 5: Verify file written**

```
ls /tmp/prixma-smoke/.prixmaviz/diagrams/
```
Expected: `smoke-test.pviz`, `smoke-test.svg`.

- [ ] **Step 6: Verify library list**

```
curl -s http://localhost:5180/api/library
```
Expected: `{"entries":[{"name":"smoke-test",...}]}`.

- [ ] **Step 7: Stop**

```
kill %1
```

- [ ] **Step 8: Commit (no code change, marker)**

```bash
git commit --allow-empty -m "checkpoint: Wave 6 web smoke passes"
```

---

## Wave 7 — MCP server

### Task 31: MCP stdio server skeleton

**Files:**
- Create: `packages/server/src/mcp/server.ts`

- [ ] **Step 1: Add MCP SDK dep**

Edit `packages/server/package.json` — add to `dependencies`:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@prixmaviz/shared": "workspace:*"
  }
}
```

Run `bun install`.

- [ ] **Step 2: Write `server.ts`**

Create `packages/server/src/mcp/server.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CliArgs } from "../args";
import { ensureDirs, resolvePaths } from "../bootstrap";
import { KrokiClient } from "../kroki/client";
import { DiagramStore } from "../store/diagrams";
import { WsHub } from "../ws/broadcast";
import { TOOLS, dispatchTool } from "./tools";

export async function runMcp(args: CliArgs): Promise<void> {
  const paths = resolvePaths(args.projectRoot);
  ensureDirs(paths);

  const ctx = {
    paths,
    store: new DiagramStore(),
    kroki: new KrokiClient({ baseUrl: args.krokiUrl }),
    hub: new WsHub(),
  };

  const server = new Server(
    { name: "prixmaviz", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await dispatchTool(req.params.name, req.params.arguments ?? {}, ctx);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json packages/server/src/mcp/server.ts
git commit -m "feat(mcp): stdio server skeleton"
```

---

### Task 32: MCP tools registry + create_diagram + apply_patch

**Files:**
- Create: `packages/server/src/mcp/tools.ts`
- Create: `packages/server/test/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/mcp/tools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTool } from "../../src/mcp/tools";
import { KrokiClient } from "../../src/kroki/client";
import { DiagramStore } from "../../src/store/diagrams";
import { WsHub } from "../../src/ws/broadcast";
import { resolvePaths, ensureDirs } from "../../src/bootstrap";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ctx() {
  const paths = resolvePaths(dir);
  ensureDirs(paths);
  return {
    paths,
    store: new DiagramStore(),
    kroki: new KrokiClient(),
    hub: new WsHub(),
  };
}

describe("dispatchTool", () => {
  it("create_diagram returns diagramId", async () => {
    const c = ctx();
    const out = await dispatchTool("create_diagram", { name: "x", engine: "mermaid" }, c);
    expect(typeof (out as any).diagramId).toBe("string");
  });

  it("apply_patch builds nodes and edges", async () => {
    const c = ctx();
    const created = await dispatchTool("create_diagram", { name: "x", engine: "mermaid" }, c) as { diagramId: string };
    const patched = await dispatchTool(
      "apply_patch",
      {
        diagramId: created.diagramId,
        ops: [
          { op: "add_node", node: { id: "a", label: "A" } },
          { op: "add_node", node: { id: "b", label: "B" } },
          { op: "add_edge", edge: { id: "e1", from: "a", to: "b" } },
        ],
      },
      c,
    );
    expect(Object.keys((patched as any).ir.nodes)).toEqual(["a", "b"]);
  });

  it("apply_patch on missing diagram errors", async () => {
    const c = ctx();
    await expect(
      dispatchTool("apply_patch", { diagramId: "nope", ops: [] }, c),
    ).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Verify failure**

```
bun test test/mcp/tools.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write `tools.ts`**

Create `packages/server/src/mcp/tools.ts`:

```ts
import {
  ALL_ENGINES, emptyGraphIR, emptyMeta, inferKind,
  type Diagram, type DiagramEngine, type DiagramId, type GraphIR,
  type LibraryEntry, type PatchOp, type ServerToClient,
} from "@prixmaviz/shared";
import { applyPatch } from "../ir/engine";
import type { KrokiClient } from "../kroki/client";
import type { PrixmaPaths } from "../bootstrap";
import { listPvizEntries, readPviz, writePviz } from "../pviz/io";
import { renderDiagram } from "../render";
import { DiagramStore, newDiagramId } from "../store/diagrams";
import type { WsHub } from "../ws/broadcast";

export interface ToolCtx {
  paths: PrixmaPaths;
  store: DiagramStore;
  kroki: KrokiClient;
  hub: WsHub;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "create_diagram",
    description: "Create a new diagram in memory. Not saved to disk until save_diagram.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        engine: { type: "string", enum: ALL_ENGINES },
        kind: { type: "string", enum: ["graph", "passthrough"] },
        initialDsl: { type: "string" },
      },
      required: ["name", "engine"],
    },
    run: createDiagram,
  },
  {
    name: "apply_patch",
    description: "Apply N patch ops atomically to a graph diagram. Returns new IR + render.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        ops: { type: "array" },
      },
      required: ["diagramId", "ops"],
    },
    run: applyPatchTool,
  },
  {
    name: "save_diagram",
    description: "Persist diagram to <project>/.prixmaviz/diagrams/<slug>.pviz with sibling SVG.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["diagramId"],
    },
    run: saveDiagram,
  },
  {
    name: "load_diagram",
    description: "Load a saved .pviz diagram back into memory by name (slug).",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run: loadDiagram,
  },
  {
    name: "list_diagrams",
    description: "List saved diagrams in the project library.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        search: { type: "string" },
      },
    },
    run: listDiagrams,
  },
  {
    name: "render_dsl",
    description: "Render an arbitrary diagram DSL via the chosen engine. For passthrough engines.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string", enum: ALL_ENGINES },
        source: { type: "string" },
        name: { type: "string" },
      },
      required: ["engine", "source"],
    },
    run: renderDsl,
  },
];

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return await tool.run(args, ctx);
}

async function createDiagram(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const engine = args.engine as DiagramEngine;
  const kind = (args.kind as Diagram["kind"]) ?? inferKind(engine);
  const id: DiagramId = newDiagramId();
  const diagram: Diagram = {
    id,
    name,
    engine,
    kind,
    ir: kind === "graph" ? emptyGraphIR() : undefined,
    dsl: kind === "passthrough" ? (args.initialDsl as string) ?? "" : undefined,
    meta: emptyMeta(),
  };
  ctx.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  broadcast(ctx.hub, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: id, render: outcome.result };
}

async function applyPatchTool(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as DiagramId;
  const ops = args.ops as PatchOp[];
  const d = ctx.store.get(id);
  if (!d) throw new Error("diagram not found");
  if (d.kind !== "graph" || !d.ir) throw new Error("patches only valid on graph diagrams");
  const result = applyPatch(d.ir, ops);
  if (!result.ok) {
    throw new Error(`patch failed at op ${result.opIndex}: ${result.error}`);
  }
  d.ir = result.ir;
  d.meta.updatedAt = new Date().toISOString();
  const outcome = await renderDiagram(d, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  const warnings = [...result.warnings, ...outcome.warnings];
  broadcast(ctx.hub, d, outcome.result.svg, warnings);
  return { diagramId: id, ir: d.ir, render: outcome.result, warnings };
}

async function saveDiagram(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as DiagramId;
  const d = ctx.store.get(id);
  if (!d) throw new Error("diagram not found");
  if (args.name) d.name = args.name as string;
  if (args.tags) d.meta.tags = args.tags as string[];
  d.meta.updatedAt = new Date().toISOString();
  const outcome = await renderDiagram(d, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  const written = await writePviz(ctx.paths.diagramsDir, d, outcome.result.svg);
  return { path: written.path, meta: d.meta };
}

async function loadDiagram(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const slug = name.endsWith(".pviz") ? name.replace(/\.pviz$/, "") : name;
  const path = `${ctx.paths.diagramsDir}/${slug}.pviz`;
  const file = await readPviz(path);
  const id: DiagramId = file.id;
  const diagram: Diagram = {
    id,
    name: file.name,
    engine: file.engine,
    kind: file.kind,
    ir: file.ir,
    dsl: file.dsl,
    meta: file.meta,
  };
  ctx.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  broadcast(ctx.hub, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: id, ir: diagram.ir, dsl: diagram.dsl, render: outcome.result };
}

async function listDiagrams(args: Record<string, unknown>, ctx: ToolCtx) {
  const tag = args.tag as string | undefined;
  const search = args.search as string | undefined;
  let entries: LibraryEntry[] = await listPvizEntries(ctx.paths.diagramsDir);
  if (tag) entries = entries.filter((e) => e.tags.includes(tag));
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  return { diagrams: entries };
}

async function renderDsl(args: Record<string, unknown>, ctx: ToolCtx) {
  const engine = args.engine as DiagramEngine;
  const source = args.source as string;
  const name = args.name as string | undefined;
  const id: DiagramId = newDiagramId();
  const diagram: Diagram = {
    id,
    name: name ?? "untitled",
    engine,
    kind: "passthrough",
    dsl: source,
    meta: emptyMeta(),
  };
  ctx.store.put(diagram);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) throw new Error(outcome.error);
  if (name) await writePviz(ctx.paths.diagramsDir, diagram, outcome.result.svg);
  broadcast(ctx.hub, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: id, render: outcome.result };
}

function broadcast(hub: WsHub, d: Diagram, svg: string, warnings: string[]): void {
  const msg: ServerToClient = {
    type: "render",
    diagramId: d.id,
    ir: d.ir,
    dsl: d.dsl ?? "",
    svg,
    warnings: warnings.length ? warnings : undefined,
  };
  hub.broadcast(msg);
}
```

- [ ] **Step 4: Run test**

```
bun test test/mcp/tools.test.ts
```
Expected: PASS 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/tools.ts packages/server/test/mcp/tools.test.ts
git commit -m "feat(mcp): 6 tools + dispatch"
```

---

### Task 33: MCP cross-instance lockfile + forwarding

**Files:**
- Create: `packages/server/src/mcp/lockfile.ts`
- Create: `packages/server/src/mcp/forward.ts`
- Modify: `packages/server/src/mcp/server.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write `lockfile.ts`**

Create `packages/server/src/mcp/lockfile.ts`:

```ts
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";

export interface InstanceLock {
  pid: number;
  port: number;
  startedAt: string;
}

export function writeLock(path: string, port: number): InstanceLock {
  const lock: InstanceLock = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(lock, null, 2));
  return lock;
}

export function readLock(path: string): InstanceLock | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InstanceLock;
  } catch {
    return null;
  }
}

export function clearLock(path: string): void {
  try { unlinkSync(path); } catch {}
}

export async function isLockAlive(lock: InstanceLock): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${lock.port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write `forward.ts`**

Create `packages/server/src/mcp/forward.ts`:

```ts
import type { InstanceLock } from "./lockfile";

export async function forwardCall(
  lock: InstanceLock,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = `http://127.0.0.1:${lock.port}/api/mcp/call`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, args }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`forward failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}
```

- [ ] **Step 3: Add `/api/mcp/call` HTTP route**

Modify `packages/server/src/http/routes.ts` — add at the end before the final `return undefined;`:

```ts
  if (p === "/api/mcp/call" && req.method === "POST") {
    const body = await req.json() as { tool: string; args: Record<string, unknown> };
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool(body.tool, body.args, deps as unknown as import("../mcp/tools").ToolCtx);
      return Response.json(result);
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  }
```

- [ ] **Step 4: Wire server lockfile write in `index.ts`**

Modify `packages/server/src/index.ts` — inside `runServer()` after `server` is created:

```ts
import { writeLock, clearLock } from "./mcp/lockfile";
// ...
  const lockPath = join(paths.stateDir, "instance.json");
  writeLock(lockPath, server.port);
  process.on("SIGINT", () => { clearLock(lockPath); process.exit(0); });
  process.on("SIGTERM", () => { clearLock(lockPath); process.exit(0); });
```

- [ ] **Step 5: Wire forwarding into MCP server**

Modify `packages/server/src/mcp/server.ts` — inside `runMcp()`, replace the simple dispatch with forward-or-local:

```ts
import { join } from "node:path";
import { isLockAlive, readLock } from "./lockfile";
import { forwardCall } from "./forward";

// ... inside runMcp, after building ctx:

  const lockPath = join(paths.stateDir, "instance.json");

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const lock = readLock(lockPath);
    if (lock && await isLockAlive(lock)) {
      const result = await forwardCall(lock, req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    const result = await dispatchTool(req.params.name, req.params.arguments ?? {}, ctx);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/mcp/lockfile.ts packages/server/src/mcp/forward.ts packages/server/src/mcp/server.ts packages/server/src/http/routes.ts packages/server/src/index.ts
git commit -m "feat(mcp): instance lockfile + cross-process forwarding"
```

---

### Task 34: MCP smoke

- [ ] **Step 1: Boot server**

```
mkdir -p /tmp/prixma-mcp-smoke
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-mcp-smoke 2>&1 &
sleep 1
```

- [ ] **Step 2: Boot MCP entry, send ListTools via stdin**

In a separate shell, run:
```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  cd packages/server && bun run src/index.ts --mcp --project-root /tmp/prixma-mcp-smoke 2>/dev/null
```
Expected: JSON response listing 6 tools.

- [ ] **Step 3: Stop**

```
kill %1
```

- [ ] **Step 4: Commit checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Wave 7 MCP smoke verified"
```

---

## Wave 8 — Tauri shell

### Task 35: Tauri scaffold

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/icons/icon.png` (placeholder — copy any 512x512 PNG)
- Modify: `package.json` (root)

- [ ] **Step 1: Install Tauri CLI deps**

Edit root `package.json` — add:

```json
{
  "name": "prixmaviz",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:server": "bun --filter @prixmaviz/server dev",
    "dev:web": "bun --filter @prixmaviz/web dev",
    "dev:tauri": "tauri dev",
    "build:web": "bun --filter @prixmaviz/web build",
    "build:bin": "bun run build:web && bun --filter @prixmaviz/server build:bin",
    "build:bin:darwin-arm64": "bun run build:web && bun --filter @prixmaviz/server build:bin:darwin-arm64",
    "build:bin:darwin-x64": "bun run build:web && bun --filter @prixmaviz/server build:bin:darwin-x64",
    "build:bin:linux-x64": "bun run build:web && bun --filter @prixmaviz/server build:bin:linux-x64",
    "build:bin:windows-x64": "bun run build:web && bun --filter @prixmaviz/server build:bin:windows-x64",
    "tauri": "tauri",
    "build:tauri": "bun run build:web && bun run build:bin && tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "typescript": "^5.6.0"
  }
}
```

Run `bun install`.

- [ ] **Step 2: Create `Cargo.toml`**

```toml
[package]
name = "prixmaviz"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

- [ ] **Step 3: Create `tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "PrixmaViz",
  "version": "0.1.0",
  "identifier": "io.prixmaviz.app",
  "build": {
    "beforeBuildCommand": "bun run build:web && bun run build:bin",
    "beforeDevCommand": "bun run dev:web",
    "devUrl": "http://localhost:5181",
    "frontendDist": "../packages/web/dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "PrixmaViz",
        "width": 1280,
        "height": 820,
        "minWidth": 800,
        "minHeight": 560
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "deb", "appimage"],
    "externalBin": ["binaries/prixmaviz-server"],
    "icon": ["icons/icon.png"]
  }
}
```

- [ ] **Step 4: Create `build.rs`**

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 5: Create placeholder icon**

```
mkdir -p src-tauri/icons
# user provides a 512x512 PNG; placeholder script:
bun -e 'await Bun.write("src-tauri/icons/icon.png", new Uint8Array([137,80,78,71,13,10,26,10]))'
```

(Actual icon will be replaced before release.)

- [ ] **Step 6: Commit scaffold**

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/build.rs src-tauri/icons/icon.png package.json
git commit -m "feat(tauri): scaffold Cargo + tauri.conf"
```

---

### Task 36: Tauri main.rs — sidecar lifecycle + handshake

**Files:**
- Create: `src-tauri/src/main.rs`

- [ ] **Step 1: Write `main.rs`**

```rust
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(serde::Deserialize)]
struct Handshake {
    port: u16,
}

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = boot_sidecar(handle).await {
                    eprintln!("sidecar boot error: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}

async fn boot_sidecar(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let project_root = std::env::current_dir()?
        .to_string_lossy()
        .to_string();

    let sidecar = app
        .shell()
        .sidecar("prixmaviz-server")?
        .args(["--port", "0", "--project-root", &project_root]);
    let (mut rx, child) = sidecar.spawn()?;

    let _child = Arc::new(Mutex::new(Some(child)));

    let port = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                let s = String::from_utf8_lossy(&line);
                if let Ok(hs) = serde_json::from_str::<Handshake>(s.trim()) {
                    return Ok::<u16, std::io::Error>(hs.port);
                }
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "no handshake from sidecar",
        ))
    })
    .await
    .map_err(|_| "sidecar handshake timeout")??;

    let url = format!("http://127.0.0.1:{}", port);
    let url = WebviewUrl::External(url.parse()?);

    let _window = WebviewWindowBuilder::new(&app, "main", url)
        .title("PrixmaViz")
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 560.0)
        .build()?;

    Ok(())
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(tauri): sidecar boot + handshake + window"
```

---

### Task 37: Build sidecar binary into Tauri's expected location

**Files:**
- Create: `scripts/build-sidecar-for-tauri.sh`
- Modify: `package.json`

- [ ] **Step 1: Create build script**

Create `scripts/build-sidecar-for-tauri.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

bun run build:web
bun --filter @prixmaviz/server run embed

ROOT=$(pwd)
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

build_one() {
  local target="$1"
  local triple="$2"
  local ext="${3:-}"
  echo "Building for $triple..."
  cd "$ROOT/packages/server"
  bun build ./src/index.ts --compile --target="$target" \
    --outfile "$BIN_DIR/prixmaviz-server-${triple}${ext}"
  cd "$ROOT"
}

case "$(uname)-$(uname -m)" in
  Darwin-arm64) build_one bun-darwin-arm64 aarch64-apple-darwin ;;
  Darwin-x86_64) build_one bun-darwin-x64 x86_64-apple-darwin ;;
  Linux-x86_64) build_one bun-linux-x64 x86_64-unknown-linux-gnu ;;
  *) echo "unknown host: $(uname)-$(uname -m)"; exit 1 ;;
esac

echo "sidecar built into $BIN_DIR"
```

```
chmod +x scripts/build-sidecar-for-tauri.sh
```

- [ ] **Step 2: Add npm script**

In root `package.json`, add to `scripts`:

```json
"build:sidecar": "scripts/build-sidecar-for-tauri.sh"
```

- [ ] **Step 3: Test build sidecar**

```
bun run build:sidecar
ls src-tauri/binaries/
```
Expected: a `prixmaviz-server-<triple>` binary appears.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-sidecar-for-tauri.sh package.json
chmod +x scripts/build-sidecar-for-tauri.sh
git commit -m "feat(tauri): sidecar build script + npm wiring"
```

---

### Task 38: Tauri dev smoke

- [ ] **Step 1: Build sidecar**

```
bun run build:sidecar
```

- [ ] **Step 2: Add `.gitignore` entries**

Append to `.gitignore`:

```
# Tauri
src-tauri/target/
src-tauri/binaries/prixmaviz-server-*
```

- [ ] **Step 3: Run Tauri dev (manual smoke; not part of CI)**

```
bun run dev:tauri
```
Expected: native window opens, library shows empty, ws status indicator shows "open" once handshake completes.

- [ ] **Step 4: Commit checkpoint**

```bash
git add .gitignore
git commit -m "checkpoint: Tauri dev smoke (ignore binaries dir)"
```

---

## Wave 9 — Polish + acceptance

### Task 39: Per-node motion animation refinement

**Files:**
- Modify: `packages/web/src/components/DiagramView.tsx`
- Modify: `packages/web/src/lib/svg-diff.ts`

- [ ] **Step 1: Replace DiagramView with per-node animation**

Overwrite `packages/web/src/components/DiagramView.tsx`:

```tsx
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";
import { parseSvgNodes } from "../lib/svg-diff";

export function DiagramView({ svg, diagramId }: { svg: string; diagramId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prevIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = svg;
    const root = ref.current.querySelector("svg");
    if (!root) return;

    const ids = parseSvgNodes(svg);
    const prev = new Set(prevIdsRef.current);
    const next = new Set(ids);

    for (const id of ids) {
      const g = root.querySelector(`[id="${id}"]`) as SVGGElement | null;
      if (!g) continue;
      if (!prev.has(id)) {
        g.style.transformOrigin = "center";
        g.animate(
          [
            { opacity: 0, transform: "scale(.85)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 280, easing: "cubic-bezier(.25,.46,.45,.94)" },
        );
      }
    }
    prevIdsRef.current = ids;
  }, [svg, diagramId]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={diagramId}
        ref={ref}
        className="diagram"
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.985 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
      />
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Run web build**

```
cd packages/web && bun run build
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/DiagramView.tsx
git commit -m "feat(web): per-node entrance animation in DiagramView"
```

---

### Task 40: Acceptance verification + smoke

**Files:** none (verification only)

- [ ] **Step 1: Run all unit + integration tests**

```
bun --filter @prixmaviz/server run test
bun --filter @prixmaviz/web run test
```
Expected: all pass.

- [ ] **Step 2: Build single binary**

```
bun run build:bin
ls -lh dist/prixmaviz
```
Expected: ~58MB binary.

- [ ] **Step 3: Run binary, hit smoke endpoints**

```
mkdir -p /tmp/prixma-acceptance
./dist/prixmaviz --port 5180 --project-root /tmp/prixma-acceptance &
sleep 1
curl -s http://localhost:5180/api/health
DID=$(curl -s -X POST http://localhost:5180/api/diagrams -H 'content-type: application/json' -d '{"name":"a","engine":"mermaid"}' | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).diagramId)')
curl -s -X POST http://localhost:5180/api/diagrams/$DID/patch -H 'content-type: application/json' -d '{"ops":[{"op":"add_node","node":{"id":"x","label":"X"}}]}' | head -c 200
curl -s -X POST http://localhost:5180/api/diagrams/$DID/save -H 'content-type: application/json' -d '{}' 
ls /tmp/prixma-acceptance/.prixmaviz/diagrams/
kill %1
```
Expected: health 200, save creates `<slug>.pviz` and `<slug>.svg`.

- [ ] **Step 4: Verify acceptance criteria from spec**

Walk the acceptance criteria checklist from the spec doc. For each unchecked item, perform manual smoke:

- [ ] User installs PrixmaViz Tauri app — `bun run build:tauri` produces `.dmg`/`.msi`/`.deb`.
- [ ] User opens project, Tauri window shows empty library — manual run.
- [ ] User runs `claude` in same project, MCP plugin auto-detected — install `claude_desktop_config.json` entry pointing at `dist/prixmaviz --mcp`, restart CC, verify tools appear.
- [ ] AI calls `create_diagram` → diagram appears with motion — drive via CC chat.
- [ ] AI calls `apply_patch` with multiple ops — drive via CC.
- [ ] AI calls `save_diagram` → file appears, library updates — drive via CC.
- [ ] User closes app, reopens, saved diagram in sidebar, click loads — manual.
- [ ] AI in fresh session calls `list_diagrams` → sees previously saved — drive via CC restart.
- [ ] AI calls `load_diagram` → state restored — drive via CC.
- [ ] AI calls `render_dsl` with passthrough engine — drive via CC.
- [ ] Kroki unreachable → graceful error — block with `KRoki_URL=http://127.0.0.1:1` env, retry.
- [ ] App quits cleanly: Bun sidecar terminates — `ps -ax | grep prixmaviz` after quit.

- [ ] **Step 5: Final acceptance commit**

```bash
git commit --allow-empty -m "checkpoint: Cycle 1 acceptance criteria verified"
```

---

## Self-Review

After writing the plan, here's the spec coverage check:

| Spec section | Covered by |
|---|---|
| Architecture (Bun + Tauri) | Tasks 21, 35, 36, 37 |
| Graph IR types | Task 3 |
| Patch ops + atomicity | Tasks 4, 5, 6 |
| .pviz format | Tasks 11, 12 |
| MCP 6 tools | Tasks 31, 32 |
| Tool conventions (return render, broadcast) | Tasks 20, 32 |
| Render pipeline (IR→DSL→Kroki→SVG→WS) | Tasks 7, 8, 9, 10, 15, 18, 20, 24 |
| Mermaid renderer | Task 7 |
| SVG node-id diff | Task 25 |
| Motion animation | Tasks 28, 39 |
| Save/load + library UI | Tasks 12, 27, 29 |
| Tauri shell, sidecar lifecycle | Tasks 35, 36, 37 |
| MCP plugin packaging (modes, lockfile) | Tasks 31, 33 |
| Error handling (atomic IR, Kroki, WS reconnect) | Tasks 6, 20, 24, 32, 33 |
| Testing (unit, integration, manual smoke) | Bun test in 4-12, Vitest in 22, 25, smoke in 21, 30, 34, 38, 40 |

Self-review: **passed**. All spec sections have at least one task. No "TBD"/"TODO" placeholders. Type signatures consistent across tasks (`PatchOp`, `Diagram`, `DiagramId` defined Task 3, used uniformly thereafter).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-prixmaviz-cycle-1.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch fresh subagent per task, review between tasks, fast iteration. Good for a plan this size.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
