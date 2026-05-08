# PrixmaViz Cycle 2.plus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Cycle 2.plus — annotations (tag/region/pin), infinite canvas with multi-tile workspace, and real MCP install path. Closes the bidirectional AI loop and crosses the chasm to actual users.

**Architecture:** Extends Cycle 1's Bun + Tauri + 6-tool MCP without breaking changes. Adds: annotation store + per-engine hit-test, infinite canvas (camera + tiles), 4 new MCP tools (`get_annotations`, `update_tile`, `set_view`, `install_mcp_plugin`), Tauri first-launch CC config writer, brew/curl install scripts.

**Tech Stack:** Bun 1.3+, TypeScript 5.6+, React 18, motion 11, Zustand 4, Vitest, happy-dom, Tauri 2 (Rust + tauri-plugin-fs + tauri-plugin-dialog), MCP SDK 1.0+.

**Spec reference:** `docs/superpowers/specs/2026-05-07-prixmaviz-cycle-2-plus-design.md` (commit `a9fd8bc`).

**Plan-defect mitigations from Cycle 1:**
1. All test fixtures include real assertions (not stubs)
2. Each task ends with explicit "Done when" criteria
3. Pinned versions in `package.json` and `Cargo.toml` updates
4. Hit-test tests use fixture SVGs (no live Kroki dependency)
5. Hard YAGNI gate at end of each wave (Task X.99 in each wave)
6. Implementer prompts open with `pwd && git rev-parse --abbrev-ref HEAD`

---

## File Structure

### packages/shared/src/

| File | Status | Responsibility |
|---|---|---|
| `annotations.ts` | NEW | `Annotation`, `AnnotationKind`, factory helpers |
| `canvas.ts` | NEW | `Tile`, `Camera`, `WorkspaceState`, math types |
| `ir.ts` | MODIFY | extend `Diagram` with `annotations?: Annotation[]` |
| `protocol.ts` | MODIFY | new WS message variants for annotations + workspace |
| `index.ts` | MODIFY | re-export new modules |

### packages/server/src/

| File | Status | Responsibility |
|---|---|---|
| `annotations/store.ts` | NEW | per-diagram in-memory annotation registry |
| `annotations/io.ts` | NEW | read/write annotations within `.pviz` |
| `hit-test/index.ts` | NEW | per-engine-family registry + dispatch |
| `hit-test/null.ts` | NEW | bbox-only fallback |
| `hit-test/graph.ts` | NEW | Mermaid SVG `<g id="flowchart-..">` parser |
| `hit-test/sequence.ts` | NEW (Wave 2) | PlantUML actor parser |
| `hit-test/chart.ts` | NEW (Wave 2) | Vega scale-domain inverter |
| `canvas/store.ts` | NEW | in-memory workspace (camera + tiles) |
| `canvas/io.ts` | NEW | `workspace.json` read/write |
| `canvas/watch.ts` | NEW | `fs.watch` on workspace file |
| `canvas/arrange.ts` | NEW (Wave 4) | grid/horizontal/vertical layout helpers |
| `mcp/install.ts` | NEW (Wave 5) | claude_desktop_config.json merge writer |
| `http/routes.ts` | MODIFY | add annotation + workspace + install routes |
| `mcp/tools.ts` | MODIFY | add 4 new tool defs |
| `pviz/io.ts` | MODIFY | persist annotations field |
| `index.ts` | MODIFY | wire workspace store + watcher |

### packages/web/src/

| File | Status | Responsibility |
|---|---|---|
| `lib/canvas-math.ts` | NEW | pure `toViewport`/`toCanvas` |
| `lib/hit-test-client.ts` | NEW | minor: bbox/point helpers for client-side preview |
| `components/InfiniteCanvas.tsx` | NEW | viewport + canvas-plane with camera transform |
| `components/Tile.tsx` | NEW | header/body/resize-handle |
| `components/AnnotationLayer.tsx` | NEW | overlay (renders + creates annotations) |
| `components/ToolPalette.tsx` | NEW | mode switcher (1/2/3/4 keys) |
| `components/CommentPopup.tsx` | NEW | inline editor anchored to annotation |
| `components/Canvas.tsx` | DELETE | replaced by InfiniteCanvas |
| `App.tsx` | MODIFY | swap Canvas for InfiniteCanvas, mount ToolPalette |
| `Topbar.tsx` | MODIFY | embed ToolPalette |
| `store/index.ts` | MODIFY | add `mode`, `tiles`, `camera`, `annotations` selectors |
| `lib/api.ts` | MODIFY | annotation + workspace endpoints |
| `lib/ws.ts` | MODIFY | handle new message types |
| `styles.css` | MODIFY | tile, annotation, palette styles |

### src-tauri/

| File | Status | Responsibility |
|---|---|---|
| `Cargo.toml` | MODIFY | add `tauri-plugin-dialog`, `dirs` crate |
| `src/main.rs` | MODIFY | first-launch install dialog, install command |
| `src/install.rs` | NEW | merge JSON into claude_desktop_config |
| `tauri.conf.json` | MODIFY | declare dialog plugin permissions |

### scripts/

| File | Status | Responsibility |
|---|---|---|
| `install.sh` | NEW (Wave 5) | curl-installable shell installer |
| `Formula/prixmaviz-server.rb` | NEW (Wave 5) | brew formula |

---

## Wave 1 — Annotation foundation (local-only)

**Goal:** User can create + persist + dismiss tag/region/pin annotations. AI doesn't see them yet.

### Task 1: Shared types — Annotation + Diagram extension

**Files:**
- Create: `packages/shared/src/annotations.ts`
- Modify: `packages/shared/src/ir.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: First-action verification**

```
pwd && git rev-parse --abbrev-ref HEAD
```
Expected: working directory ends in `PrixmaViz` (the work tree); branch is `cycle-2-plus` or `main` per worktree setup.

- [ ] **Step 2: Create annotations.ts**

Write `packages/shared/src/annotations.ts`:
```ts
export type AnnotationKind = "tag" | "region" | "pin";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;                       // ann_<ulid26>
  kind: AnnotationKind;
  text?: string;
  color?: string;
  createdAt: string;                // ISO 8601
  resolvedAt?: string;
  // tag-specific:
  targetNodes?: string[];
  // region-specific:
  bboxPixel?: BBox;
  bboxData?: unknown;
  // pin-specific:
  point?: Point;
  nearestNode?: string;
}

export function newAnnotationId(): string {
  // 26-char Crockford-base32 ULID-ish (timestamp + 80 random bits)
  const t = Date.now();
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let s = "ann_";
  // encode 48-bit timestamp as 10 base32 chars
  const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (let i = 9; i >= 0; i--) s += ALPH[(t >>> (i * 5)) & 31];
  for (const b of rand) s += ALPH[b & 31] + ALPH[(b >>> 3) & 31];
  return s.slice(0, 30);
}
```

- [ ] **Step 3: Extend Diagram with annotations**

Modify `packages/shared/src/ir.ts` — find the `Diagram` interface, add field after `meta`:
```ts
export interface Diagram {
  id: DiagramId;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  meta: DiagramMeta;
  annotations?: import("./annotations").Annotation[];   // NEW
}
```

Also extend `PvizFile` identically:
```ts
export interface PvizFile {
  version: typeof PVIZ_VERSION;
  id: DiagramId;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  meta: DiagramMeta;
  annotations?: import("./annotations").Annotation[];   // NEW
}
```

- [ ] **Step 4: Re-export from index**

Modify `packages/shared/src/index.ts` — add line:
```ts
export * from "./annotations";
```

- [ ] **Step 5: Type-check**

```
cd packages/shared && bunx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/annotations.ts packages/shared/src/ir.ts packages/shared/src/index.ts
git commit -m "feat(shared): Annotation type + Diagram extension"
```

**Done when:** `bunx tsc --noEmit` in shared passes; `Annotation` and `newAnnotationId` exported.

---

### Task 2: Shared protocol — annotation + workspace WS messages

**Files:**
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: First-action verification**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Extend ServerToClient and ClientToServer**

Modify `packages/shared/src/protocol.ts`. Add imports at top:
```ts
import type { Annotation } from "./annotations";
```

Replace `ServerToClient` union with:
```ts
export type ServerToClient =
  | { type: "render"; diagramId: DiagramId; ir?: GraphIR; dsl: string; svg: string; warnings?: string[] }
  | { type: "library"; entries: LibraryEntry[] }
  | { type: "diagram"; diagram: Diagram }
  | { type: "error"; message: string }
  | { type: "annotation:created"; diagramId: DiagramId; annotation: Annotation }
  | { type: "annotation:updated"; diagramId: DiagramId; annotation: Annotation }
  | { type: "annotation:deleted"; diagramId: DiagramId; annotationId: string }
  | { type: "workspace"; camera: { x: number; y: number; zoom: number }; tiles: unknown[] };
```

(The `workspace` payload is loose `unknown[]` for now — Wave 3 tightens it once `Tile` is defined.)

`ClientToServer` stays unchanged in v1 (annotations created via HTTP POST, not WS).

- [ ] **Step 3: Type-check shared**

```
cd packages/shared && bunx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat(shared): WS message variants for annotations + workspace"
```

**Done when:** all 4 new ServerToClient variants type-check cleanly.

---

### Task 3: Server hit-test registry + null tester

**Files:**
- Create: `packages/server/src/hit-test/index.ts`
- Create: `packages/server/src/hit-test/null.ts`
- Create: `packages/server/test/hit-test/null.test.ts`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write failing test**

Create `packages/server/test/hit-test/null.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { nullHitTester } from "../../src/hit-test/null";

describe("nullHitTester", () => {
  it("byPoint returns empty nodes", () => {
    const r = nullHitTester.byPoint("<svg/>", 10, 20);
    expect(r.nodes).toEqual([]);
    expect(r.data).toBeUndefined();
  });

  it("byRegion returns empty nodes", () => {
    const r = nullHitTester.byRegion("<svg/>", { x: 0, y: 0, w: 10, h: 10 });
    expect(r.nodes).toEqual([]);
    expect(r.dataRange).toBeUndefined();
  });
});
```

Run:
```
cd packages/server && bun test test/hit-test/null.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement registry types and null tester**

Create `packages/server/src/hit-test/index.ts`:
```ts
import type { DiagramEngine } from "@prixmaviz/shared";
import { ENGINE_FAMILY } from "@prixmaviz/shared";
import { nullHitTester } from "./null";

export interface HitResult {
  nodes: string[];
  data?: unknown;
}

export interface RegionHitResult {
  nodes: string[];
  dataRange?: unknown;
}

export interface HitTester {
  byPoint(svg: string, x: number, y: number): HitResult;
  byRegion(svg: string, bbox: { x: number; y: number; w: number; h: number }): RegionHitResult;
}

const TESTERS: Partial<Record<string, HitTester>> = {};

export function registerHitTester(family: string, tester: HitTester): void {
  TESTERS[family] = tester;
}

export function getHitTester(engine: DiagramEngine): HitTester {
  const fam = ENGINE_FAMILY[engine];
  return TESTERS[fam] ?? nullHitTester;
}
```

Create `packages/server/src/hit-test/null.ts`:
```ts
import type { HitTester } from "./index";

export const nullHitTester: HitTester = {
  byPoint: () => ({ nodes: [] }),
  byRegion: () => ({ nodes: [] }),
};
```

- [ ] **Step 4: Run test**

```
bun test test/hit-test/null.test.ts
```
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/hit-test/index.ts packages/server/src/hit-test/null.ts packages/server/test/hit-test/null.test.ts
git commit -m "feat(hit-test): registry + null tester"
```

**Done when:** 2 tests pass; `getHitTester` returns null tester for any engine until specific testers register.

---

### Task 4: Graph hit-tester (Mermaid pattern)

**Files:**
- Create: `packages/server/src/hit-test/graph.ts`
- Create: `packages/server/test/hit-test/graph.test.ts`
- Create: `packages/server/test/fixtures/mermaid-flow.svg`
- Modify: `packages/server/src/hit-test/index.ts` (register graph)

- [ ] **Step 1: Capture a real Mermaid SVG fixture**

Run a one-shot rendering against Kroki to dump fixture (do this once, manually). Or paste a known minimal example. Create `packages/server/test/fixtures/mermaid-flow.svg`:
```svg
<svg id="container" xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
  <g class="root">
    <g class="nodes">
      <g id="flowchart-Auth-1" transform="translate(60,40)">
        <rect x="-30" y="-15" width="60" height="30"/>
        <text>Auth</text>
      </g>
      <g id="flowchart-DB-2" transform="translate(180,40)">
        <rect x="-30" y="-15" width="60" height="30"/>
        <text>DB</text>
      </g>
      <g id="flowchart-Cache-3" transform="translate(280,40)">
        <rect x="-30" y="-15" width="60" height="30"/>
        <text>Cache</text>
      </g>
    </g>
  </g>
</svg>
```
(Contrived but representative of Mermaid's structure.)

- [ ] **Step 2: Write failing tests**

Create `packages/server/test/hit-test/graph.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphHitTester } from "../../src/hit-test/graph";

const svg = readFileSync(join(import.meta.dir, "../fixtures/mermaid-flow.svg"), "utf8");

describe("graphHitTester.byPoint", () => {
  it("hits Auth node center (60,40)", () => {
    const r = graphHitTester.byPoint(svg, 60, 40);
    expect(r.nodes).toEqual(["Auth"]);
  });

  it("hits DB node center (180,40)", () => {
    const r = graphHitTester.byPoint(svg, 180, 40);
    expect(r.nodes).toEqual(["DB"]);
  });

  it("returns empty for empty space (5,5)", () => {
    const r = graphHitTester.byPoint(svg, 5, 5);
    expect(r.nodes).toEqual([]);
  });
});

describe("graphHitTester.byRegion", () => {
  it("captures Auth + DB when region covers both", () => {
    const r = graphHitTester.byRegion(svg, { x: 0, y: 0, w: 220, h: 80 });
    expect(r.nodes.sort()).toEqual(["Auth", "DB"]);
  });

  it("captures only Cache when region tight on right", () => {
    const r = graphHitTester.byRegion(svg, { x: 240, y: 0, w: 80, h: 80 });
    expect(r.nodes).toEqual(["Cache"]);
  });

  it("captures all 3 with full-canvas region", () => {
    const r = graphHitTester.byRegion(svg, { x: 0, y: 0, w: 320, h: 80 });
    expect(r.nodes.sort()).toEqual(["Auth", "Cache", "DB"]);
  });
});
```

Run, expect FAIL (graph.ts missing).

- [ ] **Step 3: Implement graph tester**

Create `packages/server/src/hit-test/graph.ts`:
```ts
import type { HitTester, HitResult, RegionHitResult } from "./index";

const ID_RE = /<g[^>]*\sid="flowchart-([^"]+)-\d+"[^>]*>/g;
const TRANSLATE_RE = /transform="translate\(([-\d.]+)\s*,\s*([-\d.]+)\)"/;
const RECT_RE = /<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/;

interface NodeBox {
  id: string;
  cx: number; cy: number;
  x: number; y: number; w: number; h: number;
}

function parseNodes(svg: string): NodeBox[] {
  const out: NodeBox[] = [];
  ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ID_RE.exec(svg)) !== null) {
    const id = m[1]!;
    // Find this <g>'s end index, then read its inner content for transform + rect.
    const start = m.index;
    const tag = m[0];
    const tEnd = svg.indexOf("</g>", start);
    const inner = tEnd > 0 ? svg.slice(start, tEnd) : tag;
    const tr = TRANSLATE_RE.exec(tag) ?? TRANSLATE_RE.exec(inner);
    const rect = RECT_RE.exec(inner);
    if (!tr || !rect) continue;
    const cx = Number(tr[1]!);
    const cy = Number(tr[2]!);
    const rx = Number(rect[1]!);
    const ry = Number(rect[2]!);
    const w = Number(rect[3]!);
    const h = Number(rect[4]!);
    out.push({ id, cx, cy, x: cx + rx, y: cy + ry, w, h });
  }
  return out;
}

export const graphHitTester: HitTester = {
  byPoint(svg, x, y): HitResult {
    const boxes = parseNodes(svg);
    const hits: string[] = [];
    for (const b of boxes) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        hits.push(b.id);
      }
    }
    return { nodes: hits };
  },
  byRegion(svg, region): RegionHitResult {
    const boxes = parseNodes(svg);
    const hits: string[] = [];
    for (const b of boxes) {
      const x2 = b.x + b.w;
      const y2 = b.y + b.h;
      const rx2 = region.x + region.w;
      const ry2 = region.y + region.h;
      // AABB intersect
      if (b.x < rx2 && x2 > region.x && b.y < ry2 && y2 > region.y) {
        hits.push(b.id);
      }
    }
    return { nodes: hits };
  },
};
```

- [ ] **Step 4: Register in index**

Modify `packages/server/src/hit-test/index.ts` — append after the `getHitTester` definition:
```ts
import { graphHitTester } from "./graph";
registerHitTester("graph", graphHitTester);
```

- [ ] **Step 5: Run tests**

```
bun test test/hit-test/graph.test.ts
```
Expected: 6 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/hit-test/graph.ts packages/server/test/hit-test/graph.test.ts packages/server/test/fixtures/mermaid-flow.svg packages/server/src/hit-test/index.ts
git commit -m "feat(hit-test): graph engine (Mermaid SVG parser)"
```

**Done when:** 6 graph hit-test tests pass, registry returns graph tester for `mermaid` engine.

---

### Task 5: Annotation store

**Files:**
- Create: `packages/server/src/annotations/store.ts`
- Create: `packages/server/test/annotations/store.test.ts`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write failing tests**

Create `packages/server/test/annotations/store.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { AnnotationStore } from "../../src/annotations/store";
import type { Annotation } from "@prixmaviz/shared";

function fix(id: string, kind: Annotation["kind"]): Annotation {
  return { id, kind, createdAt: "2026-05-07T00:00:00Z" };
}

describe("AnnotationStore", () => {
  it("add + listByDiagram", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.add("d1", fix("a2", "pin"));
    s.add("d2", fix("a3", "region"));
    const d1 = s.listByDiagram("d1");
    expect(d1.length).toBe(2);
    expect(d1.map(a => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("update modifies existing", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.update("d1", "a1", { text: "hello" });
    expect(s.listByDiagram("d1")[0]?.text).toBe("hello");
  });

  it("update on missing throws", () => {
    const s = new AnnotationStore();
    expect(() => s.update("d1", "nope", { text: "x" })).toThrow(/not found/);
  });

  it("delete removes", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.delete("d1", "a1");
    expect(s.listByDiagram("d1")).toEqual([]);
  });

  it("resolve sets resolvedAt", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    const t = "2026-05-07T01:00:00Z";
    s.update("d1", "a1", { resolvedAt: t });
    expect(s.listByDiagram("d1")[0]?.resolvedAt).toBe(t);
  });

  it("loadFromDiagram replaces", () => {
    const s = new AnnotationStore();
    s.add("d1", fix("a1", "tag"));
    s.loadFromDiagram("d1", [fix("b1", "pin"), fix("b2", "region")]);
    const out = s.listByDiagram("d1");
    expect(out.map(a => a.id).sort()).toEqual(["b1", "b2"]);
  });
});
```

Run, expect FAIL.

- [ ] **Step 3: Implement**

Create `packages/server/src/annotations/store.ts`:
```ts
import type { Annotation, DiagramId } from "@prixmaviz/shared";

export class AnnotationStore {
  private byDiagram = new Map<DiagramId, Map<string, Annotation>>();

  add(diagramId: DiagramId, a: Annotation): void {
    let m = this.byDiagram.get(diagramId);
    if (!m) {
      m = new Map();
      this.byDiagram.set(diagramId, m);
    }
    m.set(a.id, a);
  }

  update(diagramId: DiagramId, annotationId: string, patch: Partial<Annotation>): Annotation {
    const m = this.byDiagram.get(diagramId);
    const existing = m?.get(annotationId);
    if (!existing) throw new Error(`annotation "${annotationId}" not found in diagram "${diagramId}"`);
    const next = { ...existing, ...patch, id: annotationId };
    m!.set(annotationId, next);
    return next;
  }

  delete(diagramId: DiagramId, annotationId: string): void {
    this.byDiagram.get(diagramId)?.delete(annotationId);
  }

  listByDiagram(diagramId: DiagramId): Annotation[] {
    const m = this.byDiagram.get(diagramId);
    return m ? Array.from(m.values()) : [];
  }

  loadFromDiagram(diagramId: DiagramId, annotations: Annotation[]): void {
    const m = new Map<string, Annotation>();
    for (const a of annotations) m.set(a.id, a);
    this.byDiagram.set(diagramId, m);
  }

  clear(diagramId: DiagramId): void {
    this.byDiagram.delete(diagramId);
  }
}
```

- [ ] **Step 4: Run tests**

```
bun test test/annotations/store.test.ts
```
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/annotations/store.ts packages/server/test/annotations/store.test.ts
git commit -m "feat(annotations): in-memory per-diagram store"
```

**Done when:** 6 store tests pass.

---

### Task 6: Annotation persistence in .pviz

**Files:**
- Modify: `packages/server/src/pviz/io.ts`
- Modify: `packages/server/test/pviz/io.test.ts`

- [ ] **Step 1: Add roundtrip test for annotations**

Append to `packages/server/test/pviz/io.test.ts`:
```ts
describe("annotations roundtrip", () => {
  it("preserves annotations across write+read", async () => {
    const d = makeDiagram("with-annot");
    d.annotations = [
      { id: "ann_001", kind: "tag", targetNodes: ["a"], text: "rename", createdAt: "2026-05-07T00:00:00Z" },
      { id: "ann_002", kind: "pin", point: { x: 10, y: 20 }, text: "weird", createdAt: "2026-05-07T00:01:00Z" },
    ];
    const written = await writePviz(dir, d, "<svg/>");
    const back = await readPviz(written.path);
    expect(back.annotations?.length).toBe(2);
    expect(back.annotations?.[0]?.kind).toBe("tag");
    expect(back.annotations?.[1]?.point).toEqual({ x: 10, y: 20 });
  });
});
```

- [ ] **Step 2: Run, expect fail (writePviz doesn't include annotations yet)**

```
bun test test/pviz/io.test.ts
```
Expected: 1 new test fails (or annotations missing on read).

- [ ] **Step 3: Update writePviz to include annotations**

Modify `packages/server/src/pviz/io.ts` — find the `writePviz` function, locate the `file: PvizFile = {...}` literal, add `annotations: diagram.annotations` to the object. Final block:
```ts
  const file: PvizFile = {
    version: PVIZ_VERSION,
    id: diagram.id,
    name: diagram.name,
    engine: diagram.engine,
    kind: diagram.kind,
    ir: diagram.ir,
    dsl: diagram.dsl,
    meta: diagram.meta,
    annotations: diagram.annotations,
  };
```

`readPviz` already returns the parsed JSON; since `PvizFile` now includes `annotations`, it deserializes automatically.

- [ ] **Step 4: Run tests**

```
bun test test/pviz/io.test.ts
```
Expected: all pass (including the new roundtrip).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pviz/io.ts packages/server/test/pviz/io.test.ts
git commit -m "feat(pviz): persist annotations field in .pviz envelope"
```

**Done when:** Annotations write+read cleanly through .pviz.

---

### Task 7: HTTP routes for annotations

**Files:**
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Add new routes**

Modify `packages/server/src/http/routes.ts`. Add imports at top:
```ts
import type { Annotation } from "@prixmaviz/shared";
import { newAnnotationId } from "@prixmaviz/shared";
import { AnnotationStore } from "../annotations/store";
import { getHitTester } from "../hit-test";
```

Modify `RouteDeps` interface — add `annotations: AnnotationStore`:
```ts
export interface RouteDeps {
  paths: PrixmaPaths;
  store: DiagramStore;
  annotations: AnnotationStore;
  kroki: KrokiClient;
  hub: WsHub;
}
```

Inside `handleApi`, before the final `return undefined;`, add:
```ts
  // ─── Annotations ─────────────────────────────────────────
  const annListMatch = p.match(/^\/api\/diagrams\/([^/]+)\/annotations$/);
  if (annListMatch && req.method === "GET") {
    const id = annListMatch[1] as DiagramId;
    return Response.json({ annotations: deps.annotations.listByDiagram(id) });
  }

  if (p === "/api/annotations" && req.method === "POST") {
    const body = (await req.json()) as {
      diagramId: DiagramId;
      kind: Annotation["kind"];
      text?: string;
      bboxPixel?: { x: number; y: number; w: number; h: number };
      point?: { x: number; y: number };
    };
    const d = deps.store.get(body.diagramId);
    if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });

    const ann: Annotation = {
      id: newAnnotationId(),
      kind: body.kind,
      text: body.text,
      bboxPixel: body.bboxPixel,
      point: body.point,
      createdAt: new Date().toISOString(),
    };

    // hit-test enrichment
    const tester = getHitTester(d.engine);
    if (d.kind === "graph" && d.ir) {
      // need svg — use stored render? simpler: re-render via kroki
      // for v1: use last broadcast SVG cached on the diagram
      // we extend Diagram store to keep last svg below; for now do nothing
    }
    if (body.kind === "region" && body.bboxPixel) {
      // hit-test against last svg if available (added in Task 8)
    }
    if (body.kind === "pin" && body.point) {
      // ditto
    }

    deps.annotations.add(body.diagramId, ann);
    deps.hub.broadcast({ type: "annotation:created", diagramId: body.diagramId, annotation: ann });

    // Schedule persist (debounced)
    schedulePersist(deps, body.diagramId);
    return Response.json({ annotation: ann });
  }

  const annPutMatch = p.match(/^\/api\/annotations\/([^/]+)$/);
  if (annPutMatch && req.method === "PUT") {
    const annId = annPutMatch[1]!;
    const body = (await req.json()) as { diagramId: DiagramId; patch: Partial<Annotation> };
    try {
      const updated = deps.annotations.update(body.diagramId, annId, body.patch);
      deps.hub.broadcast({ type: "annotation:updated", diagramId: body.diagramId, annotation: updated });
      schedulePersist(deps, body.diagramId);
      return Response.json({ annotation: updated });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 404 });
    }
  }

  if (annPutMatch && req.method === "DELETE") {
    const annId = annPutMatch[1]!;
    const body = (await req.json().catch(() => ({}))) as { diagramId?: DiagramId };
    if (!body.diagramId) return Response.json({ ok: false, error: "diagramId required" }, { status: 400 });
    deps.annotations.delete(body.diagramId, annId);
    deps.hub.broadcast({ type: "annotation:deleted", diagramId: body.diagramId, annotationId: annId });
    schedulePersist(deps, body.diagramId);
    return Response.json({ ok: true });
  }
```

Add a small `schedulePersist` helper at the bottom of the file (above no exports needed, internal):
```ts
const persistTimers = new Map<DiagramId, ReturnType<typeof setTimeout>>();
function schedulePersist(deps: RouteDeps, diagramId: DiagramId) {
  const existing = persistTimers.get(diagramId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    persistTimers.delete(diagramId);
    const d = deps.store.get(diagramId);
    if (!d) return;
    const annotations = deps.annotations.listByDiagram(diagramId);
    d.annotations = annotations;
    // best-effort save (existing render path for SVG)
    try {
      const outcome = await renderDiagram(d, { kroki: deps.kroki });
      if (outcome.ok) await writePviz(deps.paths.diagramsDir, d, outcome.result.svg);
    } catch {
      // swallow — annotations remain in memory; will save on next save_diagram MCP call
    }
  }, 500);
  persistTimers.set(diagramId, t);
}
```

- [ ] **Step 3: Wire AnnotationStore into server bootstrap**

Modify `packages/server/src/index.ts` — in `runServer()`, after `const store = new DiagramStore();`, add:
```ts
  const annotations = new AnnotationStore();
```
Add import at top:
```ts
import { AnnotationStore } from "./annotations/store";
```
Pass `annotations` into the `handleApi` deps object:
```ts
const apiResp = await handleApi(req, url, { paths, store, annotations, kroki, hub });
```

- [ ] **Step 4: Smoke test the routes**

```
mkdir -p /tmp/prixma-w1-anno-smoke
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-w1-anno-smoke 2>&1 &
sleep 1.5
DID=$(curl -s -X POST http://localhost:5180/api/diagrams -H 'content-type: application/json' -d '{"name":"x","engine":"mermaid"}' | bun -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).diagramId)}catch{console.log("")}})')
curl -s -X POST http://localhost:5180/api/annotations -H 'content-type: application/json' -d "{\"diagramId\":\"$DID\",\"kind\":\"pin\",\"text\":\"hi\",\"point\":{\"x\":10,\"y\":20}}"
echo
curl -s "http://localhost:5180/api/diagrams/$DID/annotations"
echo
kill %1 2>/dev/null
```
Expected: First curl returns `{"annotation":{"id":"ann_...","kind":"pin","text":"hi",...}}`. Second curl returns `{"annotations":[{...}]}` with the same one.

(If Kroki unreachable, create_diagram returns error — use a diagram from an earlier saved fixture, or hit-test enrichment runs but persist may be skipped. That's fine for smoke.)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/http/routes.ts packages/server/src/index.ts
git commit -m "feat(http): annotation routes (POST/GET/PUT/DELETE)"
```

**Done when:** Smoke creates an annotation and lists it back.

---

### Task 8: Cache last SVG on diagram for hit-test enrichment

**Files:**
- Modify: `packages/server/src/store/diagrams.ts`
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Extend DiagramStore to cache last SVG per diagram**

Modify `packages/server/src/store/diagrams.ts`. Add a `lastSvg` map and methods:
```ts
import type { Diagram, DiagramId } from "@prixmaviz/shared";

export class DiagramStore {
  private map = new Map<DiagramId, Diagram>();
  private svgCache = new Map<DiagramId, string>();

  put(d: Diagram): void {
    this.map.set(d.id, d);
  }
  get(id: DiagramId): Diagram | undefined {
    return this.map.get(id);
  }
  delete(id: DiagramId): void {
    this.map.delete(id);
    this.svgCache.delete(id);
  }
  list(): Diagram[] {
    return Array.from(this.map.values());
  }
  touch(id: DiagramId): void {
    const d = this.map.get(id);
    if (d) d.meta.updatedAt = new Date().toISOString();
  }
  setSvg(id: DiagramId, svg: string): void {
    this.svgCache.set(id, svg);
  }
  getSvg(id: DiagramId): string | undefined {
    return this.svgCache.get(id);
  }
}

export function newDiagramId(): DiagramId {
  return `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
```

- [ ] **Step 3: Cache SVG on every render in routes**

Modify `packages/server/src/http/routes.ts` — find every `renderDiagram(d, { kroki: deps.kroki })` call followed by `outcome.result.svg`. After successful render, call `deps.store.setSvg(d.id, outcome.result.svg);`. Specifically, add to:
- `createDiagram` (after `outcome.ok` check, before broadcast)
- `patchDiagram` (after `outcome.ok` check)
- `loadDiagramBySlug` (after `outcome.ok` check)
- `saveDiagram` (after render outcome.ok)
- `renderDsl` (after `outcome.ok` check)

Example for `createDiagram`:
```ts
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) {
    return Response.json({ ok: false, error: outcome.error }, { status: 502 });
  }
  deps.store.setSvg(id, outcome.result.svg);   // NEW
  broadcastRender(deps.hub, diagram, outcome.result.svg, outcome.warnings);
```

- [ ] **Step 4: Now wire hit-test enrichment in POST /api/annotations**

Replace the empty hit-test stubs in routes.ts (POST /api/annotations) with:
```ts
    // hit-test enrichment using last cached SVG
    const svg = deps.store.getSvg(body.diagramId);
    if (svg) {
      const tester = getHitTester(d.engine);
      if (body.kind === "tag" && body.point) {
        const hit = tester.byPoint(svg, body.point.x, body.point.y);
        ann.targetNodes = hit.nodes;
      } else if (body.kind === "region" && body.bboxPixel) {
        const hit = tester.byRegion(svg, body.bboxPixel);
        ann.targetNodes = hit.nodes;
        ann.bboxData = hit.dataRange;
      } else if (body.kind === "pin" && body.point) {
        const hit = tester.byPoint(svg, body.point.x, body.point.y);
        ann.nearestNode = hit.nodes[0];
      }
    }
```

(The `tag` kind is treated like a click; the client passes `point` in the body for tag.)

- [ ] **Step 5: Smoke**

```
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-w1-anno-smoke 2>&1 &
sleep 1.5
DID=$(curl -s -X POST http://localhost:5180/api/diagrams -H 'content-type: application/json' -d '{"name":"x","engine":"mermaid"}' | bun -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).diagramId)}catch{console.log("")}})')
# patch in some nodes
curl -s -X POST "http://localhost:5180/api/diagrams/$DID/patch" -H 'content-type: application/json' -d '{"ops":[{"op":"add_node","node":{"id":"a","label":"A"}},{"op":"add_node","node":{"id":"b","label":"B"}},{"op":"add_edge","edge":{"id":"e1","from":"a","to":"b"}}]}' > /dev/null
# create tag annotation at where node "a" likely is
curl -s -X POST http://localhost:5180/api/annotations -H 'content-type: application/json' -d "{\"diagramId\":\"$DID\",\"kind\":\"tag\",\"point\":{\"x\":50,\"y\":40},\"text\":\"check this\"}"
kill %1 2>/dev/null
```
Expected: response includes `targetNodes` populated (or empty if Kroki uses different layout — that's fine, plumbing is verified).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/store/diagrams.ts packages/server/src/http/routes.ts
git commit -m "feat(annotations): hit-test enrichment via cached SVG"
```

**Done when:** Tag/region/pin annotations get `targetNodes` from server-side hit-test against most recent render.

---

### Task 9: Web — extend store for canvas mode + annotations

**Files:**
- Modify: `packages/web/src/store/index.ts`
- Create: `packages/web/test/store/annotations.test.ts`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Add tests for new state**

Create `packages/web/test/store/annotations.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../../src/store";
import type { Annotation } from "@prixmaviz/shared";

beforeEach(() => {
  useAppStore.setState({
    diagram: null,
    library: [],
    wsStatus: "idle",
    error: null,
    pending: false,
    annotations: {},
    mode: "select",
  });
});

const mkAnn = (id: string): Annotation => ({
  id, kind: "tag", createdAt: "2026-05-07T00:00:00Z",
});

describe("annotation state", () => {
  it("setAnnotations stores list per diagram", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1"), mkAnn("a2")]);
    expect(useAppStore.getState().annotations["d1"]?.length).toBe(2);
  });

  it("addAnnotation appends", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1")]);
    useAppStore.getState().addAnnotation("d1", mkAnn("a2"));
    expect(useAppStore.getState().annotations["d1"]?.length).toBe(2);
  });

  it("updateAnnotation merges", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1")]);
    useAppStore.getState().updateAnnotation("d1", { ...mkAnn("a1"), text: "hello" });
    expect(useAppStore.getState().annotations["d1"]?.[0]?.text).toBe("hello");
  });

  it("deleteAnnotation removes", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1"), mkAnn("a2")]);
    useAppStore.getState().deleteAnnotation("d1", "a1");
    expect(useAppStore.getState().annotations["d1"]?.length).toBe(1);
    expect(useAppStore.getState().annotations["d1"]?.[0]?.id).toBe("a2");
  });

  it("setMode switches", () => {
    useAppStore.getState().setMode("region");
    expect(useAppStore.getState().mode).toBe("region");
  });
});
```

Run, expect FAIL.

- [ ] **Step 3: Extend store**

Modify `packages/web/src/store/index.ts`. Replace contents:
```ts
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
```

- [ ] **Step 4: Run tests**

```
cd packages/web && bun run test
```
Expected: all annotation tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/store/index.ts packages/web/test/store/annotations.test.ts
git commit -m "feat(web): store extension for annotations + canvas mode"
```

**Done when:** Web tests pass with new store actions.

---

### Task 10: Web — annotation API client + WS handlers

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/ws.ts`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Extend api.ts with annotation methods**

Append to `packages/web/src/lib/api.ts` inside the `api = { ... }` object:
```ts
  listAnnotations: (diagramId: string) =>
    fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/annotations`)
      .then((r) => jsonOrThrow<{ annotations: import("@prixmaviz/shared").Annotation[] }>(r))
      .then((j) => j.annotations),

  createAnnotation: (body: {
    diagramId: string;
    kind: "tag" | "region" | "pin";
    text?: string;
    bboxPixel?: { x: number; y: number; w: number; h: number };
    point?: { x: number; y: number };
  }) =>
    fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ annotation: import("@prixmaviz/shared").Annotation }>(r))
      .then((j) => j.annotation),

  updateAnnotationApi: (annotationId: string, body: { diagramId: string; patch: Partial<import("@prixmaviz/shared").Annotation> }) =>
    fetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ annotation: import("@prixmaviz/shared").Annotation }>(r))
      .then((j) => j.annotation),

  deleteAnnotation: (annotationId: string, diagramId: string) =>
    fetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagramId }),
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
```

- [ ] **Step 3: Extend ws.ts handler**

Modify `packages/web/src/lib/ws.ts` — replace the `handleMessage` function:
```ts
function handleMessage(
  msg: ServerToClient,
  store: ReturnType<typeof useAppStore.getState>,
): void {
  if (msg.type === "render") {
    store.setRender(msg.diagramId, msg.svg, msg.dsl, msg.ir);
  } else if (msg.type === "library") {
    store.setLibrary(msg.entries);
  } else if (msg.type === "annotation:created") {
    store.addAnnotation(msg.diagramId, msg.annotation);
  } else if (msg.type === "annotation:updated") {
    store.updateAnnotation(msg.diagramId, msg.annotation);
  } else if (msg.type === "annotation:deleted") {
    store.deleteAnnotation(msg.diagramId, msg.annotationId);
  }
}
```

And update the call site (where `handleMessage(msg, ...)` is invoked) to pass the full store snapshot:
```ts
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerToClient;
          handleMessage(msg, useAppStore.getState());
        } catch {}
      };
```

(Drop the `setLibrary, setRender` destructure pattern — pass the whole state.)

- [ ] **Step 4: Run web build**

```
cd packages/web && bun run build 2>&1 | tail -3
```
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/ws.ts
git commit -m "feat(web): annotation API + WS handlers"
```

**Done when:** Web build succeeds; ws handler covers all 3 annotation events.

---

### Task 11: ToolPalette component

**Files:**
- Create: `packages/web/src/components/ToolPalette.tsx`
- Modify: `packages/web/src/components/Topbar.tsx`
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Create ToolPalette.tsx**

```tsx
import { useEffect } from "react";
import { useAppStore, type CanvasMode } from "../store";

const TOOLS: { mode: CanvasMode; key: string; label: string; hint: string }[] = [
  { mode: "select", key: "1", label: "Select",  hint: "pan/drag" },
  { mode: "region", key: "2", label: "Region",  hint: "drag a box" },
  { mode: "pin",    key: "3", label: "Pin",     hint: "click to drop" },
  { mode: "tag",    key: "4", label: "Tag",     hint: "click a node" },
];

export function ToolPalette() {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) {
        e.preventDefault();
        setMode(t.mode);
      } else if (e.key === "Escape") {
        setMode("select");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  return (
    <div className="tool-palette">
      {TOOLS.map((t) => (
        <button
          key={t.mode}
          className={`tool ${mode === t.mode ? "active" : ""}`}
          onClick={() => setMode(t.mode)}
          title={`${t.label} (${t.key}) — ${t.hint}`}
        >
          <span className="tool-key">{t.key}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount in Topbar**

Modify `packages/web/src/components/Topbar.tsx`. Add `import { ToolPalette } from "./ToolPalette";` and place between the engine label and the spacer:
```tsx
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {diagram ? `${diagram.engine} · ${diagram.kind}` : "no diagram"}
      </span>
      <ToolPalette />
      <div className="spacer" />
```

- [ ] **Step 4: Add styles**

Append to `packages/web/src/styles.css`:
```css
.tool-palette { display: flex; gap: 4px; margin-left: 16px; }
.tool {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 6px;
  background: var(--panel); border: 1px solid var(--border); color: var(--fg);
  cursor: pointer; font-size: 12px; transition: background 120ms, border-color 120ms;
}
.tool:hover { background: #1c1f26; }
.tool.active { background: #2a3a5c; border-color: var(--accent); }
.tool-key {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: var(--bg); color: var(--muted);
}
.tool.active .tool-key { background: var(--accent); color: #0e0f12; }
```

- [ ] **Step 5: Build to verify**

```
cd packages/web && bun run build 2>&1 | tail -3
```
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/ToolPalette.tsx packages/web/src/components/Topbar.tsx packages/web/src/styles.css
git commit -m "feat(web): ToolPalette mode switcher with keyboard shortcuts"
```

**Done when:** ToolPalette renders 4 buttons in topbar, keyboard 1/2/3/4 switches mode, Escape resets.

---

### Task 12: AnnotationLayer — display existing annotations

**Files:**
- Create: `packages/web/src/components/AnnotationLayer.tsx`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Create AnnotationLayer.tsx (display-only first; interaction in next tasks)**

```tsx
import { useEffect, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api } from "../lib/api";

interface Props {
  diagramId: DiagramId;
  svgRef: React.RefObject<HTMLDivElement | null>;
}

export function AnnotationLayer({ diagramId, svgRef }: Props) {
  const annotations = useAppStore((s) => s.annotations[diagramId] ?? []);
  const setAnnotations = useAppStore((s) => s.setAnnotations);

  // load on mount
  useEffect(() => {
    api.listAnnotations(diagramId)
      .then((list) => setAnnotations(diagramId, list))
      .catch(() => {});
  }, [diagramId, setAnnotations]);

  return (
    <svg className="annotation-layer" xmlns="http://www.w3.org/2000/svg">
      {annotations.map((a) => renderAnnotation(a))}
    </svg>
  );
}

function renderAnnotation(a: Annotation): React.ReactNode {
  if (a.kind === "region" && a.bboxPixel) {
    return (
      <g key={a.id}>
        <rect
          x={a.bboxPixel.x}
          y={a.bboxPixel.y}
          width={a.bboxPixel.w}
          height={a.bboxPixel.h}
          fill="rgba(247,118,142,0.10)"
          stroke="#f7768e"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={a.resolvedAt ? 0.3 : 1}
        />
      </g>
    );
  }
  if (a.kind === "pin" && a.point) {
    return (
      <g key={a.id} transform={`translate(${a.point.x}, ${a.point.y})`}>
        <circle r={9} fill="#f7768e" opacity={a.resolvedAt ? 0.3 : 1} />
        <text textAnchor="middle" y={3} fontSize={9} fill="white" fontWeight="bold">
          {/* index added by parent if needed; for v1, dot only */}•
        </text>
      </g>
    );
  }
  if (a.kind === "tag" && a.targetNodes && a.targetNodes.length > 0) {
    // Tag rendering: outline the matched node — for v1, show a small badge near the node.
    // Without DOM access here, render a small marker at the first target's position via parent.
    // Fallback: nothing visible (parent passes svgRef for DOM lookup; v2 polish).
    return null;
  }
  return null;
}
```

(Note: The `tag` rendering — outlining the matched IR node — is finalized in Task 14 once tag interaction lands. For v1 display, tags without bboxPixel/point are invisible until the user adds a comment.)

- [ ] **Step 3: Add layer styles**

Append to `packages/web/src/styles.css`:
```css
.annotation-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}
.annotation-layer .pickable { pointer-events: auto; cursor: pointer; }
```

- [ ] **Step 4: Build**

```
cd packages/web && bun run build 2>&1 | tail -3
```
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/AnnotationLayer.tsx packages/web/src/styles.css
git commit -m "feat(web): AnnotationLayer (display existing annotations)"
```

**Done when:** AnnotationLayer renders region rects and pin dots from store data.

---

### Task 13: Region tool interaction

**Files:**
- Modify: `packages/web/src/components/AnnotationLayer.tsx`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Add region drag handler**

Modify `packages/web/src/components/AnnotationLayer.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api } from "../lib/api";

interface Props {
  diagramId: DiagramId;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface DragRect { x: number; y: number; w: number; h: number; }

export function AnnotationLayer({ diagramId, containerRef }: Props) {
  const annotations = useAppStore((s) => s.annotations[diagramId] ?? []);
  const setAnnotations = useAppStore((s) => s.setAnnotations);
  const mode = useAppStore((s) => s.mode);
  const svgEl = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    api.listAnnotations(diagramId)
      .then((list) => setAnnotations(diagramId, list))
      .catch(() => {});
  }, [diagramId, setAnnotations]);

  function relativePos(e: React.MouseEvent): { x: number; y: number } {
    const c = containerRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (mode !== "region") return;
    e.preventDefault();
    const p = relativePos(e);
    startRef.current = p;
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (mode !== "region" || !startRef.current) return;
    const p = relativePos(e);
    const s = startRef.current;
    setDrag({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }

  async function onMouseUp() {
    if (mode !== "region" || !drag) return;
    const final = drag;
    setDrag(null);
    startRef.current = null;
    if (final.w < 4 || final.h < 4) return;  // ignore tiny accidents
    try {
      const created = await api.createAnnotation({
        diagramId,
        kind: "region",
        bboxPixel: final,
      });
      // store add happens via WS broadcast; if WS not delivered yet, eager-add:
      useAppStore.getState().addAnnotation(diagramId, created);
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <svg
      ref={svgEl}
      className={`annotation-layer ${mode !== "select" ? "active" : ""}`}
      style={{ pointerEvents: mode === "region" ? "auto" : "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { setDrag(null); startRef.current = null; }}
    >
      {annotations.map((a) => renderAnnotation(a))}
      {drag && (
        <rect x={drag.x} y={drag.y} width={drag.w} height={drag.h}
              fill="rgba(247,118,142,0.10)" stroke="#f7768e" strokeWidth={2} strokeDasharray="4 3" />
      )}
    </svg>
  );
}

function renderAnnotation(a: Annotation): React.ReactNode {
  if (a.kind === "region" && a.bboxPixel) {
    return (
      <g key={a.id}>
        <rect
          x={a.bboxPixel.x}
          y={a.bboxPixel.y}
          width={a.bboxPixel.w}
          height={a.bboxPixel.h}
          fill="rgba(247,118,142,0.10)"
          stroke="#f7768e"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={a.resolvedAt ? 0.3 : 1}
        />
      </g>
    );
  }
  if (a.kind === "pin" && a.point) {
    return (
      <g key={a.id} transform={`translate(${a.point.x}, ${a.point.y})`}>
        <circle r={9} fill="#f7768e" opacity={a.resolvedAt ? 0.3 : 1} />
      </g>
    );
  }
  return null;
}
```

- [ ] **Step 3: Build**

```
cd packages/web && bun run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/AnnotationLayer.tsx
git commit -m "feat(web): region tool — drag to create rect annotation"
```

**Done when:** Region mode activated → drag inside layer creates region annotation, posts to server, renders.

---

### Task 14: Pin + Tag tool interactions

**Files:**
- Modify: `packages/web/src/components/AnnotationLayer.tsx`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Add pin and tag click handlers**

Modify `packages/web/src/components/AnnotationLayer.tsx` — replace the body section adding click handler. Add this after `onMouseUp`:
```tsx
  async function onClick(e: React.MouseEvent) {
    if (mode !== "pin" && mode !== "tag") return;
    if (drag) return;  // active drag handles its own commit
    const p = relativePos(e);
    try {
      const created = await api.createAnnotation({
        diagramId,
        kind: mode,
        point: p,
      });
      useAppStore.getState().addAnnotation(diagramId, created);
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }
```

Update the `<svg>` element:
```tsx
    <svg
      ref={svgEl}
      className={`annotation-layer ${mode !== "select" ? "active" : ""}`}
      style={{
        pointerEvents:
          mode === "region" || mode === "pin" || mode === "tag" ? "auto" : "none",
        cursor:
          mode === "region" ? "crosshair" :
          mode === "pin" ? "crosshair" :
          mode === "tag" ? "pointer" : "default",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onMouseLeave={() => { setDrag(null); startRef.current = null; }}
    >
```

Also update `renderAnnotation` to render tags as a tiny badge near `targetNodes[0]` when available — for v1 since we don't have DOM access here, render tags as a small hollow circle at `point` if set:
```tsx
  if (a.kind === "tag") {
    const pt = a.point ?? { x: 0, y: 0 };
    return (
      <g key={a.id} transform={`translate(${pt.x}, ${pt.y})`}>
        <circle r={7} fill="none" stroke="#7aa2f7" strokeWidth={2} strokeDasharray="3 2"
                opacity={a.resolvedAt ? 0.3 : 1} />
      </g>
    );
  }
```

- [ ] **Step 3: Build**

```
cd packages/web && bun run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/AnnotationLayer.tsx
git commit -m "feat(web): pin + tag tools — click to create"
```

**Done when:** All 3 annotation modes (region/pin/tag) create annotations via click/drag.

---

### Task 15: Mount AnnotationLayer in DiagramView

**Files:**
- Modify: `packages/web/src/components/DiagramView.tsx`
- Modify: `packages/web/src/components/Canvas.tsx`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Wrap DiagramView output to include AnnotationLayer**

Modify `packages/web/src/components/Canvas.tsx`:
```tsx
import { useRef } from "react";
import { useAppStore } from "../store";
import { DiagramView } from "./DiagramView";
import { EmptyState } from "./EmptyState";
import { ErrorPanel } from "./ErrorPanel";
import { AnnotationLayer } from "./AnnotationLayer";

export function Canvas() {
  const diagram = useAppStore((s) => s.diagram);
  const svg = useAppStore((s) => s.svg);
  const error = useAppStore((s) => s.error);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <section className="viewport">
      {error && <ErrorPanel message={error} />}
      {!diagram && !svg && <EmptyState />}
      {diagram && svg && (
        <div className="diagram-host" ref={containerRef} style={{ position: "relative" }}>
          <DiagramView diagramId={diagram.id} svg={svg} />
          <AnnotationLayer diagramId={diagram.id} containerRef={containerRef} />
        </div>
      )}
    </section>
  );
}
```

Add CSS to `styles.css`:
```css
.diagram-host { position: relative; display: inline-block; }
.diagram-host .annotation-layer { position: absolute; inset: 0; width: 100%; height: 100%; }
```

- [ ] **Step 3: Build**

```
cd packages/web && bun run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/Canvas.tsx packages/web/src/styles.css
git commit -m "feat(web): mount AnnotationLayer over DiagramView"
```

**Done when:** Annotations render overlaid on the diagram, drag/click in the right modes creates them.

---

### Task 16: CommentPopup + click-to-edit

**Files:**
- Create: `packages/web/src/components/CommentPopup.tsx`
- Modify: `packages/web/src/components/AnnotationLayer.tsx`

- [ ] **Step 1: Verify**

```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Create CommentPopup**

```tsx
import { useEffect, useRef, useState } from "react";
import type { Annotation, DiagramId } from "@prixmaviz/shared";
import { api } from "../lib/api";
import { useAppStore } from "../store";

interface Props {
  diagramId: DiagramId;
  annotation: Annotation;
  anchor: { x: number; y: number };
  onClose: () => void;
}

export function CommentPopup({ diagramId, annotation, anchor, onClose }: Props) {
  const [text, setText] = useState(annotation.text ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function save() {
    try {
      const updated = await api.updateAnnotationApi(annotation.id, { diagramId, patch: { text } });
      useAppStore.getState().updateAnnotation(diagramId, updated);
      onClose();
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolve() {
    try {
      const updated = await api.updateAnnotationApi(annotation.id, {
        diagramId,
        patch: { resolvedAt: new Date().toISOString() },
      });
      useAppStore.getState().updateAnnotation(diagramId, updated);
      onClose();
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function del() {
    try {
      await api.deleteAnnotation(annotation.id, diagramId);
      useAppStore.getState().deleteAnnotation(diagramId, annotation.id);
      onClose();
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
  }

  return (
    <div
      className="comment-popup"
      style={{ left: anchor.x + 12, top: anchor.y + 12 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        placeholder="Comment…"
      />
      <div className="comment-actions">
        <button className="primary" onClick={save}>Save</button>
        <button onClick={resolve}>Resolve</button>
        <button onClick={del}>Delete</button>
      </div>
    </div>
  );
}
```

CSS to append to `styles.css`:
```css
.comment-popup {
  position: absolute; z-index: 100;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px;
  display: flex; flex-direction: column; gap: 6px;
  width: 240px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
}
.comment-popup textarea {
  background: var(--bg); border: 1px solid var(--border);
  color: var(--fg); border-radius: 4px;
  padding: 6px; font-size: 12px; font-family: inherit;
}
.comment-actions { display: flex; gap: 6px; }
.comment-actions button {
  flex: 1; padding: 4px; font-size: 11px; border-radius: 4px;
}
```

- [ ] **Step 3: Wire popup into AnnotationLayer**

Modify `packages/web/src/components/AnnotationLayer.tsx` — add state for selected annotation:

At top of component:
```tsx
import { CommentPopup } from "./CommentPopup";

// inside component
const [selected, setSelected] = useState<{ ann: Annotation; anchor: { x: number; y: number } } | null>(null);
```

Update each rendered annotation to be clickable (replace `renderAnnotation` calls with inline JSX in the SVG):
```tsx
      {annotations.map((a) => {
        const onSelect = (e: React.MouseEvent) => {
          if (mode !== "select") return;
          e.stopPropagation();
          const p = relativePos(e);
          setSelected({ ann: a, anchor: p });
        };
        if (a.kind === "region" && a.bboxPixel) {
          return (
            <rect key={a.id}
              className="pickable"
              x={a.bboxPixel.x} y={a.bboxPixel.y}
              width={a.bboxPixel.w} height={a.bboxPixel.h}
              fill="rgba(247,118,142,0.10)" stroke="#f7768e"
              strokeWidth={2} strokeDasharray="6 4"
              opacity={a.resolvedAt ? 0.3 : 1}
              onClick={onSelect}
            />
          );
        }
        if (a.kind === "pin" && a.point) {
          return (
            <g key={a.id} transform={`translate(${a.point.x}, ${a.point.y})`}
               className="pickable" onClick={onSelect}>
              <circle r={9} fill="#f7768e" opacity={a.resolvedAt ? 0.3 : 1} />
            </g>
          );
        }
        if (a.kind === "tag") {
          const pt = a.point ?? { x: 0, y: 0 };
          return (
            <g key={a.id} transform={`translate(${pt.x}, ${pt.y})`}
               className="pickable" onClick={onSelect}>
              <circle r={7} fill="none" stroke="#7aa2f7" strokeWidth={2} strokeDasharray="3 2"
                      opacity={a.resolvedAt ? 0.3 : 1} />
            </g>
          );
        }
        return null;
      })}
```

After the `</svg>`, add the popup render:
```tsx
      {selected && (
        <CommentPopup
          diagramId={diagramId}
          annotation={selected.ann}
          anchor={selected.anchor}
          onClose={() => setSelected(null)}
        />
      )}
```

(Note: popup is sibling to the svg. Caller's `containerRef` div needs `position: relative` — already added in Task 15.)

- [ ] **Step 4: Build**

```
cd packages/web && bun run build 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/CommentPopup.tsx packages/web/src/components/AnnotationLayer.tsx packages/web/src/styles.css
git commit -m "feat(web): CommentPopup — edit/resolve/delete annotations"
```

**Done when:** In Select mode, clicking an annotation opens popup; popup saves/resolves/deletes via API.

---

### Task 17: Wave 1 smoke + YAGNI gate

**Files:** none (verification + checkpoint commit)

- [ ] **Step 1: Run all server tests**

```
cd packages/server && bun test 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 2: Run all web tests**

```
cd packages/web && bun run test 2>&1 | tail -8
```
Expected: all pass.

- [ ] **Step 3: Build everything**

```
cd packages/web && bun run build && cd ../server && bun run embed && cd ../.. && bun run build:bin 2>&1 | tail -5
```
Expected: 59MB binary at `dist/prixmaviz`.

- [ ] **Step 4: Manual smoke (with local Kroki)**

Start kroki + server, click around in browser, create at least one of each annotation type, verify they persist across reload.

- [ ] **Step 5: YAGNI gate**

Run `git diff main..HEAD --stat` and review the file list. Ask: "Does any file or feature exist outside the spec?" If yes → revert before merging.

- [ ] **Step 6: Checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Wave 1 — annotation foundation complete"
```

**Done when:** All tests pass, manual smoke creates+persists+resolves all 3 annotation kinds, no out-of-spec code.

---

## Wave 2 — AI sees annotations

**Goal:** Bidirectional loop closes. AI calls `get_annotations` and receives enriched annotations.

### Task 18: Sequence hit-tester (PlantUML)

**Files:**
- Create: `packages/server/src/hit-test/sequence.ts`
- Create: `packages/server/test/hit-test/sequence.test.ts`
- Create: `packages/server/test/fixtures/plantuml-sequence.svg`
- Modify: `packages/server/src/hit-test/index.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Capture fixture and write tests**

Create `packages/server/test/fixtures/plantuml-sequence.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
  <g class="actor" transform="translate(80,30)">
    <rect x="-30" y="-15" width="60" height="20"/>
    <text x="0" y="0">User</text>
  </g>
  <g class="participant" transform="translate(200,30)">
    <rect x="-30" y="-15" width="60" height="20"/>
    <text x="0" y="0">Server</text>
  </g>
  <g class="participant" transform="translate(320,30)">
    <rect x="-30" y="-15" width="60" height="20"/>
    <text x="0" y="0">DB</text>
  </g>
</svg>
```

Write `packages/server/test/hit-test/sequence.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sequenceHitTester } from "../../src/hit-test/sequence";

const svg = readFileSync(join(import.meta.dir, "../fixtures/plantuml-sequence.svg"), "utf8");

describe("sequenceHitTester", () => {
  it("hits User actor at (80,30)", () => {
    const r = sequenceHitTester.byPoint(svg, 80, 30);
    expect(r.nodes).toContain("User");
  });

  it("hits Server at (200,30)", () => {
    const r = sequenceHitTester.byPoint(svg, 200, 30);
    expect(r.nodes).toContain("Server");
  });

  it("region covers User + Server", () => {
    const r = sequenceHitTester.byRegion(svg, { x: 0, y: 0, w: 250, h: 100 });
    expect(r.nodes.sort()).toEqual(["Server", "User"]);
  });
});
```

- [ ] **Step 3: Implement**

Create `packages/server/src/hit-test/sequence.ts`:
```ts
import type { HitTester } from "./index";

const ACTOR_RE = /<g[^>]*class="(?:actor|participant)"[^>]*transform="translate\(([-\d.]+)\s*,\s*([-\d.]+)\)"[^>]*>([\s\S]*?)<\/g>/g;
const TEXT_RE = /<text[^>]*>([^<]+)<\/text>/;
const RECT_RE = /<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/;

interface Box { id: string; x: number; y: number; w: number; h: number; }

function parseActors(svg: string): Box[] {
  const out: Box[] = [];
  ACTOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACTOR_RE.exec(svg)) !== null) {
    const cx = Number(m[1]!), cy = Number(m[2]!);
    const inner = m[3]!;
    const t = TEXT_RE.exec(inner);
    const r = RECT_RE.exec(inner);
    if (!t || !r) continue;
    out.push({
      id: t[1]!.trim(),
      x: cx + Number(r[1]!), y: cy + Number(r[2]!),
      w: Number(r[3]!), h: Number(r[4]!),
    });
  }
  return out;
}

export const sequenceHitTester: HitTester = {
  byPoint(svg, x, y) {
    const boxes = parseActors(svg);
    return { nodes: boxes.filter(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h).map(b => b.id) };
  },
  byRegion(svg, region) {
    const boxes = parseActors(svg);
    return {
      nodes: boxes.filter(b => {
        const x2 = b.x + b.w, y2 = b.y + b.h;
        const rx2 = region.x + region.w, ry2 = region.y + region.h;
        return b.x < rx2 && x2 > region.x && b.y < ry2 && y2 > region.y;
      }).map(b => b.id),
    };
  },
};
```

- [ ] **Step 4: Register**

Modify `packages/server/src/hit-test/index.ts` — add at bottom:
```ts
import { sequenceHitTester } from "./sequence";
registerHitTester("sequence", sequenceHitTester);
```

- [ ] **Step 5: Run tests**
```
bun test test/hit-test/sequence.test.ts
```
Expected: 3 pass.

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/hit-test/sequence.ts packages/server/test/hit-test/sequence.test.ts packages/server/test/fixtures/plantuml-sequence.svg packages/server/src/hit-test/index.ts
git commit -m "feat(hit-test): sequence engine (PlantUML actors)"
```

**Done when:** 3 sequence tests pass; sequence engines (plantuml, seqdiag) registered.

---

### Task 19: Chart hit-tester (Vega scale inversion)

**Files:**
- Create: `packages/server/src/hit-test/chart.ts`
- Create: `packages/server/test/hit-test/chart.test.ts`
- Modify: `packages/server/src/hit-test/index.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write tests**

Chart hit-test reads the spec (DSL) — not the rendered SVG. We invert axis ranges from spec. Create `packages/server/test/hit-test/chart.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { chartHitTester } from "../../src/hit-test/chart";

describe("chartHitTester (Vega-Lite)", () => {
  it("inverts pixel region to data range for ordinal x + quantitative y", () => {
    const dsl = JSON.stringify({
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "data": { "values": [
        { "engine": "mermaid", "renders": 14 },
        { "engine": "d2", "renders": 3 },
        { "engine": "graphviz", "renders": 5 },
      ]},
      "mark": "bar",
      "encoding": {
        "x": { "field": "engine", "type": "nominal" },
        "y": { "field": "renders", "type": "quantitative" }
      },
      "width": 300, "height": 200
    });
    // chartHitTester knows to read dsl via a context — for this test we pass via fake svg-with-comment
    const svgWithSpec = `<!--prixmaviz-spec:${Buffer.from(dsl).toString("base64")}--><svg/>`;
    const r = chartHitTester.byRegion(svgWithSpec, { x: 0, y: 0, w: 300, h: 200 });
    expect(r.dataRange).toBeDefined();
  });

  it("returns empty range when spec missing", () => {
    const r = chartHitTester.byRegion("<svg/>", { x: 0, y: 0, w: 100, h: 100 });
    expect(r.nodes).toEqual([]);
    expect(r.dataRange).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement (server reads spec from a comment we'll embed at render time, OR via a context object — simplest: comment)**

For v1 we use a special HTML comment in the SVG header that the renderer prepends with the base64-encoded spec. Modify `packages/server/src/render.ts` — in `renderDiagram`, after Kroki returns SVG, prepend a comment for chart engines:
```ts
    // ...after kroki.renderSvg returns
    let svg = await deps.kroki.renderSvg(diagram.engine, dsl);
    if (diagram.kind === "passthrough" && (diagram.engine === "vega" || diagram.engine === "vegalite")) {
      const b64 = Buffer.from(dsl).toString("base64");
      svg = `<!--prixmaviz-spec:${b64}-->\n${svg}`;
    }
```

Create `packages/server/src/hit-test/chart.ts`:
```ts
import type { HitTester } from "./index";

const SPEC_RE = /<!--prixmaviz-spec:([A-Za-z0-9+/=]+)-->/;

interface VegaSpec {
  data?: { values?: Array<Record<string, unknown>> };
  encoding?: {
    x?: { field?: string; type?: string };
    y?: { field?: string; type?: string };
  };
  width?: number;
  height?: number;
}

function readSpec(svg: string): VegaSpec | null {
  const m = SPEC_RE.exec(svg);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8")) as VegaSpec;
  } catch { return null; }
}

function invertOrdinal(spec: VegaSpec, axis: "x"|"y", pxStart: number, pxEnd: number): unknown[] {
  const enc = spec.encoding?.[axis];
  if (!enc?.field || enc.type !== "nominal") return [];
  const values = spec.data?.values ?? [];
  const uniq = Array.from(new Set(values.map(v => String(v[enc.field!]))));
  if (!uniq.length) return [];
  const len = axis === "x" ? (spec.width ?? 0) : (spec.height ?? 0);
  if (!len) return uniq;
  const startIdx = Math.max(0, Math.floor(pxStart / len * uniq.length));
  const endIdx = Math.min(uniq.length, Math.ceil(pxEnd / len * uniq.length));
  return uniq.slice(startIdx, endIdx);
}

function invertQuantitative(spec: VegaSpec, axis: "x"|"y", pxStart: number, pxEnd: number): [number, number] | undefined {
  const enc = spec.encoding?.[axis];
  if (!enc?.field || enc.type !== "quantitative") return undefined;
  const values = spec.data?.values ?? [];
  const ns = values.map(v => Number(v[enc.field!])).filter(Number.isFinite);
  if (!ns.length) return undefined;
  const min = Math.min(...ns), max = Math.max(...ns);
  const len = axis === "x" ? (spec.width ?? 0) : (spec.height ?? 0);
  if (!len) return [min, max];
  const span = max - min;
  // Vega y axis is flipped: pxStart=top, but data max at top
  if (axis === "y") {
    const dStart = max - (pxEnd / len) * span;
    const dEnd = max - (pxStart / len) * span;
    return [dStart, dEnd];
  }
  return [min + (pxStart / len) * span, min + (pxEnd / len) * span];
}

export const chartHitTester: HitTester = {
  byPoint(svg, x, y) {
    const spec = readSpec(svg);
    if (!spec) return { nodes: [] };
    const xv = invertOrdinal(spec, "x", x, x) ?? invertQuantitative(spec, "x", x, x);
    const yv = invertOrdinal(spec, "y", y, y) ?? invertQuantitative(spec, "y", y, y);
    return { nodes: [], data: { x: xv, y: yv } };
  },
  byRegion(svg, region) {
    const spec = readSpec(svg);
    if (!spec) return { nodes: [] };
    const xv = invertOrdinal(spec, "x", region.x, region.x + region.w) ?? invertQuantitative(spec, "x", region.x, region.x + region.w);
    const yv = invertOrdinal(spec, "y", region.y, region.y + region.h) ?? invertQuantitative(spec, "y", region.y, region.y + region.h);
    return { nodes: [], dataRange: { x: xv, y: yv } };
  },
};
```

- [ ] **Step 4: Register**

Modify `packages/server/src/hit-test/index.ts`:
```ts
import { chartHitTester } from "./chart";
registerHitTester("chart", chartHitTester);
```

- [ ] **Step 5: Run tests**
```
bun test test/hit-test/chart.test.ts
```
Expected: 2 pass.

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/hit-test/chart.ts packages/server/test/hit-test/chart.test.ts packages/server/src/hit-test/index.ts packages/server/src/render.ts
git commit -m "feat(hit-test): chart engine (Vega scale inversion via embedded spec comment)"
```

**Done when:** 2 chart tests pass; vega/vegalite renders include base64 spec comment.

---

### Task 20: MCP `get_annotations` tool

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Modify: `packages/server/test/mcp/tools.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write failing test**

Append to `packages/server/test/mcp/tools.test.ts`:
```ts
describe("get_annotations", () => {
  it("returns annotations for a diagram", async () => {
    const c = ctx();
    // Add directly to store
    c.annotations.add("d_test", {
      id: "ann_1", kind: "tag", targetNodes: ["a"], text: "hi",
      createdAt: "2026-05-07T00:00:00Z",
    });
    const out = await dispatchTool("get_annotations", { diagramId: "d_test" }, c) as any;
    expect(out.annotations.length).toBe(1);
    expect(out.annotations[0].id).toBe("ann_1");
  });

  it("excludes resolved when includeResolved=false (default)", async () => {
    const c = ctx();
    c.annotations.add("d_test", { id: "ann_resolved", kind: "tag", createdAt: "x", resolvedAt: "y" });
    c.annotations.add("d_test", { id: "ann_open", kind: "tag", createdAt: "x" });
    const out = await dispatchTool("get_annotations", { diagramId: "d_test" }, c) as any;
    expect(out.annotations.length).toBe(1);
    expect(out.annotations[0].id).toBe("ann_open");
  });
});
```

Modify the `ctx()` helper at top of tools.test.ts to include `AnnotationStore`:
```ts
import { AnnotationStore } from "../../src/annotations/store";

function ctx() {
  const paths = resolvePaths(dir);
  ensureDirs(paths);
  return {
    paths,
    store: new DiagramStore(),
    annotations: new AnnotationStore(),
    kroki: new KrokiClient(),
    hub: new WsHub(),
  };
}
```

- [ ] **Step 3: Add tool definition**

Modify `packages/server/src/mcp/tools.ts`:

1. Update `ToolCtx` interface:
```ts
export interface ToolCtx {
  paths: PrixmaPaths;
  store: DiagramStore;
  annotations: AnnotationStore;
  kroki: KrokiClient;
  hub: WsHub;
}
```

2. Add import:
```ts
import { AnnotationStore } from "../annotations/store";
```

3. Append to `TOOLS` array:
```ts
  {
    name: "get_annotations",
    description: "List annotations on a diagram. Each annotation includes structured target info (e.g., targetNodes for graph engines, bboxData for charts).",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        includeResolved: { type: "boolean" },
      },
      required: ["diagramId"],
    },
    run: getAnnotations,
  },
```

4. Add the implementation function:
```ts
async function getAnnotations(args: Record<string, unknown>, ctx: ToolCtx) {
  const id = args.diagramId as DiagramId;
  const includeResolved = Boolean(args.includeResolved);
  const all = ctx.annotations.listByDiagram(id);
  const filtered = includeResolved ? all : all.filter(a => !a.resolvedAt);
  return { annotations: filtered };
}
```

- [ ] **Step 4: Wire AnnotationStore into runMcp**

Modify `packages/server/src/mcp/server.ts`:
```ts
import { AnnotationStore } from "../annotations/store";

// inside runMcp, before building ctx:
  const ctx = {
    paths,
    store: new DiagramStore(),
    annotations: new AnnotationStore(),
    kroki: new KrokiClient({ baseUrl: args.krokiUrl }),
    hub: new WsHub(),
  };
```

- [ ] **Step 5: Run tests**
```
bun test test/mcp/tools.test.ts
```
Expected: all pass including 2 new.

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/mcp/tools.ts packages/server/src/mcp/server.ts packages/server/test/mcp/tools.test.ts
git commit -m "feat(mcp): get_annotations tool"
```

**Done when:** MCP exposes 7 tools; AI can call get_annotations and receive enriched list.

---

### Task 21: Wave 2 smoke + YAGNI gate

- [ ] **Step 1: All tests pass**
```
cd packages/server && bun test
cd ../web && bun run test
```

- [ ] **Step 2: MCP smoke**
Send `tools/list` to server in --mcp mode, verify 7 tools listed. Send `tools/call get_annotations` with a diagramId.

- [ ] **Step 3: YAGNI gate** — diff vs Wave 1 endpoint, ensure no scope creep.

- [ ] **Step 4: Checkpoint commit**
```bash
git commit --allow-empty -m "checkpoint: Wave 2 — AI sees annotations"
```

**Done when:** All tests pass, MCP tools/list returns 7 tools.

---

## Wave 3 — Multi-canvas (user-driven)

**Goal:** Infinite canvas, drag/resize tiles, pan/zoom. AI doesn't drive yet.

### Task 22: Shared Tile + Camera + WorkspaceState types

**Files:**
- Create: `packages/shared/src/canvas.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/protocol.ts` (tighten workspace WS message)

- [ ] **Step 1: Write canvas.ts**
```ts
import type { DiagramEngine } from "./engines";
import type { DiagramId } from "./ir";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Tile {
  id: string;
  diagramId: DiagramId;
  diagramSlug: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface WorkspaceState {
  version: 1;
  camera: Camera;
  tiles: Tile[];
}

export const WORKSPACE_VERSION = 1;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const CAMERA_BOUND = 50000;
export const SNAP_GRID = 20;

export function newTileId(): string {
  return `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function defaultWorkspace(): WorkspaceState {
  return { version: 1, camera: { x: 0, y: 0, zoom: 1 }, tiles: [] };
}

export function clampCamera(c: Camera): Camera {
  return {
    x: Math.max(-CAMERA_BOUND, Math.min(CAMERA_BOUND, c.x)),
    y: Math.max(-CAMERA_BOUND, Math.min(CAMERA_BOUND, c.y)),
    zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom)),
  };
}
```

- [ ] **Step 2: Re-export and tighten protocol**

In `packages/shared/src/index.ts`:
```ts
export * from "./canvas";
```

In `packages/shared/src/protocol.ts`, change the loose workspace variant to:
```ts
import type { Camera, Tile } from "./canvas";

// in ServerToClient:
  | { type: "workspace"; camera: Camera; tiles: Tile[] };
```

- [ ] **Step 3: Type-check**
```
cd packages/shared && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**
```bash
git add packages/shared/src/canvas.ts packages/shared/src/index.ts packages/shared/src/protocol.ts
git commit -m "feat(shared): Tile + Camera + WorkspaceState"
```

**Done when:** Shared types compile.

---

### Task 23: Server workspace store + IO

**Files:**
- Create: `packages/server/src/canvas/store.ts`
- Create: `packages/server/src/canvas/io.ts`
- Create: `packages/server/test/canvas/store.test.ts`
- Create: `packages/server/test/canvas/io.test.ts`

- [ ] **Step 1: Tests**

Create `packages/server/test/canvas/store.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { WorkspaceStore } from "../../src/canvas/store";
import { defaultWorkspace } from "@prixmaviz/shared";

describe("WorkspaceStore", () => {
  it("starts with default workspace", () => {
    const s = new WorkspaceStore();
    expect(s.get()).toEqual(defaultWorkspace());
  });

  it("addTile appends + assigns z", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.addTile({ id: "t2", diagramId: "d2", diagramSlug: "b", x: 50, y: 50, w: 200, h: 100, z: 0 });
    expect(s.get().tiles.length).toBe(2);
  });

  it("updateTile patches", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.updateTile("t1", { x: 100, y: 100 });
    const t = s.get().tiles[0]!;
    expect(t.x).toBe(100);
    expect(t.y).toBe(100);
  });

  it("removeTile removes", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.removeTile("t1");
    expect(s.get().tiles).toEqual([]);
  });

  it("setCamera clamps", () => {
    const s = new WorkspaceStore();
    s.setCamera({ x: 99999, y: -99999, zoom: 100 });
    const c = s.get().camera;
    expect(c.x).toBe(50000);
    expect(c.y).toBe(-50000);
    expect(c.zoom).toBe(4);
  });
});
```

- [ ] **Step 2: Implement store**

Create `packages/server/src/canvas/store.ts`:
```ts
import { clampCamera, defaultWorkspace, type Camera, type Tile, type WorkspaceState } from "@prixmaviz/shared";

export class WorkspaceStore {
  private state: WorkspaceState = defaultWorkspace();

  get(): WorkspaceState {
    return structuredClone(this.state);
  }

  load(state: WorkspaceState): void {
    this.state = state;
  }

  addTile(tile: Tile): Tile {
    this.state.tiles.push(tile);
    return tile;
  }

  updateTile(id: string, patch: Partial<Tile>): Tile | undefined {
    const idx = this.state.tiles.findIndex(t => t.id === id);
    if (idx < 0) return undefined;
    this.state.tiles[idx] = { ...this.state.tiles[idx]!, ...patch, id };
    return this.state.tiles[idx];
  }

  removeTile(id: string): void {
    this.state.tiles = this.state.tiles.filter(t => t.id !== id);
  }

  setCamera(c: Camera): void {
    this.state.camera = clampCamera(c);
  }
}
```

- [ ] **Step 3: IO tests + impl**

Create `packages/server/test/canvas/io.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspace, writeWorkspace } from "../../src/canvas/io";
import { defaultWorkspace } from "@prixmaviz/shared";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ws-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("workspace IO", () => {
  it("returns default when file missing", async () => {
    const w = await readWorkspace(join(dir, "missing.json"));
    expect(w).toEqual(defaultWorkspace());
  });

  it("roundtrip", async () => {
    const ws = defaultWorkspace();
    ws.tiles.push({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 1, y: 2, w: 3, h: 4, z: 0 });
    ws.camera = { x: 50, y: 100, zoom: 1.5 };
    const path = join(dir, "ws.json");
    await writeWorkspace(path, ws);
    const back = await readWorkspace(path);
    expect(back.tiles[0]?.id).toBe("t1");
    expect(back.camera.zoom).toBe(1.5);
  });

  it("returns default on parse error", async () => {
    const path = join(dir, "bad.json");
    await Bun.write(path, "{not json");
    const w = await readWorkspace(path);
    expect(w).toEqual(defaultWorkspace());
  });
});
```

Create `packages/server/src/canvas/io.ts`:
```ts
import { existsSync } from "node:fs";
import { defaultWorkspace, type WorkspaceState, WORKSPACE_VERSION } from "@prixmaviz/shared";

export async function readWorkspace(path: string): Promise<WorkspaceState> {
  if (!existsSync(path)) return defaultWorkspace();
  try {
    const txt = await Bun.file(path).text();
    const parsed = JSON.parse(txt) as WorkspaceState;
    if (parsed.version !== WORKSPACE_VERSION) return defaultWorkspace();
    return parsed;
  } catch {
    return defaultWorkspace();
  }
}

export async function writeWorkspace(path: string, state: WorkspaceState): Promise<void> {
  await Bun.write(path, JSON.stringify(state, null, 2));
}
```

- [ ] **Step 4: Run all canvas tests**
```
bun test test/canvas
```
Expected: 8 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/canvas packages/server/test/canvas
git commit -m "feat(canvas): workspace store + IO"
```

**Done when:** 8 tests pass.

---

### Task 24: Wire workspace into server bootstrap + HTTP routes

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/http/routes.ts`
- Modify: `packages/server/src/bootstrap.ts`

- [ ] **Step 1: Add workspace path**

Modify `packages/server/src/bootstrap.ts` — add `workspaceFile`:
```ts
export interface PrixmaPaths {
  projectRoot: string;
  prixmaDir: string;
  diagramsDir: string;
  cacheDir: string;
  stateDir: string;
  configFile: string;
  workspaceFile: string;
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
    workspaceFile: join(prixmaDir, "workspace.json"),
  };
}
```

- [ ] **Step 2: Bootstrap workspace store**

Modify `packages/server/src/index.ts` — in `runServer()`, after `const annotations = new AnnotationStore()`:
```ts
import { WorkspaceStore } from "./canvas/store";
import { readWorkspace, writeWorkspace } from "./canvas/io";

// in runServer:
  const workspace = new WorkspaceStore();
  workspace.load(await readWorkspace(paths.workspaceFile));

  // debounced persist
  let wsPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistWorkspace = () => {
    if (wsPersistTimer) clearTimeout(wsPersistTimer);
    wsPersistTimer = setTimeout(() => writeWorkspace(paths.workspaceFile, workspace.get()), 500);
  };
```

Pass workspace + schedulePersistWorkspace into handleApi via deps:
```ts
const apiResp = await handleApi(req, url, { paths, store, annotations, workspace, schedulePersistWorkspace, kroki, hub });
```

- [ ] **Step 3: Workspace routes**

Modify `packages/server/src/http/routes.ts`:

Update `RouteDeps`:
```ts
import { WorkspaceStore } from "../canvas/store";

export interface RouteDeps {
  paths: PrixmaPaths;
  store: DiagramStore;
  annotations: AnnotationStore;
  workspace: WorkspaceStore;
  schedulePersistWorkspace: () => void;
  kroki: KrokiClient;
  hub: WsHub;
}
```

Add route block before final `return undefined;`:
```ts
  // ─── Workspace ───────────────────────────────────────────
  if (p === "/api/workspace" && req.method === "GET") {
    return Response.json(deps.workspace.get());
  }

  if (p === "/api/workspace/camera" && req.method === "PUT") {
    const body = await req.json() as { x: number; y: number; zoom: number };
    deps.workspace.setCamera(body);
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json(w);
  }

  if (p === "/api/tiles" && req.method === "POST") {
    const body = await req.json() as { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number };
    const { newTileId } = await import("@prixmaviz/shared");
    const tile = deps.workspace.addTile({
      id: newTileId(),
      diagramId: body.diagramId,
      diagramSlug: body.diagramSlug,
      x: body.x ?? 0, y: body.y ?? 0,
      w: body.w ?? 600, h: body.h ?? 400,
      z: 0,
    });
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json({ tile });
  }

  const tilePatchMatch = p.match(/^\/api\/tiles\/([^/]+)$/);
  if (tilePatchMatch && req.method === "PATCH") {
    const tileId = tilePatchMatch[1]!;
    const body = await req.json() as Partial<{ x: number; y: number; w: number; h: number; z: number }>;
    const tile = deps.workspace.updateTile(tileId, body);
    if (!tile) return Response.json({ ok: false, error: "tile not found" }, { status: 404 });
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json({ tile });
  }

  if (tilePatchMatch && req.method === "DELETE") {
    const tileId = tilePatchMatch[1]!;
    deps.workspace.removeTile(tileId);
    deps.schedulePersistWorkspace();
    const w = deps.workspace.get();
    deps.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
    return Response.json({ ok: true });
  }
```

- [ ] **Step 4: Smoke**
```
mkdir -p /tmp/prixma-w3
cd packages/server && bun run src/index.ts --port 5180 --project-root /tmp/prixma-w3 2>&1 &
sleep 1.5
curl -s http://localhost:5180/api/workspace
echo
curl -s -X POST http://localhost:5180/api/tiles -H 'content-type: application/json' -d '{"diagramId":"d_x","diagramSlug":"x","x":50,"y":50}'
echo
curl -s http://localhost:5180/api/workspace
echo
ls /tmp/prixma-w3/.prixmaviz/workspace.json
kill %1
```
Expected: workspace.json gets created, tile appears.

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/bootstrap.ts packages/server/src/index.ts packages/server/src/http/routes.ts
git commit -m "feat(canvas): workspace HTTP routes (GET/PUT camera, POST/PATCH/DELETE tiles)"
```

**Done when:** Workspace routes work, persisted to disk.

---

### Task 25: Web canvas-math utility

**Files:**
- Create: `packages/web/src/lib/canvas-math.ts`
- Create: `packages/web/test/lib/canvas-math.test.ts`

- [ ] **Step 1: Tests**

Create `packages/web/test/lib/canvas-math.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toCanvas, toViewport } from "../../src/lib/canvas-math";

describe("canvas math", () => {
  const cam = { x: 100, y: 100, zoom: 2 };

  it("toViewport projects canvas point", () => {
    const p = toViewport({ x: 200, y: 300 }, cam);
    expect(p).toEqual({ x: 200, y: 400 });
  });

  it("toCanvas inverts viewport point", () => {
    const p = toCanvas({ x: 200, y: 400 }, cam);
    expect(p).toEqual({ x: 200, y: 300 });
  });

  it("roundtrips", () => {
    const orig = { x: 42, y: -17 };
    const v = toViewport(orig, cam);
    const back = toCanvas(v, cam);
    expect(back).toEqual(orig);
  });

  it("handles zoom=1, origin=0", () => {
    const c = { x: 0, y: 0, zoom: 1 };
    expect(toViewport({ x: 5, y: 5 }, c)).toEqual({ x: 5, y: 5 });
    expect(toCanvas({ x: 5, y: 5 }, c)).toEqual({ x: 5, y: 5 });
  });
});
```

- [ ] **Step 2: Impl**

Create `packages/web/src/lib/canvas-math.ts`:
```ts
import type { Camera } from "@prixmaviz/shared";

export interface Point { x: number; y: number; }

export function toViewport(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function toCanvas(p: Point, cam: Camera): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}
```

- [ ] **Step 3: Run tests**
```
cd packages/web && bun run test
```

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/lib/canvas-math.ts packages/web/test/lib/canvas-math.test.ts
git commit -m "feat(web): canvas/viewport coordinate math"
```

**Done when:** 4 math tests pass.

---

### Task 26: Web — extend store with canvas state

**Files:**
- Modify: `packages/web/src/store/index.ts`

- [ ] **Step 1: Add camera + tiles to AppState**

Modify `packages/web/src/store/index.ts` — add fields:
```ts
import type { Camera, Tile } from "@prixmaviz/shared";

export interface AppState {
  // ...existing...
  camera: Camera;
  tiles: Tile[];
  setCamera: (c: Camera) => void;
  setTiles: (t: Tile[]) => void;
  upsertTile: (t: Tile) => void;
  removeTile: (id: string) => void;
}

// Defaults inside create<AppState>(...):
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
```

- [ ] **Step 2: Build**
```
cd packages/web && bun run build && bun run test
```

- [ ] **Step 3: Commit**
```bash
git add packages/web/src/store/index.ts
git commit -m "feat(web): store fields for camera + tiles"
```

**Done when:** Build + tests pass.

---

### Task 27: WS handler routes workspace messages

**Files:**
- Modify: `packages/web/src/lib/ws.ts`

- [ ] **Step 1: Update handleMessage**

In `packages/web/src/lib/ws.ts` — extend the switch:
```ts
  } else if (msg.type === "workspace") {
    store.setCamera(msg.camera);
    store.setTiles(msg.tiles);
  }
```

- [ ] **Step 2: Build**
```
cd packages/web && bun run build
```

- [ ] **Step 3: Commit**
```bash
git add packages/web/src/lib/ws.ts
git commit -m "feat(web): WS handler for workspace messages"
```

**Done when:** Workspace WS messages update store.

---

### Task 28: API client — workspace endpoints

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add methods**

Append to api.ts:
```ts
  getWorkspace: () =>
    fetch("/api/workspace")
      .then((r) => jsonOrThrow<import("@prixmaviz/shared").WorkspaceState>(r)),

  setCamera: (camera: import("@prixmaviz/shared").Camera) =>
    fetch("/api/workspace/camera", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(camera),
    }).then((r) => jsonOrThrow<import("@prixmaviz/shared").WorkspaceState>(r)),

  createTile: (body: { diagramId: string; diagramSlug: string; x?: number; y?: number; w?: number; h?: number }) =>
    fetch("/api/tiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ tile: import("@prixmaviz/shared").Tile }>(r)),

  patchTile: (tileId: string, body: Partial<{ x: number; y: number; w: number; h: number; z: number }>) =>
    fetch(`/api/tiles/${encodeURIComponent(tileId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<{ tile: import("@prixmaviz/shared").Tile }>(r)),

  deleteTile: (tileId: string) =>
    fetch(`/api/tiles/${encodeURIComponent(tileId)}`, { method: "DELETE" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
```

- [ ] **Step 2: Build + commit**
```
cd packages/web && bun run build
git add packages/web/src/lib/api.ts
git commit -m "feat(web): workspace API client methods"
```

**Done when:** Build passes; api object has getWorkspace + tile methods.

---

### Task 29: InfiniteCanvas component

**Files:**
- Create: `packages/web/src/components/InfiniteCanvas.tsx`
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: Implement**

Create `packages/web/src/components/InfiniteCanvas.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { Tile } from "./Tile";
import { api } from "../lib/api";
import { clampCamera } from "@prixmaviz/shared";

export function InfiniteCanvas() {
  const camera = useAppStore((s) => s.camera);
  const tiles = useAppStore((s) => s.tiles);
  const setCamera = useAppStore((s) => s.setCamera);
  const setTiles = useAppStore((s) => s.setTiles);
  const mode = useAppStore((s) => s.mode);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  // Load workspace on mount
  useEffect(() => {
    api.getWorkspace()
      .then((w) => { setCamera(w.camera); setTiles(w.tiles); })
      .catch(() => {});
  }, [setCamera, setTiles]);

  function onMouseDown(e: React.MouseEvent) {
    if (mode !== "select") return;
    if (!(e.target as HTMLElement).classList.contains("infinite-canvas-bg")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / camera.zoom;
    const dy = (e.clientY - dragRef.current.startY) / camera.zoom;
    const nc = clampCamera({ x: dragRef.current.camX - dx, y: dragRef.current.camY - dy, zoom: camera.zoom });
    setCamera(nc);
  }
  async function onMouseUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    await api.setCamera(camera);
  }

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;  // require modifier for zoom
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.01);
    const newZoom = clampCamera({ ...camera, zoom: camera.zoom * factor }).zoom;
    // anchor zoom on cursor
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const wx = cx / camera.zoom + camera.x;
    const wy = cy / camera.zoom + camera.y;
    const nc = clampCamera({
      x: wx - cx / newZoom,
      y: wy - cy / newZoom,
      zoom: newZoom,
    });
    setCamera(nc);
  }

  return (
    <div
      ref={containerRef}
      className="infinite-canvas"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { dragRef.current = null; }}
      onWheel={onWheel}
    >
      <div className="infinite-canvas-bg" />
      <div
        className="canvas-plane"
        style={{
          transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`,
        }}
      >
        {tiles.map((t) => <Tile key={t.id} tile={t} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Styles**

Append to `styles.css`:
```css
.infinite-canvas {
  position: relative; overflow: hidden;
  width: 100%; height: 100%;
  background:
    radial-gradient(circle at 1px 1px, #1a1d24 1px, transparent 0) 0 0 / 24px 24px,
    var(--bg);
}
.infinite-canvas-bg { position: absolute; inset: 0; z-index: 0; }
.canvas-plane {
  position: absolute; top: 0; left: 0;
  transform-origin: 0 0;
  z-index: 1;
}
```

- [ ] **Step 3: Build**
Will fail because Tile component not yet created — next task.

- [ ] **Step 4: Commit (build will fail intentionally; skip step 3 verification)**
```bash
git add packages/web/src/components/InfiniteCanvas.tsx packages/web/src/styles.css
git commit -m "feat(web): InfiniteCanvas (pan + zoom; Tile component pending)"
```

**Done when:** Code committed; expects Tile component in next task.

---

### Task 30: Tile component

**Files:**
- Create: `packages/web/src/components/Tile.tsx`

- [ ] **Step 1: Implement**

Create `packages/web/src/components/Tile.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import type { Tile as TileT } from "@prixmaviz/shared";
import { SNAP_GRID } from "@prixmaviz/shared";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { DiagramView } from "./DiagramView";
import { AnnotationLayer } from "./AnnotationLayer";

interface Props { tile: TileT; }

export function Tile({ tile }: Props) {
  const setTiles = useAppStore((s) => s.setTiles);
  const tiles = useAppStore((s) => s.tiles);
  const camera = useAppStore((s) => s.camera);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");

  // Fetch the tile's SVG (load by slug). v1: use library/thumb endpoint
  useEffect(() => {
    let stop = false;
    fetch(`/api/library/${encodeURIComponent(tile.diagramSlug)}/thumb`)
      .then(r => r.ok ? r.text() : "")
      .then(s => { if (!stop) setSvg(s); });
    return () => { stop = true; };
  }, [tile.diagramSlug]);

  function snap(n: number): number {
    return Math.round(n / SNAP_GRID) * SNAP_GRID;
  }

  function onHeaderDown(e: React.MouseEvent) {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startTileX = tile.x, startTileY = tile.y;
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / camera.zoom;
      const dy = (ev.clientY - startY) / camera.zoom;
      const newX = ev.altKey ? startTileX + dx : snap(startTileX + dx);
      const newY = ev.altKey ? startTileY + dy : snap(startTileY + dy);
      setTiles(tiles.map(t => t.id === tile.id ? { ...t, x: newX, y: newY } : t));
    }
    async function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // get latest from store
      const latest = useAppStore.getState().tiles.find(t => t.id === tile.id);
      if (latest) await api.patchTile(tile.id, { x: latest.x, y: latest.y });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onResizeDown(e: React.MouseEvent) {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = tile.w, startH = tile.h;
    function onMove(ev: MouseEvent) {
      const dw = (ev.clientX - startX) / camera.zoom;
      const dh = (ev.clientY - startY) / camera.zoom;
      const newW = Math.max(120, snap(startW + dw));
      const newH = Math.max(80, snap(startH + dh));
      setTiles(useAppStore.getState().tiles.map(t => t.id === tile.id ? { ...t, w: newW, h: newH } : t));
    }
    async function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const latest = useAppStore.getState().tiles.find(t => t.id === tile.id);
      if (latest) await api.patchTile(tile.id, { w: latest.w, h: latest.h });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function onClose() {
    await api.deleteTile(tile.id);
  }

  return (
    <div
      ref={containerRef}
      className="tile"
      style={{
        position: "absolute", left: tile.x, top: tile.y,
        width: tile.w, height: tile.h, zIndex: tile.z,
      }}
    >
      <div className="tile-header" onMouseDown={onHeaderDown}>
        <span className="tile-name">{tile.diagramSlug}</span>
        <button className="tile-close" onClick={onClose}>×</button>
      </div>
      <div className="tile-body">
        {svg && <DiagramView diagramId={tile.diagramId} svg={svg} />}
        <AnnotationLayer diagramId={tile.diagramId} containerRef={containerRef} />
      </div>
      <div className="tile-resize" onMouseDown={onResizeDown} />
    </div>
  );
}
```

- [ ] **Step 2: Styles**

Append:
```css
.tile {
  background: white; color: #222; border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  display: flex; flex-direction: column; overflow: hidden;
}
.tile-header {
  height: 28px; flex-shrink: 0;
  background: #f5f5f7; padding: 0 10px;
  display: flex; align-items: center; gap: 8px;
  cursor: grab;
  border-bottom: 1px solid #e5e5e8;
  font-size: 12px;
}
.tile-header:active { cursor: grabbing; }
.tile-name { flex: 1; font-weight: 600; font-family: ui-monospace, Menlo, monospace; }
.tile-close { background: transparent; border: 0; color: #888; cursor: pointer; padding: 0 4px; }
.tile-close:hover { color: #d33; }
.tile-body { flex: 1; position: relative; overflow: hidden; }
.tile-body > .diagram { padding: 8px; }
.tile-resize {
  position: absolute; bottom: 0; right: 0;
  width: 16px; height: 16px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, #aaa 50%);
}
```

- [ ] **Step 3: Build**
```
cd packages/web && bun run build 2>&1 | tail -3
```
Expected: success.

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/components/Tile.tsx packages/web/src/styles.css
git commit -m "feat(web): Tile component (drag header, resize corner, AnnotationLayer)"
```

**Done when:** Build passes.

---

### Task 31: Replace Canvas with InfiniteCanvas in App

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/Library.tsx`
- Delete: `packages/web/src/components/Canvas.tsx`

- [ ] **Step 1: Library opens as tile, not as current diagram**

Modify `Library.tsx` — change `open()`:
```tsx
async function open(entry: LibraryEntry) {
  try {
    const slug = basename(entry.path).replace(/\.pviz$/, "");
    const result = await api.loadBySlug(slug);
    // create a tile at viewport center
    const camera = useAppStore.getState().camera;
    await api.createTile({
      diagramId: result.diagramId,
      diagramSlug: slug,
      x: camera.x + 60,
      y: camera.y + 60,
      w: 600, h: 400,
    });
    // also keep current diagram = first opened (for legacy single-canvas paths)
    setDiagram({
      id: result.diagramId,
      name: entry.name,
      engine: entry.engine,
      kind: entry.kind,
      ir: result.ir,
      dsl: result.dsl,
      meta: { createdAt: entry.createdAt, updatedAt: entry.updatedAt, tags: entry.tags, sourcePaths: [] },
    });
    setRender(result.diagramId, result.render.svg, result.render.dsl, result.ir);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: App swaps Canvas → InfiniteCanvas**

Modify `App.tsx`:
```tsx
import { Topbar } from "./components/Topbar";
import { Library } from "./components/Library";
import { InfiniteCanvas } from "./components/InfiniteCanvas";
import { useWebSocket } from "./lib/ws";

export function App() {
  useWebSocket();
  return (
    <div className="app">
      <Topbar />
      <div className="workspace">
        <Library />
        <InfiniteCanvas />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete old Canvas.tsx**

```
git rm packages/web/src/components/Canvas.tsx
```

- [ ] **Step 4: Build**
```
cd packages/web && bun run build 2>&1 | tail -3
```
Expected: success.

- [ ] **Step 5: Commit**
```bash
git add packages/web/src/App.tsx packages/web/src/components/Library.tsx
git commit -m "feat(web): swap single Canvas for InfiniteCanvas; library opens tiles"
```

**Done when:** App builds with InfiniteCanvas mounted; clicking library item opens a tile at camera center.

---

### Task 32: Wave 3 smoke + YAGNI gate

- [ ] All tests pass (`bun test` in server, `bun run test` in web)
- [ ] Manual smoke: open binary, click 3 library items, see 3 tiles, drag/resize, pan canvas (drag empty space), reload — state preserved
- [ ] YAGNI gate
- [ ] Checkpoint commit:
```bash
git commit --allow-empty -m "checkpoint: Wave 3 — multi-canvas user-driven"
```

---

## Wave 4 — AI drives canvas

**Goal:** AI tools to control workspace.

### Task 33: Server-side arrange helper

**Files:**
- Create: `packages/server/src/canvas/arrange.ts`
- Create: `packages/server/test/canvas/arrange.test.ts`

- [ ] **Step 1: Tests**

Create `packages/server/test/canvas/arrange.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { arrange } from "../../src/canvas/arrange";
import type { Tile } from "@prixmaviz/shared";

const t = (id: string): Tile => ({ id, diagramId: id, diagramSlug: id, x: 0, y: 0, w: 200, h: 100, z: 0 });

describe("arrange", () => {
  it("grid: 4 tiles → 2x2", () => {
    const tiles = arrange([t("a"), t("b"), t("c"), t("d")], "grid", 20);
    expect(tiles[0]).toMatchObject({ id: "a", x: 0, y: 0 });
    expect(tiles[1]).toMatchObject({ id: "b", x: 220, y: 0 });
    expect(tiles[2]).toMatchObject({ id: "c", x: 0, y: 120 });
    expect(tiles[3]).toMatchObject({ id: "d", x: 220, y: 120 });
  });

  it("horizontal: row", () => {
    const tiles = arrange([t("a"), t("b")], "horizontal", 20);
    expect(tiles[0]?.x).toBe(0);
    expect(tiles[1]?.x).toBe(220);
    expect(tiles[0]?.y).toBe(0);
    expect(tiles[1]?.y).toBe(0);
  });

  it("vertical: column", () => {
    const tiles = arrange([t("a"), t("b")], "vertical", 20);
    expect(tiles[0]?.y).toBe(0);
    expect(tiles[1]?.y).toBe(120);
  });
});
```

- [ ] **Step 2: Impl**

Create `packages/server/src/canvas/arrange.ts`:
```ts
import type { Tile } from "@prixmaviz/shared";

export type ArrangeStyle = "grid" | "horizontal" | "vertical";

export function arrange(tiles: Tile[], style: ArrangeStyle, padding: number = 20): Tile[] {
  if (style === "horizontal") {
    let x = 0;
    return tiles.map(t => {
      const out = { ...t, x, y: 0 };
      x += t.w + padding;
      return out;
    });
  }
  if (style === "vertical") {
    let y = 0;
    return tiles.map(t => {
      const out = { ...t, x: 0, y };
      y += t.h + padding;
      return out;
    });
  }
  // grid: square-ish
  const cols = Math.ceil(Math.sqrt(tiles.length));
  const w = Math.max(...tiles.map(t => t.w), 1);
  const h = Math.max(...tiles.map(t => t.h), 1);
  return tiles.map((t, i) => ({
    ...t,
    x: (i % cols) * (w + padding),
    y: Math.floor(i / cols) * (h + padding),
  }));
}
```

- [ ] **Step 3: Run tests**
```
bun test test/canvas/arrange.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/canvas/arrange.ts packages/server/test/canvas/arrange.test.ts
git commit -m "feat(canvas): arrange (grid/horizontal/vertical)"
```

**Done when:** 3 arrange tests pass.

---

### Task 34: MCP `update_tile` + `set_view` tools

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`

- [ ] **Step 1: Update ToolCtx and add tools**

Modify `packages/server/src/mcp/tools.ts`:

Update ToolCtx:
```ts
import { WorkspaceStore } from "../canvas/store";
import { arrange } from "../canvas/arrange";

export interface ToolCtx {
  paths: PrixmaPaths;
  store: DiagramStore;
  annotations: AnnotationStore;
  workspace: WorkspaceStore;
  schedulePersistWorkspace: () => void;
  kroki: KrokiClient;
  hub: WsHub;
}
```

Append tool definitions:
```ts
  {
    name: "update_tile",
    description: "Move, resize, or focus a tile on the canvas. patch fields override current tile state.",
    inputSchema: {
      type: "object",
      properties: {
        tileId: { type: "string" },
        patch: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            w: { type: "number" }, h: { type: "number" },
            focused: { type: "boolean" },
          },
        },
      },
      required: ["tileId", "patch"],
    },
    run: updateTile,
  },
  {
    name: "set_view",
    description: "Control the canvas viewport. Either set the camera directly, or auto-arrange tiles by style.",
    inputSchema: {
      type: "object",
      properties: {
        camera: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" }, zoom: { type: "number" } },
        },
        arrange: {
          type: "object",
          properties: {
            style: { type: "string", enum: ["grid", "horizontal", "vertical"] },
            diagrams: { type: "array", items: { type: "string" } },
            padding: { type: "number" },
          },
        },
      },
    },
    run: setView,
  },
```

Add implementation functions:
```ts
async function updateTile(args: Record<string, unknown>, ctx: ToolCtx) {
  const tileId = args.tileId as string;
  const patch = args.patch as { x?: number; y?: number; w?: number; h?: number; focused?: boolean };
  const tile = ctx.workspace.updateTile(tileId, {
    ...(patch.x !== undefined ? { x: patch.x } : {}),
    ...(patch.y !== undefined ? { y: patch.y } : {}),
    ...(patch.w !== undefined ? { w: patch.w } : {}),
    ...(patch.h !== undefined ? { h: patch.h } : {}),
  });
  if (!tile) throw new Error("tile not found");
  if (patch.focused) {
    // center camera on tile
    ctx.workspace.setCamera({
      x: tile.x + tile.w / 2 - 400,
      y: tile.y + tile.h / 2 - 300,
      zoom: 1,
    });
  }
  ctx.schedulePersistWorkspace();
  const w = ctx.workspace.get();
  ctx.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
  return { tile };
}

async function setView(args: Record<string, unknown>, ctx: ToolCtx) {
  const camera = args.camera as { x: number; y: number; zoom: number } | undefined;
  const arr = args.arrange as { style: "grid" | "horizontal" | "vertical"; diagrams: string[]; padding?: number } | undefined;
  if (camera) ctx.workspace.setCamera(camera);
  if (arr) {
    const w = ctx.workspace.get();
    const subset = w.tiles.filter(t => arr.diagrams.includes(t.diagramId));
    const arranged = arrange(subset, arr.style, arr.padding ?? 20);
    for (const t of arranged) ctx.workspace.updateTile(t.id, { x: t.x, y: t.y });
  }
  ctx.schedulePersistWorkspace();
  const w = ctx.workspace.get();
  ctx.hub.broadcast({ type: "workspace", camera: w.camera, tiles: w.tiles });
  return { camera: w.camera, tiles: w.tiles };
}
```

- [ ] **Step 2: Update MCP server bootstrap**

Modify `packages/server/src/mcp/server.ts` — add workspace + persist:
```ts
import { WorkspaceStore } from "../canvas/store";
import { readWorkspace, writeWorkspace } from "../canvas/io";

// in runMcp:
  const workspace = new WorkspaceStore();
  workspace.load(await readWorkspace(paths.workspaceFile));
  let wsTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistWorkspace = () => {
    if (wsTimer) clearTimeout(wsTimer);
    wsTimer = setTimeout(() => writeWorkspace(paths.workspaceFile, workspace.get()), 500);
  };

  const ctx = {
    paths,
    store: new DiagramStore(),
    annotations: new AnnotationStore(),
    workspace,
    schedulePersistWorkspace,
    kroki: new KrokiClient({ baseUrl: args.krokiUrl }),
    hub: new WsHub(),
  };
```

- [ ] **Step 3: Smoke test 9 tools**
```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun run src/index.ts --mcp --project-root /tmp/prixma-w4 | head -1
```
Expected: 9 tools listed (Cycle 1's 6 + 3 new: get_annotations, update_tile, set_view).

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/mcp/tools.ts packages/server/src/mcp/server.ts
git commit -m "feat(mcp): update_tile + set_view tools"
```

**Done when:** 9 MCP tools listed; tools/call works for both new tools.

---

### Task 35: Wave 4 smoke + YAGNI gate

- [ ] Run all tests
- [ ] Manual smoke: drive a `set_view` with arrange:grid via `/api/mcp/call` HTTP, verify tiles snap into grid layout
- [ ] YAGNI gate
- [ ] Checkpoint commit:
```bash
git commit --allow-empty -m "checkpoint: Wave 4 — AI drives canvas"
```

---

## Wave 5 — Real install + acceptance

**Goal:** MCP plugin install path that works end-to-end.

### Task 36: MCP install module (server-side)

**Files:**
- Create: `packages/server/src/mcp/install.ts`
- Create: `packages/server/test/mcp/install.test.ts`

- [ ] **Step 1: Tests**

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpConfig } from "../../src/mcp/install";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "inst-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("mergeMcpConfig", () => {
  it("creates entry in fresh config", () => {
    const path = join(dir, "config.json");
    const out = mergeMcpConfig(path, "/bin/prixma");
    expect(out.added).toBe(true);
    const back = JSON.parse(readFileSync(path, "utf8"));
    expect(back.mcpServers.prixmaviz.command).toBe("/bin/prixma");
  });

  it("preserves siblings", () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "/bin/other", args: [] } } }));
    mergeMcpConfig(path, "/bin/prixma");
    const back = JSON.parse(readFileSync(path, "utf8"));
    expect(back.mcpServers.other.command).toBe("/bin/other");
    expect(back.mcpServers.prixmaviz.command).toBe("/bin/prixma");
  });

  it("idempotent", () => {
    const path = join(dir, "config.json");
    mergeMcpConfig(path, "/bin/prixma");
    const second = mergeMcpConfig(path, "/bin/prixma");
    expect(second.added).toBe(false);
  });

  it("creates backup when overwriting", () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "/x" } } }));
    mergeMcpConfig(path, "/bin/prixma");
    const fs = require("node:fs");
    const files = fs.readdirSync(dir);
    expect(files.some((f: string) => f.startsWith("config.json.bak."))).toBe(true);
  });
});
```

- [ ] **Step 2: Impl**

Create `packages/server/src/mcp/install.ts`:
```ts
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";

interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MergeResult {
  added: boolean;
  path: string;
  snippet: string;
}

export function mergeMcpConfig(path: string, binaryPath: string): MergeResult {
  const entry: McpEntry = { command: binaryPath, args: ["--mcp"] };
  const snippet = JSON.stringify({ mcpServers: { prixmaviz: entry } }, null, 2);

  let config: { mcpServers?: Record<string, McpEntry> } = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`config at ${path} is not valid JSON; refusing to overwrite`);
    }
    // backup
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(path, `${path}.bak.${stamp}`);
  }

  if (!config.mcpServers) config.mcpServers = {};
  const existing = config.mcpServers.prixmaviz;
  if (existing && existing.command === binaryPath) {
    return { added: false, path, snippet };
  }
  config.mcpServers.prixmaviz = entry;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return { added: true, path, snippet };
}

export function defaultConfigPath(host: "claude-code"): string {
  if (host === "claude-code") {
    if (process.platform === "darwin") {
      return `${process.env.HOME}/Library/Application Support/Claude/claude_desktop_config.json`;
    }
    if (process.platform === "linux") {
      return `${process.env.HOME}/.config/Claude/claude_desktop_config.json`;
    }
    if (process.platform === "win32") {
      return `${process.env.APPDATA}/Claude/claude_desktop_config.json`;
    }
  }
  throw new Error(`unknown host: ${host}`);
}
```

- [ ] **Step 3: Run tests**
```
bun test test/mcp/install.test.ts
```
Expected: 4 pass.

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/mcp/install.ts packages/server/test/mcp/install.test.ts
git commit -m "feat(mcp): install — merge config with backup"
```

**Done when:** 4 install tests pass.

---

### Task 37: MCP `install_mcp_plugin` tool

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Add tool**

Append to TOOLS in `packages/server/src/mcp/tools.ts`:
```ts
  {
    name: "install_mcp_plugin",
    description: "Write the PrixmaViz MCP entry into the host's config file. Idempotent. confirm=false returns the snippet without writing.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", enum: ["claude-code", "codex", "vscode"] },
        confirm: { type: "boolean" },
      },
      required: ["host", "confirm"],
    },
    run: installMcpPlugin,
  },
```

Implementation:
```ts
async function installMcpPlugin(args: Record<string, unknown>, ctx: ToolCtx) {
  const host = args.host as "claude-code";
  const confirm = Boolean(args.confirm);
  const { defaultConfigPath, mergeMcpConfig } = await import("./install");
  const configPath = defaultConfigPath(host);
  const binaryPath = process.execPath;
  const snippet = JSON.stringify({ mcpServers: { prixmaviz: { command: binaryPath, args: ["--mcp"] } } }, null, 2);
  if (!confirm) return { configPath, entryAdded: false, snippet, dryRun: true };
  const result = mergeMcpConfig(configPath, binaryPath);
  return { configPath: result.path, entryAdded: result.added, snippet: result.snippet };
}
```

- [ ] **Step 2: HTTP mirror**

Modify `packages/server/src/http/routes.ts` — add route:
```ts
  if (p === "/api/install" && req.method === "POST") {
    const body = await req.json() as { host: "claude-code"; confirm: boolean };
    const { dispatchTool } = await import("../mcp/tools");
    try {
      const result = await dispatchTool("install_mcp_plugin", body, deps as unknown as import("../mcp/tools").ToolCtx);
      return Response.json(result);
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }
```

- [ ] **Step 3: Smoke**
```
curl -s -X POST http://localhost:5180/api/install -H 'content-type: application/json' -d '{"host":"claude-code","confirm":false}'
```
Expected: returns snippet, dryRun=true.

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/mcp/tools.ts packages/server/src/http/routes.ts
git commit -m "feat(mcp): install_mcp_plugin tool + HTTP mirror"
```

**Done when:** 10 MCP tools, install_mcp_plugin tool callable.

---

### Task 38: Tauri install dialog (Rust side)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/install.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Cargo deps**

Modify `src-tauri/Cargo.toml`:
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
dirs = "5"
```

- [ ] **Step 2: Plugin in tauri.conf.json**

Modify `src-tauri/tauri.conf.json` — under `app.security`:
```json
"plugins": {
  "dialog": { "all": true }
}
```

- [ ] **Step 3: install.rs**

Create `src-tauri/src/install.rs`:
```rust
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

pub fn config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return dirs::home_dir().map(|h| h.join("Library/Application Support/Claude/claude_desktop_config.json"));
    #[cfg(target_os = "linux")]
    return dirs::config_dir().map(|c| c.join("Claude/claude_desktop_config.json"));
    #[cfg(target_os = "windows")]
    return dirs::config_dir().map(|c| c.join("Claude/claude_desktop_config.json"));
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    return None;
}

pub fn install_entry(binary_path: &str) -> Result<bool, String> {
    let path = config_path().ok_or("config path not found")?;
    let mut config: Value = if path.exists() {
        let txt = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        // backup
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S").to_string();
        let mut bak = path.clone();
        let fname = format!("{}.bak.{}", path.file_name().unwrap().to_string_lossy(), stamp);
        bak.set_file_name(fname);
        fs::copy(&path, &bak).ok();
        serde_json::from_str(&txt).map_err(|e| format!("invalid JSON: {}", e))?
    } else {
        json!({})
    };

    let servers = config["mcpServers"].as_object_mut();
    let already = match servers {
        Some(m) => m.get("prixmaviz").and_then(|v| v.get("command")).and_then(|v| v.as_str()) == Some(binary_path),
        None => false,
    };
    if already { return Ok(false); }

    if config["mcpServers"].as_object().is_none() {
        config["mcpServers"] = json!({});
    }
    config["mcpServers"]["prixmaviz"] = json!({
        "command": binary_path,
        "args": ["--mcp"]
    });

    if let Some(parent) = path.parent() { fs::create_dir_all(parent).ok(); }
    fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
    Ok(true)
}
```

(Note: chrono import — add to Cargo.toml: `chrono = "0.4"`. Or just use std::time::SystemTime UNIX_EPOCH.)

Replace chrono with std:
```rust
let stamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs().to_string())
    .unwrap_or_else(|_| "x".to_string());
```

Remove `chrono = "0.4"` from Cargo.toml — just use std time.

- [ ] **Step 4: Add command + first-launch check in main.rs**

Modify `src-tauri/src/main.rs` — add command:
```rust
mod install;

#[tauri::command]
fn install_mcp_plugin(binary_path: String) -> Result<bool, String> {
    install::install_entry(&binary_path)
}
```

In `tauri::Builder`:
```rust
.invoke_handler(tauri::generate_handler![install_mcp_plugin])
.plugin(tauri_plugin_dialog::init())
```

In `setup` (after window built), check first-launch flag and prompt:
```rust
use tauri_plugin_dialog::DialogExt;

// after window:
let app_handle = app.handle().clone();
let first_run_flag = dirs::config_dir().unwrap().join("prixmaviz/installed.flag");
if !first_run_flag.exists() {
    std::fs::create_dir_all(first_run_flag.parent().unwrap()).ok();
    app_handle.dialog()
        .message("Add PrixmaViz to Claude Code? You can change this later via the menu.")
        .title("Install MCP plugin")
        .ok_button_label("Install")
        .cancel_button_label("Skip")
        .show(move |yes| {
            if yes {
                // get sidecar binary path from app resources
                if let Ok(resource_path) = app_handle.path().resource_dir() {
                    let bin = resource_path.join("binaries").join(if cfg!(target_os = "macos") {
                        "prixmaviz-server-aarch64-apple-darwin"
                    } else { "prixmaviz-server-x86_64-unknown-linux-gnu" });
                    let _ = install::install_entry(&bin.to_string_lossy());
                }
                let _ = std::fs::write(&first_run_flag, "1");
            } else {
                let _ = std::fs::write(&first_run_flag, "skipped");
            }
        });
}
```

- [ ] **Step 5: Cargo check**
```
cd src-tauri && cargo check 2>&1 | tail -10
```
Expected: passes.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/src/install.rs src-tauri/src/main.rs
git commit -m "feat(tauri): first-launch MCP install dialog"
```

**Done when:** Cargo compiles; first-launch dialog shows once.

---

### Task 39: Standalone install scripts

**Files:**
- Create: `scripts/install.sh`
- Create: `Formula/prixmaviz-server.rb`

- [ ] **Step 1: install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="${PRIXMAVIZ_REPO:-https://github.com/yourorg/prixmaviz}"
DEST="${PRIXMAVIZ_DEST:-$HOME/.local/bin}"

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS-$ARCH" in
  Darwin-arm64)  TARGET="darwin-arm64" ;;
  Darwin-x86_64) TARGET="darwin-x64" ;;
  Linux-x86_64)  TARGET="linux-x64" ;;
  *) echo "Unsupported platform: $OS-$ARCH"; exit 1 ;;
esac

mkdir -p "$DEST"
URL="$REPO/releases/latest/download/prixmaviz-server-$TARGET"
echo "Downloading $URL..."
curl -fsSL -o "$DEST/prixmaviz-server" "$URL"
chmod +x "$DEST/prixmaviz-server"

echo
echo "Installed to $DEST/prixmaviz-server"
echo
echo "Add this to your Claude Code config (~/Library/Application Support/Claude/claude_desktop_config.json on macOS):"
echo
cat <<JSON
{
  "mcpServers": {
    "prixmaviz": {
      "command": "$DEST/prixmaviz-server",
      "args": ["--mcp"]
    }
  }
}
JSON
```

```
chmod +x scripts/install.sh
```

- [ ] **Step 2: Brew formula**

Create `Formula/prixmaviz-server.rb`:
```ruby
class PrixmavizServer < Formula
  desc "AI-native diagram tool MCP server"
  homepage "https://github.com/yourorg/prixmaviz"
  version "0.2.0"

  on_macos do
    on_arm do
      url "https://github.com/yourorg/prixmaviz/releases/download/v0.2.0/prixmaviz-server-darwin-arm64"
      sha256 "REPLACE_WITH_SHA"
    end
    on_intel do
      url "https://github.com/yourorg/prixmaviz/releases/download/v0.2.0/prixmaviz-server-darwin-x64"
      sha256 "REPLACE_WITH_SHA"
    end
  end

  on_linux do
    url "https://github.com/yourorg/prixmaviz/releases/download/v0.2.0/prixmaviz-server-linux-x64"
    sha256 "REPLACE_WITH_SHA"
  end

  def install
    bin.install Dir["prixmaviz-server-*"][0] => "prixmaviz-server"
  end

  test do
    system "#{bin}/prixmaviz-server", "--version"
  end
end
```

- [ ] **Step 3: Update root README**

Append install paths section to README.md (or create one if missing). Document Tauri / curl / brew / manual.

- [ ] **Step 4: Commit**
```bash
git add scripts/install.sh Formula/prixmaviz-server.rb README.md
chmod +x scripts/install.sh
git commit -m "feat(install): standalone install.sh + brew formula skeleton"
```

**Done when:** install.sh has correct platform detection, brew formula has placeholder URLs (real URLs filled in at release).

---

### Task 40: Wave 5 acceptance smoke

**Files:** none (verification)

- [ ] **Step 1: Build the binary**
```
bun run build:bin
```

- [ ] **Step 2: Manual install via Tauri**
- Build Tauri app: `bun run build:tauri` (full bundle)
- Open the .app on macOS — see install dialog
- Click "Install" — verify config gets entry pointing to bundled binary
- Verify Claude Code can see "prixmaviz" MCP server (open CC, look in MCP servers list)
- Ask CC: "create a flowchart of this repo" — verify diagram appears in PrixmaViz Tauri window
- Circle a node manually — annotate
- Ask CC: "what did I just annotate?" — CC should call `get_annotations` and respond

- [ ] **Step 3: Standalone install smoke**
- On a clean Linux VM (or another Mac without Tauri app installed): `bash scripts/install.sh`
- Verify binary lands in `~/.local/bin/`
- Manually paste config snippet into Claude Code config
- Repeat the AI loop

- [ ] **Step 4: Final acceptance commit**
```bash
git commit --allow-empty -m "checkpoint: Wave 5 — real install verified"
```

**Done when:** Real Claude Code session drives PrixmaViz end-to-end via real MCP.

---

## Self-Review

### Spec coverage check

| Spec section | Tasks |
|---|---|
| Annotation data model (tag/region/pin) | Tasks 1, 2 |
| Annotation hit-test (graph/sequence/chart/null) | Tasks 3, 4, 18, 19 |
| Annotation store + persistence | Tasks 5, 6 |
| Annotation HTTP routes | Tasks 7, 8 |
| Web annotation UI (ToolPalette + Layer + tools + popup) | Tasks 11-16 |
| Cross-tile coherence (WS broadcast) | Tasks 7, 10 |
| MCP get_annotations | Task 20 |
| Camera + tile state | Task 22 |
| WorkspaceStore + IO | Task 23 |
| Workspace HTTP routes | Task 24 |
| Canvas math | Task 25 |
| Web store extension | Tasks 9, 26 |
| InfiniteCanvas (pan/zoom) | Task 29 |
| Tile (drag/resize/close) | Task 30 |
| Annotation overlay on tiles | Tasks 30, 15 |
| App swap to InfiniteCanvas | Task 31 |
| Arrange helper (grid/h/v) | Task 33 |
| MCP update_tile + set_view | Task 34 |
| MCP install module | Task 36 |
| MCP install_mcp_plugin tool | Task 37 |
| Tauri first-launch dialog | Task 38 |
| Standalone install scripts | Task 39 |
| Real-AI acceptance | Task 40 |

All spec sections covered.

### Placeholder scan
No "TBD" / "TODO" / "implement later" found. Each step contains executable code or specific commands.

### Type consistency
- `Annotation` defined in Task 1, used consistently in Tasks 5, 6, 7, 9, 12, 13, 14, 15, 16, 20
- `Tile` defined in Task 22, used in Tasks 23, 24, 26, 27, 28, 29, 30, 33, 34
- `Camera` defined in Task 22, used in Tasks 24, 26, 27, 29, 34
- `WorkspaceState` defined in Task 22, used in Tasks 23, 24, 27
- API method names: `listAnnotations` / `createAnnotation` / `updateAnnotationApi` / `deleteAnnotation` defined Task 10, used Tasks 12, 13, 14, 16
- Workspace API methods: `getWorkspace` / `setCamera` / `createTile` / `patchTile` / `deleteTile` defined Task 28, used Tasks 29, 30, 31

All consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-prixmaviz-cycle-2-plus.md` (40 tasks across 5 waves).

Two execution options:

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks. User already requested this in the brainstorm. Same approach as Cycle 1.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
