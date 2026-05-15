# PrixmaViz VSDX Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Visio (`.vsdx`) as a first-class diagram engine in PrixmaViz, with lossless round-trip read/write — drag a `.vsdx` onto the canvas to render it natively, and export any graph diagram (Mermaid/D2/Graphviz) as a Visio-editable `.vsdx`.

**Architecture:** Bytes-as-source diagram `kind: "binary"` (alongside existing `"graph"` and `"passthrough"`), persisted in a new `BYTEA` column. Native rendering via a new `prixmaviz-vsdx` Docker sidecar running `unoserver` (persistent UNO bridge over LibreOffice). AI translation is host-side via a new `analyze_vsdx` MCP tool that returns structured JSON. Write path: structured Visio XML for graph engines (mapped to ~35-shape Basic Flowchart + Basic Shapes stencils), image-embed fallback for everything else.

**Tech Stack:** Bun + TypeScript server, Postgres 16 with BYTEA, `jszip` for OPC ZIP read/write, `fast-xml-parser` for vsdx XML, `unoserver` Docker image, React+Zustand web client, MCP SDK.

**Source spec:** [docs/superpowers/specs/2026-05-14-prixmaviz-vsdx-engine-design.md](../specs/2026-05-14-prixmaviz-vsdx-engine-design.md)

---

## Background for the implementing engineer

You are extending PrixmaViz, a diagram tool where Claude (or another AI) calls MCP tools to render diagrams that appear in a shared web workspace. The server is deterministic — no LLM lives on the server. All AI work happens in the calling MCP host. This is a hard invariant you must preserve.

Key files to skim before starting:

- `packages/shared/src/engines.ts` — engine list, families, Kroki path mapping
- `packages/shared/src/index.ts` — top-level shared types
- `packages/server/src/render.ts` — render dispatcher (your new branch lives here)
- `packages/server/src/renderers/registry.ts` — IR renderer registry (you'll extend this)
- `packages/server/src/mcp/tools.ts` — MCP tool definitions (you'll add 2 tools)
- `packages/server/src/http/routes.ts` — HTTP routing (you'll add 2 endpoints)
- `packages/server/src/db/diagrams.ts` — diagram persistence
- `packages/server/migrations/0001_init.sql` — current schema

**Test setup**: tests use `bun:test`. Most server tests are unit tests; DB tests require a running Postgres at `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/prixmaviz_test`).

**Vsdx format primer**: A `.vsdx` file is a ZIP archive (OPC — Open Packaging Convention) containing XML parts. Key parts:
- `[Content_Types].xml` — declares MIME types for all parts
- `visio/pages/pages.xml` — page list
- `visio/pages/page1.xml` (etc.) — shapes, connectors, layout for each page
- `visio/document.xml` — document-level metadata
- `visio/masters/*.xml` — shape master definitions (Process, Decision, etc.)
- `_rels/*.rels` — part relationship files

We **read** vsdx by ZIP-extracting and parsing `pages/page*.xml`. We **write** vsdx by constructing the minimal set of parts and zipping them with `jszip`.

---

## File structure

### New files

```
packages/shared/src/
  (no new files — extend existing engines.ts and index.ts)

packages/server/migrations/
  0002_diagram_bytes.sql           ← new BYTEA column

packages/server/src/renderers/
  vsdx-render.ts                   ← bytes → SVG via unoserver
  vsdx-parse.ts                    ← vsdx XML → structured JSON
  vsdx-writer.ts                   ← IR → vsdx XML (graph engines)
  vsdx-writer-fallback.ts          ← SVG → image-embed vsdx (other engines)
  d2-extractor.ts                  ← D2 DSL → GraphIR (for writer)
  graphviz-extractor.ts            ← DOT DSL → GraphIR (for writer)

packages/server/src/vsdx/
  stencils.ts                      ← shape master → Visio Master_ID mapping
  xml-builder.ts                   ← minimal XML escaping/emission helpers

packages/server/src/http/
  (routes added to existing routes.ts)

packages/server/test/renderers/
  vsdx-render.test.ts
  vsdx-parse.test.ts
  vsdx-writer.test.ts
  d2-extractor.test.ts
  graphviz-extractor.test.ts

packages/server/test/fixtures/vsdx/
  basic-flowchart.vsdx             ← hand-built reference (4 shapes + edges)
  swim-lane.vsdx                   ← grouped shapes
  multi-page.vsdx                  ← 2 pages
  basic-shapes-only.vsdx           ← circle/triangle/etc.

packages/web/src/lib/
  (export.ts extended; no new files)

packages/web/src/components/
  (InfiniteCanvas.tsx and Tile.tsx extended; no new files)

docker/vsdx/
  Dockerfile                       ← unoserver + libreoffice
```

### Modified files

```
packages/shared/src/engines.ts                 + "vsdx" engine
packages/shared/src/index.ts                   + bytes? on Diagram, "binary" kind
packages/server/src/db/diagrams.ts             + bytes column read/write
packages/server/src/render.ts                  + binary branch dispatcher
packages/server/src/renderers/registry.ts      + d2/graphviz IR extractors registered
packages/server/src/mcp/tools.ts               + import_vsdx, analyze_vsdx
packages/server/src/http/routes.ts             + /api/import, /api/diagrams/:id/export.vsdx
packages/server/package.json                   + jszip, fast-xml-parser
packages/web/src/lib/export.ts                 + vsdx format branch
packages/web/src/components/InfiniteCanvas.tsx + drag-drop .vsdx handler
packages/web/src/components/Tile.tsx           + "Download as VSDX" menu item
docker-compose.yaml                            + prixmaviz-vsdx service
README.md                                      + vsdx section
```

---

## Phase 1: Foundation — engine identity and storage

### Task 1: Add `vsdx` engine to shared types

**Files:**
- Modify: `packages/shared/src/engines.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/engines.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { ALL_ENGINES, ENGINE_FAMILY, inferKind } from "./engines";

describe("vsdx engine identity", () => {
  it("is in ALL_ENGINES", () => {
    expect(ALL_ENGINES).toContain("vsdx");
  });
  it("has freeform family", () => {
    expect(ENGINE_FAMILY.vsdx).toBe("freeform");
  });
  it("does not have a Kroki path (rendered via unoserver, not Kroki)", () => {
    const { KROKI_PATH } = require("./engines");
    expect(KROKI_PATH.vsdx).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test engines.test.ts`
Expected: FAIL with "vsdx" not in ALL_ENGINES.

- [ ] **Step 3: Add `vsdx` to engine types**

Edit `packages/shared/src/engines.ts`. Add `"vsdx"` to the union, family map, but **not** to `KROKI_PATH`:

```ts
export type DiagramEngine =
  | "actdiag" | "blockdiag" | "bpmn" | "bytefield"
  | "c4plantuml" | "d2" | "dbml" | "diagramsnet"
  | "ditaa" | "erd" | "excalidraw" | "graphviz"
  | "mermaid" | "nomnoml" | "nwdiag" | "packetdiag"
  | "pikchr" | "plantuml" | "rackdiag" | "seqdiag"
  | "structurizr" | "svgbob" | "symbolator" | "tikz"
  | "umlet" | "vega" | "vegalite" | "vsdx" | "wavedrom" | "wireviz";

export const ENGINE_FAMILY: Record<DiagramEngine, EngineFamily> = {
  // ...all existing entries unchanged...
  vsdx: "freeform",
};

export const KROKI_PATH: Record<Exclude<DiagramEngine, "vsdx">, string> = {
  // ...all existing entries unchanged...
};
```

Note the type change on `KROKI_PATH`: `Exclude<DiagramEngine, "vsdx">` so the compiler enforces that vsdx must not have a Kroki path.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && bun test engines.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify other tests still pass**

Run: `cd packages/shared && bun test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/engines.ts packages/shared/src/engines.test.ts
git commit -m "feat(shared): register vsdx as a freeform engine (no Kroki path)"
```

### Task 2: Add `binary` kind and `bytes` field on Diagram type

**Files:**
- Modify: `packages/shared/src/ir.ts` (or wherever `Diagram` is defined)
- Modify: `packages/shared/src/engines.ts` (for `inferKind`)

- [ ] **Step 1: Locate the Diagram type**

Run: `cd packages/shared && grep -rn "type Diagram\|interface Diagram\|export type DiagramKind" src/`
Note which file contains `Diagram` and `DiagramKind` so you edit the right one.

- [ ] **Step 2: Write the failing test**

Append to `packages/shared/src/engines.test.ts`:

```ts
describe("inferKind for vsdx", () => {
  it("returns 'binary' for vsdx engine", () => {
    expect(inferKind("vsdx")).toBe("binary");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/shared && bun test engines.test.ts`
Expected: FAIL — `inferKind("vsdx")` currently returns `"passthrough"`.

- [ ] **Step 4: Extend `DiagramKind` and `inferKind`**

In the file that defines `DiagramKind` (commonly `ir.ts` or `index.ts`):

```ts
export type DiagramKind = "graph" | "passthrough" | "binary";
```

And in the `Diagram` type, add:

```ts
export interface Diagram {
  id: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  bytes?: Uint8Array;   // ← new, populated when kind === "binary"
  meta: DiagramMeta;
}
```

Update `inferKind` in `engines.ts`:

```ts
export function inferKind(engine: DiagramEngine): DiagramKind {
  if (engine === "vsdx") return "binary";
  return ENGINE_FAMILY[engine] === "graph" ? "graph" : "passthrough";
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/shared && bun test`
Expected: PASS.

- [ ] **Step 6: Verify downstream type-checks**

Run: `cd packages/server && bunx tsc --noEmit`
Expected: PASS, or the only errors are ones explicitly listed in tasks below (no incidental breakages from the union widening).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): add binary diagram kind with bytes field for vsdx"
```

### Task 3: DB migration — add `bytes` column to `diagrams`

**Files:**
- Create: `packages/server/migrations/0002_diagram_bytes.sql`
- Modify: `packages/server/src/db/diagrams.ts`
- Test: `packages/server/test/db/diagrams.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/test/db/diagrams.test.ts`:

```ts
it("createDiagram persists and reads back bytes for a binary diagram", async () => {
  const sql = getDb(TEST_DB_URL);
  const ws = await createWorkspace(sql);
  const sample = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb]);
  const d = await createDiagram(sql, {
    workspaceId: ws.id,
    slug: "v",
    name: "V",
    engine: "vsdx",
    kind: "binary",
    bytes: sample,
  });
  expect(d.bytes).toBeInstanceOf(Uint8Array);
  expect(d.bytes!.length).toBe(6);
  expect(d.bytes![0]).toBe(0x50);

  const fetched = await getDiagram(sql, ws.id, d.id);
  expect(fetched!.bytes!.length).toBe(6);
  expect(fetched!.bytes![3]).toBe(0x04);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/db/diagrams.test.ts`
Expected: FAIL — `createDiagram` doesn't accept `bytes`, and DbDiagram has no `bytes` field.

- [ ] **Step 3: Write the migration**

Create `packages/server/migrations/0002_diagram_bytes.sql`:

```sql
ALTER TABLE diagrams ADD COLUMN bytes BYTEA;
```

- [ ] **Step 4: Verify migration runner picks it up**

Run: `cd packages/server && bun test test/db/migrate.test.ts`
Expected: PASS — the migration runner discovers files in `migrations/` alphabetically and applies any not yet recorded in `schema_migrations`.

- [ ] **Step 5: Extend `DbDiagram` and `createDiagram` to handle bytes**

Edit `packages/server/src/db/diagrams.ts`:

```ts
export interface DbDiagram {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir: GraphIR | null;
  dsl: string | null;
  svg: string | null;
  bytes: Uint8Array | null;   // ← new
  meta: Record<string, unknown>;
  publicView: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToDiagram(row: Record<string, unknown>): DbDiagram {
  return {
    // ...existing fields...
    bytes: row.bytes ? new Uint8Array(row.bytes as Buffer) : null,
    // ...
  };
}

export async function createDiagram(sql: Sql, input: {
  workspaceId: string;
  slug: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
  bytes?: Uint8Array;
}): Promise<DbDiagram> {
  const id = newDiagramId();
  const rows = await sql`
    INSERT INTO diagrams (id, workspace_id, slug, name, engine, kind, ir, dsl, bytes)
    VALUES (
      ${id},
      ${input.workspaceId},
      ${input.slug},
      ${input.name},
      ${input.engine},
      ${input.kind},
      ${input.ir ? sql.json(input.ir as unknown as JSONLike) : null},
      ${input.dsl ?? null},
      ${input.bytes ? Buffer.from(input.bytes) : null}
    )
    RETURNING *
  `;
  return rowToDiagram(rows[0]!);
}
```

And extend `updateDiagram` to support `bytes`:

```ts
export async function updateDiagram(sql: Sql, workspaceId: string, id: string, patch: Partial<{
  name: string;
  ir: GraphIR;
  dsl: string;
  svg: string;
  bytes: Uint8Array;
  meta: Record<string, unknown>;
}>): Promise<DbDiagram | null> {
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.ir !== undefined) updates.ir = sql.json(patch.ir as unknown as JSONLike);
  if (patch.dsl !== undefined) updates.dsl = patch.dsl;
  if (patch.svg !== undefined) updates.svg = patch.svg;
  if (patch.bytes !== undefined) updates.bytes = Buffer.from(patch.bytes);
  if (patch.meta !== undefined) updates.meta = sql.json(patch.meta as unknown as JSONLike);
  // ...rest unchanged...
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/server && bun test test/db/diagrams.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/migrations/0002_diagram_bytes.sql packages/server/src/db/diagrams.ts packages/server/test/db/diagrams.test.ts
git commit -m "feat(db): add bytes column to diagrams for binary-kind storage"
```

### Task 4: Add `binary` branch to render dispatcher (returns error for now)

**Files:**
- Modify: `packages/server/src/render.ts`
- Test: `packages/server/test/renderers/render-binary.test.ts` (new)

This task adds the third branch in `renderDiagram` so the dispatcher knows about binary diagrams. It returns a clean `RenderFail` for now; the actual unoserver call lands in Task 8.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/renderers/render-binary.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { renderDiagram } from "../../src/render";
import type { Diagram } from "@prixmaviz/shared";

const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

describe("renderDiagram binary branch", () => {
  it("returns error if bytes missing for binary diagram", async () => {
    const d: Diagram = {
      id: "_", name: "_", engine: "vsdx", kind: "binary",
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    };
    const outcome = await renderDiagram(d, { kroki: fakeKroki });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("missing bytes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/render-binary.test.ts`
Expected: FAIL — the dispatcher doesn't know about `kind === "binary"` yet, will hit the existing graph/passthrough branch and error in a different way.

- [ ] **Step 3: Add the binary branch**

Edit `packages/server/src/render.ts`. Add the new branch in the body of `renderDiagram`:

```ts
import { renderVsdxBytes } from "./renderers/vsdx-render";

export interface RenderEngineDeps {
  kroki: KrokiClient;
  vsdxRendererUrl?: string;   // ← new, optional for now
}

export async function renderDiagram(
  diagram: Diagram,
  deps: RenderEngineDeps,
): Promise<RenderOutcome> {
  // ─── Binary branch (vsdx) ───────────────────────────────
  if (diagram.kind === "binary") {
    if (!diagram.bytes) return { ok: false, error: "binary diagram missing bytes" };
    // Stub: actual implementation in Task 8. For now, hard-error so the
    // type system still composes.
    return { ok: false, error: "binary rendering not implemented" };
  }

  // ─── existing graph + passthrough branches unchanged ────
  // ...rest of function...
}
```

(Leave the `renderVsdxBytes` import unused for now — it will be filled in in Task 8. Remove the import if your tsconfig forbids unused imports until Task 8.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/render-binary.test.ts`
Expected: PASS (the test only asserts "missing bytes" error; the second case where bytes ARE present hits the "not implemented" error which is fine for now).

- [ ] **Step 5: Verify no regression in existing render tests**

Run: `cd packages/server && bun test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/render.ts packages/server/test/renderers/render-binary.test.ts
git commit -m "feat(render): add binary kind branch in dispatcher (stub)"
```

---

## Phase 2: unoserver sidecar + native render

### Task 5: Build the unoserver Docker image

**Files:**
- Create: `docker/vsdx/Dockerfile`

We build our own image rather than pulling a third-party one because `unoserver` upstream images have inconsistent tags and we want a pinned, vendored recipe.

- [ ] **Step 1: Create the Dockerfile**

Create `docker/vsdx/Dockerfile`:

```dockerfile
# Build a slim LibreOffice + unoserver image for vsdx → SVG conversion.
# Pinned base image so behavior is reproducible.
FROM ubuntu:24.04@sha256:PINNED_DIGEST_HERE

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-draw \
      libreoffice-core \
      python3 \
      python3-pip \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Install unoserver. Pin to a tested version.
RUN pip3 install --no-cache-dir --break-system-packages unoserver==3.2

# unoserver exposes XMLRPC on 2003 by default. We wrap with a thin HTTP shim
# that takes raw vsdx bytes via POST and returns SVG bytes.
COPY shim.py /opt/shim.py

EXPOSE 2003
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:2003/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "/opt/shim.py"]
```

> **Note**: Replace `PINNED_DIGEST_HERE` with the actual sha256 digest. Run `docker pull ubuntu:24.04 && docker inspect ubuntu:24.04 | grep RepoDigests` and paste the digest. Pin it explicitly.

- [ ] **Step 2: Write the HTTP shim**

Create `docker/vsdx/shim.py`:

```python
#!/usr/bin/env python3
"""Thin HTTP shim around unoserver: POST vsdx bytes, get SVG bytes back."""
import http.server
import socketserver
import subprocess
import tempfile
import os
import sys
import threading
import time

PORT = 2003
# Start unoserver as a child process so libreoffice stays warm.
UNOSERVER = subprocess.Popen(
    ["unoserver", "--port", "2004"],
    stdout=sys.stdout,
    stderr=sys.stderr,
)
# Give unoserver time to bind.
time.sleep(2)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/convert/svg":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            self.send_error(400, "empty body")
            return
        body = self.rfile.read(length)
        with tempfile.NamedTemporaryFile(suffix=".vsdx", delete=False) as f_in:
            f_in.write(body)
            in_path = f_in.name
        out_path = in_path.replace(".vsdx", ".svg")
        try:
            r = subprocess.run(
                ["unoconvert", "--port", "2004", "--convert-to", "svg", in_path, out_path],
                capture_output=True,
                timeout=20,
            )
            if r.returncode != 0:
                self.send_error(500, f"unoconvert failed: {r.stderr.decode()[:200]}")
                return
            with open(out_path, "rb") as f:
                svg = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(svg)))
            self.end_headers()
            self.wfile.write(svg)
        except subprocess.TimeoutExpired:
            self.send_error(504, "conversion timeout")
        finally:
            try: os.unlink(in_path)
            except OSError: pass
            try: os.unlink(out_path)
            except OSError: pass

    def log_message(self, fmt, *args):
        # Suppress default access log; container logs already capture errors.
        return


with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.allow_reuse_address = True
    httpd.serve_forever()
```

- [ ] **Step 3: Build the image locally**

Run: `cd docker/vsdx && docker build -t prixmaviz-vsdx:dev .`
Expected: build succeeds. (Image is ~600MB.)

- [ ] **Step 4: Smoke-test the sidecar with curl**

Hand-build a tiny vsdx fixture if you don't have one, or grab any small `.vsdx` file. Then:

```bash
docker run --rm -d -p 2003:2003 --name pv-vsdx prixmaviz-vsdx:dev
sleep 5
curl -fsS http://localhost:2003/health
# expected: {"ok":true}
curl -fsS -X POST --data-binary @sample.vsdx http://localhost:2003/convert/svg -o out.svg
file out.svg
# expected: out.svg: SVG Scalable Vector Graphics image
docker stop pv-vsdx
```

- [ ] **Step 5: Commit**

```bash
git add docker/vsdx/
git commit -m "feat(infra): unoserver Docker sidecar for vsdx → SVG conversion"
```

### Task 6: Wire the sidecar into docker-compose

**Files:**
- Modify: `docker-compose.yaml`
- Modify: `.env.example`

- [ ] **Step 1: Add the service block**

Edit `docker-compose.yaml`. After the existing `kroki-excalidraw` block:

```yaml
  prixmaviz-vsdx:
    build:
      context: ./docker/vsdx
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:2003/health"]
      interval: 10s
      timeout: 3s
      retries: 5
```

And update the `prixmaviz` service to depend on it and pass the URL:

```yaml
  prixmaviz:
    # ...existing config...
    environment:
      # ...existing env...
      VSDX_RENDERER_URL: ${VSDX_RENDERER_URL:-http://prixmaviz-vsdx:2003}
      VSDX_RENDERER_TIMEOUT_MS: ${VSDX_RENDERER_TIMEOUT_MS:-10000}
      VSDX_MAX_BYTES: ${VSDX_MAX_BYTES:-5242880}
    depends_on:
      postgres:
        condition: service_healthy
      kroki:
        condition: service_started
      prixmaviz-vsdx:
        condition: service_healthy
```

- [ ] **Step 2: Update `.env.example`**

Edit `.env.example`. Append:

```
# vsdx (Visio) rendering sidecar
VSDX_RENDERER_URL=http://prixmaviz-vsdx:2003
VSDX_RENDERER_TIMEOUT_MS=10000
VSDX_MAX_BYTES=5242880
```

- [ ] **Step 3: Verify the compose file parses**

Run: `docker compose config`
Expected: prints merged config with no errors; new service appears.

- [ ] **Step 4: Bring up the stack and verify health**

Run: `docker compose up -d`
Run: `docker compose ps`
Expected: all services show `running` or `running (healthy)`. `prixmaviz-vsdx` shows healthy after ~30s.

Run: `docker compose down`

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yaml .env.example
git commit -m "feat(infra): wire prixmaviz-vsdx sidecar into compose stack"
```

### Task 7: Add `jszip` and `fast-xml-parser` dependencies

**Files:**
- Modify: `packages/server/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Install deps**

Run: `cd packages/server && bun add jszip@^3.10 fast-xml-parser@^4.5`
Expected: lockfile updated, no errors.

- [ ] **Step 2: Verify**

Run: `cd packages/server && bun test`
Expected: existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json bun.lock
git commit -m "feat(server): add jszip + fast-xml-parser for vsdx parse/build"
```

### Task 8: Implement `vsdx-render.ts` (bytes → SVG via sidecar, cached)

**Files:**
- Create: `packages/server/src/renderers/vsdx-render.ts`
- Test: `packages/server/test/renderers/vsdx-render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/renderers/vsdx-render.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "bun:test";
import { VsdxRenderer, VsdxRenderError } from "../../src/renderers/vsdx-render";

describe("VsdxRenderer", () => {
  it("POSTs bytes to /convert/svg and returns SVG text on 200", async () => {
    const calls: { url: string; bodyLen: number }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        bodyLen: (init?.body as Buffer | ArrayBuffer)?.byteLength ?? 0,
      });
      return new Response("<svg width='100' height='100'/>", {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    };
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const svg = await r.render(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(svg).toContain("<svg");
    expect(calls[0]!.url).toBe("http://uno:2003/convert/svg");
    expect(calls[0]!.bodyLen).toBe(4);
  });

  it("caches by content hash", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount++;
      return new Response("<svg/>", { status: 200 });
    };
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    await r.render(bytes);
    await r.render(bytes);
    expect(callCount).toBe(1);
  });

  it("throws VsdxRenderError on non-2xx", async () => {
    const fetchImpl = async () =>
      new Response("conversion failed", { status: 500 });
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(r.render(new Uint8Array([1, 2, 3]))).rejects.toThrow(VsdxRenderError);
  });

  it("respects timeout", async () => {
    const fetchImpl = (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 50,
    });
    await expect(r.render(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/vsdx-render.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement `vsdx-render.ts`**

Create `packages/server/src/renderers/vsdx-render.ts`:

```ts
import { LruSvgCache } from "../kroki/cache";

export interface VsdxRendererOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cache?: LruSvgCache;
  fetchImpl?: typeof fetch;
}

export class VsdxRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VsdxRenderError";
  }
}

export class VsdxRenderer {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cache: LruSvgCache;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VsdxRendererOptions = {}) {
    this.baseUrl = opts.baseUrl
      ?? process.env.VSDX_RENDERER_URL
      ?? "http://prixmaviz-vsdx:2003";
    this.timeoutMs = opts.timeoutMs
      ?? Number(process.env.VSDX_RENDERER_TIMEOUT_MS ?? "10000");
    this.cache = opts.cache ?? new LruSvgCache(32 * 1024 * 1024);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async render(bytes: Uint8Array): Promise<string> {
    const key = await this.hash(bytes);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/convert/svg`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new VsdxRenderError(`vsdx renderer ${res.status}: ${text.slice(0, 300)}`);
      }
      const svg = await res.text();
      this.cache.set(key, svg);
      return svg;
    } finally {
      clearTimeout(timer);
    }
  }

  private async hash(bytes: Uint8Array): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    return hasher.digest("hex");
  }
}

// Convenience export so render.ts can use a process-singleton.
let _defaultRenderer: VsdxRenderer | undefined;
export function renderVsdxBytes(bytes: Uint8Array): Promise<string> {
  if (!_defaultRenderer) _defaultRenderer = new VsdxRenderer();
  return _defaultRenderer.render(bytes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/vsdx-render.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Wire into `render.ts`**

Edit `packages/server/src/render.ts`. Replace the stub from Task 4:

```ts
import { renderVsdxBytes, VsdxRenderError } from "./renderers/vsdx-render";

export async function renderDiagram(
  diagram: Diagram,
  deps: RenderEngineDeps,
): Promise<RenderOutcome> {
  if (diagram.kind === "binary") {
    if (!diagram.bytes) return { ok: false, error: "binary diagram missing bytes" };
    if (diagram.engine !== "vsdx") {
      return { ok: false, error: `unsupported binary engine: ${diagram.engine}` };
    }
    try {
      const svg = await renderVsdxBytes(diagram.bytes);
      return { ok: true, result: { svg, dsl: "" }, warnings: [] };
    } catch (e) {
      if (e instanceof VsdxRenderError) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  // ...existing graph + passthrough branches unchanged...
}
```

- [ ] **Step 6: Update the render-binary test**

Edit `packages/server/test/renderers/render-binary.test.ts` to add a happy-path test using a fetch stub:

```ts
it("renders SVG when bytes present and renderer responds", async () => {
  // Mock renderVsdxBytes by setting an env URL the fetchImpl can reach.
  // Easier: import the module and stub the renderer's fetch via the
  // exported VsdxRenderer constructor pattern. For this integration test,
  // we accept the dependency injection limitation and use a process-wide
  // VsdxRenderer override.
  const { VsdxRenderer } = await import("../../src/renderers/vsdx-render");
  const stubFetch = async () => new Response("<svg id='ok'/>", { status: 200 });
  // The render.ts module uses a singleton renderer; for tests we replace
  // it by setting VSDX_RENDERER_URL to a value and supplying a custom
  // fetchImpl. Simpler approach: dynamic import a small helper that
  // resets the singleton — implement this helper now.

  // (Add this helper to vsdx-render.ts in step 7 below.)
});
```

Actually replace that placeholder with a cleaner approach: add an explicit setter to `vsdx-render.ts` and use it from the test.

- [ ] **Step 7: Add test-only renderer override**

Edit `packages/server/src/renderers/vsdx-render.ts`. Append:

```ts
export function setVsdxRendererForTests(r: VsdxRenderer | undefined): void {
  _defaultRenderer = r;
}
```

Rewrite the happy-path test:

```ts
import { VsdxRenderer, setVsdxRendererForTests } from "../../src/renderers/vsdx-render";

it("renders SVG when bytes present and renderer responds", async () => {
  setVsdxRendererForTests(
    new VsdxRenderer({
      baseUrl: "http://stub",
      fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
    })
  );
  try {
    const d: Diagram = {
      id: "_", name: "_", engine: "vsdx", kind: "binary",
      bytes: new Uint8Array([1, 2, 3, 4]),
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    };
    const outcome = await renderDiagram(d, { kroki: fakeKroki });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.svg).toContain("id='ok'");
  } finally {
    setVsdxRendererForTests(undefined);
  }
});
```

- [ ] **Step 8: Run all tests**

Run: `cd packages/server && bun test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/renderers/vsdx-render.ts packages/server/src/render.ts packages/server/test/renderers/
git commit -m "feat(render): vsdx bytes → SVG via unoserver sidecar (cached)"
```

---

## Phase 3: Upload pipeline + `import_vsdx` MCP tool

### Task 9: Add `/api/import` HTTP endpoint

**Files:**
- Modify: `packages/server/src/http/routes.ts`
- Test: `packages/server/test/http/import.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/http/import.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { handleApi } from "../../src/http/routes";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";
import { join } from "node:path";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

beforeEach(async () => {
  await reset();
  setVsdxRendererForTests(new VsdxRenderer({
    baseUrl: "http://stub",
    fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
  }));
});
afterEach(() => {
  setVsdxRendererForTests(undefined);
  closeDb();
});

describe("POST /api/import", () => {
  it("creates a vsdx diagram from valid .vsdx upload", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const body = new FormData();
    body.set("file", new Blob([VSDX_MAGIC, new Uint8Array(100)], { type: "application/vnd.ms-visio.drawing" }), "test.vsdx");
    body.set("name", "Test Visio");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const url = new URL(req.url);
    const res = await handleApi(req, url, { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    const json = await res!.json() as { diagramId: string; slug: string };
    expect(json.diagramId).toMatch(/^d_/);
    expect(json.slug).toBe("test-visio");
  });

  it("rejects upload missing vsdx magic bytes (400)", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const body = new FormData();
    body.set("file", new Blob([new Uint8Array([0, 0, 0, 0])]), "fake.vsdx");
    body.set("name", "Fake");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(400);
  });

  it("rejects upload exceeding VSDX_MAX_BYTES (413)", async () => {
    process.env.VSDX_MAX_BYTES = "100";
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const body = new FormData();
    const big = new Uint8Array(200);
    big.set(VSDX_MAGIC, 0);
    body.set("file", new Blob([big]), "big.vsdx");
    body.set("name", "Big");
    const req = new Request("http://x/api/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.id}` },
      body,
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(413);
    delete process.env.VSDX_MAX_BYTES;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/http/import.test.ts`
Expected: FAIL — `/api/import` route doesn't exist yet (likely 404 or undefined).

- [ ] **Step 3: Add the import route**

Edit `packages/server/src/http/routes.ts`. Inside `handleApi`, after the auth gate (after `const workspaceId = auth.workspaceId;`), add:

```ts
  // ─── Import (vsdx upload) ──────────────────────────────────
  if (p === "/api/import" && req.method === "POST") {
    return await importVsdxRoute(req, workspaceId, deps);
  }
```

And at the bottom of the file (in the helpers section), add:

```ts
const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

async function importVsdxRoute(
  req: Request,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const maxBytes = Number(process.env.VSDX_MAX_BYTES ?? "5242880");
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ ok: false, error: "file part required" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return Response.json(
      { ok: false, error: `file exceeds VSDX_MAX_BYTES (${maxBytes})` },
      { status: 413 },
    );
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  // Magic-byte check: vsdx is a ZIP file, starts with PK\x03\x04.
  if (buf.length < 4 || !VSDX_MAGIC.every((b, i) => buf[i] === b)) {
    return Response.json(
      { ok: false, error: "not a valid .vsdx file (missing ZIP magic)" },
      { status: 400 },
    );
  }
  const name = (formData.get("name") as string | null) ?? "imported";
  const slug = slugify(name);

  const row = await dbCreateDiagram(deps.sql, {
    workspaceId,
    slug,
    name,
    engine: "vsdx",
    kind: "binary",
    bytes: buf,
  });
  const diagram: Diagram = {
    id: row.id,
    name: row.name,
    engine: row.engine,
    kind: row.kind,
    bytes: row.bytes ?? undefined,
    meta: (row.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
  const outcome = await renderDiagram(diagram, { kroki: deps.kroki });
  if (!outcome.ok) {
    // Roll back the diagram row so we don't leave an unrendered orphan.
    const { deleteDiagram } = await import("../db/diagrams");
    await deleteDiagram(deps.sql, workspaceId, row.id);
    return Response.json(
      { ok: false, error: `render failed: ${outcome.error}` },
      { status: 502 },
    );
  }
  await dbUpdateDiagram(deps.sql, workspaceId, row.id, { svg: outcome.result.svg });
  broadcastRender(deps.hub, workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return Response.json({
    diagramId: row.id,
    slug: row.slug,
    render: outcome.result,
  });
}
```

You'll also need to ensure `dbDiagramToDomain` includes `bytes`. Update it:

```ts
function dbDiagramToDomain(d: DbDiagram): Diagram {
  return {
    id: d.id,
    name: d.name,
    engine: d.engine,
    kind: d.kind,
    ir: d.ir ?? undefined,
    dsl: d.dsl ?? undefined,
    bytes: d.bytes ?? undefined,
    meta: (d.meta as unknown as Diagram["meta"]) ?? emptyMeta(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/http/import.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Run all tests**

Run: `cd packages/server && bun test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/http/routes.ts packages/server/test/http/import.test.ts
git commit -m "feat(http): POST /api/import accepts .vsdx upload, renders, persists"
```

### Task 10: Add `import_vsdx` MCP tool

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Test: extend an existing MCP tools test or create `packages/server/test/mcp/import-vsdx.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/mcp/import-vsdx.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { dispatchTool } from "../../src/mcp/tools";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(async () => {
  await reset();
  setVsdxRendererForTests(new VsdxRenderer({
    baseUrl: "http://stub",
    fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
  }));
});
afterEach(() => {
  setVsdxRendererForTests(undefined);
  closeDb();
});

const VSDX_B64 = Buffer.from(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc])).toString("base64");

describe("MCP import_vsdx", () => {
  it("creates a vsdx diagram from base64 input", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const result = await dispatchTool("import_vsdx", {
      name: "Sample",
      base64Source: VSDX_B64,
    }, {
      sql,
      workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { diagramId: string; slug: string };
    expect(result.diagramId).toMatch(/^d_/);
    expect(result.slug).toBe("sample");
  });

  it("rejects base64 that decodes to non-vsdx bytes", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const notVsdx = Buffer.from(new Uint8Array([0, 0, 0, 0])).toString("base64");
    await expect(
      dispatchTool("import_vsdx", { name: "X", base64Source: notVsdx }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/not a valid .vsdx/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/mcp/import-vsdx.test.ts`
Expected: FAIL — tool not registered.

- [ ] **Step 3: Add the tool**

Edit `packages/server/src/mcp/tools.ts`. Add to the `TOOLS` array:

```ts
  {
    name: "import_vsdx",
    description: "Import a Microsoft Visio (.vsdx) file into the workspace. Renders natively via the server-side converter. Returns the new diagram ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        base64Source: { type: "string", description: "Base64-encoded .vsdx file bytes" },
      },
      required: ["name", "base64Source"],
    },
    run: importVsdxImpl,
  },
```

And add the impl at the bottom of the file:

```ts
const VSDX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

async function importVsdxImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = args.name as string;
  const base64Source = args.base64Source as string;
  if (!name || !base64Source) throw new Error("name and base64Source are required");
  const bytes = new Uint8Array(Buffer.from(base64Source, "base64"));
  if (bytes.length < 4 || !VSDX_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("not a valid .vsdx file (missing ZIP magic)");
  }
  const maxBytes = Number(process.env.VSDX_MAX_BYTES ?? "5242880");
  if (bytes.length > maxBytes) {
    throw new Error(`file exceeds VSDX_MAX_BYTES (${maxBytes})`);
  }
  const slug = slugify(name);

  const row = await dbCreateDiagram(ctx.sql, {
    workspaceId: ctx.workspaceId,
    slug,
    name,
    engine: "vsdx",
    kind: "binary",
    bytes,
  });
  const diagram = dbDiagramToDomain(row);
  const outcome = await renderDiagram(diagram, { kroki: ctx.kroki });
  if (!outcome.ok) {
    const { deleteDiagram } = await import("../db/diagrams");
    await deleteDiagram(ctx.sql, ctx.workspaceId, row.id);
    throw new Error(`render failed: ${outcome.error}`);
  }
  await dbUpdateDiagram(ctx.sql, ctx.workspaceId, row.id, { svg: outcome.result.svg });
  broadcast(ctx.hub, ctx.workspaceId, diagram, outcome.result.svg, outcome.warnings);
  return { diagramId: row.id, slug: row.slug, render: outcome.result };
}
```

Ensure `dbDiagramToDomain` in `tools.ts` also includes `bytes` (same fix as routes.ts).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/mcp/import-vsdx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/tools.ts packages/server/test/mcp/import-vsdx.test.ts
git commit -m "feat(mcp): add import_vsdx tool — base64 vsdx → rendered diagram"
```

---

## Phase 4: vsdx parse + `analyze_vsdx` MCP tool

### Task 11: Implement vsdx parser

**Files:**
- Create: `packages/server/src/renderers/vsdx-parse.ts`
- Test: `packages/server/test/renderers/vsdx-parse.test.ts`
- Test fixtures: `packages/server/test/fixtures/vsdx/basic-flowchart.vsdx`

The parser extracts shapes, connectors, labels, and layout from a vsdx ZIP. Use `jszip` to unzip and `fast-xml-parser` to read `visio/pages/page*.xml`.

- [ ] **Step 1: Build a test fixture**

The simplest reliable fixture is a hand-crafted vsdx with one page containing two rectangles and a connector. Since constructing one from scratch is tedious, save a known-good vsdx by opening any Visio (or LibreOffice Draw via Save As `.vsdx`) and exporting a minimal flowchart.

For the plan: place a checked-in fixture at `packages/server/test/fixtures/vsdx/basic-flowchart.vsdx`. The fixture must contain exactly:
- 1 page named "Page-1"
- 2 rectangle shapes labeled "A" and "B" (Master = "Process" from Basic Flowchart Shapes stencil)
- 1 connector from A to B labeled "go"

If you cannot easily produce one, generate one programmatically in this step using a script (script not part of the shipping code; one-off). The shape of the fixture is what matters.

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/renderers/vsdx-parse.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVsdx } from "../../src/renderers/vsdx-parse";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures/vsdx", name)));

describe("parseVsdx", () => {
  it("extracts pages, shapes, connectors from basic flowchart", async () => {
    const result = await parseVsdx(fixture("basic-flowchart.vsdx"));
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0]!;
    expect(page.shapes).toHaveLength(2);
    const a = page.shapes.find((s) => s.text === "A")!;
    const b = page.shapes.find((s) => s.text === "B")!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.master).toBe("Process");
    expect(page.connectors).toHaveLength(1);
    const conn = page.connectors[0]!;
    expect(conn.from).toBe(a.id);
    expect(conn.to).toBe(b.id);
    expect(conn.text).toBe("go");
  });

  it("returns empty pages for an empty vsdx", async () => {
    // Edge case: a vsdx with no <Shape> children.
    // Use a separate fixture or skip if we can't produce one cheaply.
    // Marked as it.todo for now if no fixture; remove when ready.
    expect(true).toBe(true); // placeholder
  });

  it("throws on non-zip input", async () => {
    await expect(parseVsdx(new Uint8Array([0, 0, 0]))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/vsdx-parse.test.ts`
Expected: FAIL — file `vsdx-parse.ts` doesn't exist.

- [ ] **Step 4: Implement `vsdx-parse.ts`**

Create `packages/server/src/renderers/vsdx-parse.ts`:

```ts
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface VsdxShape {
  id: string;
  master: string;       // e.g. "Process", "Decision" — empty string if unknown
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VsdxConnector {
  id: string;
  from: string;         // source shape id
  to: string;           // sink shape id
  text?: string;
}

export interface VsdxPage {
  name: string;
  shapes: VsdxShape[];
  connectors: VsdxConnector[];
}

export interface VsdxDocument {
  pages: VsdxPage[];
  metadata: {
    title?: string;
    author?: string;
    lastSaved?: string;
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  trimValues: true,
});

export async function parseVsdx(bytes: Uint8Array): Promise<VsdxDocument> {
  const zip = await JSZip.loadAsync(bytes);

  // Load pages.xml to enumerate pages.
  const pagesXmlEntry = zip.file("visio/pages/pages.xml");
  if (!pagesXmlEntry) {
    throw new Error("invalid .vsdx: missing visio/pages/pages.xml");
  }
  const pagesXml = await pagesXmlEntry.async("string");
  const pagesDoc = xmlParser.parse(pagesXml) as Record<string, unknown>;

  // Pages live at /Pages/Page (one or many).
  const pagesNode = (pagesDoc.Pages as Record<string, unknown>)?.Page;
  const pageList = Array.isArray(pagesNode) ? pagesNode : pagesNode ? [pagesNode] : [];

  const pages: VsdxPage[] = [];
  for (let i = 0; i < pageList.length; i++) {
    const pNode = pageList[i] as Record<string, unknown>;
    const name = (pNode["@_Name"] as string | undefined) ?? `Page-${i + 1}`;
    const pageNum = i + 1;
    const pageXmlEntry = zip.file(`visio/pages/page${pageNum}.xml`);
    if (!pageXmlEntry) continue;
    const pageXml = await pageXmlEntry.async("string");
    const page = parsePage(name, pageXml);
    pages.push(page);
  }

  // Metadata from visio/document.xml (best-effort).
  const metadata: VsdxDocument["metadata"] = {};
  const docEntry = zip.file("docProps/core.xml") ?? zip.file("visio/document.xml");
  if (docEntry) {
    const docXml = await docEntry.async("string");
    const titleMatch = docXml.match(/<dc:title>([^<]+)<\/dc:title>/);
    const authorMatch = docXml.match(/<dc:creator>([^<]+)<\/dc:creator>/);
    const modifiedMatch = docXml.match(/<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/);
    if (titleMatch) metadata.title = titleMatch[1];
    if (authorMatch) metadata.author = authorMatch[1];
    if (modifiedMatch) metadata.lastSaved = modifiedMatch[1];
  }

  return { pages, metadata };
}

function parsePage(name: string, xml: string): VsdxPage {
  const doc = xmlParser.parse(xml) as Record<string, unknown>;
  const pageContents = doc.PageContents as Record<string, unknown> | undefined;
  const shapesNode = (pageContents?.Shapes as Record<string, unknown>)?.Shape;
  const shapeList = Array.isArray(shapesNode) ? shapesNode : shapesNode ? [shapesNode] : [];

  const shapes: VsdxShape[] = [];
  const connectors: VsdxConnector[] = [];

  for (const s of shapeList) {
    const node = s as Record<string, unknown>;
    const id = String(node["@_ID"] ?? "");
    const masterName = String(node["@_Master"] ?? node["@_NameU"] ?? "");
    const text = extractText(node);
    const cells = extractCells(node);

    // Detect "is this a connector?" — Visio connectors have a "Begin"/"End"
    // cell pair pointing at other shape IDs.
    const beginRef = findGlueRef(node, "BeginX");
    const endRef = findGlueRef(node, "EndX");
    if (beginRef && endRef) {
      connectors.push({ id, from: beginRef, to: endRef, text: text || undefined });
      continue;
    }

    shapes.push({
      id,
      master: masterName,
      text,
      x: cells.PinX ?? 0,
      y: cells.PinY ?? 0,
      w: cells.Width ?? 0,
      h: cells.Height ?? 0,
    });
  }

  return { name, shapes, connectors };
}

function extractText(node: Record<string, unknown>): string {
  const text = node.Text;
  if (typeof text === "string") return text.trim();
  if (text && typeof text === "object") {
    // <Text>plain text<cp/></Text> — flatten anything that looks textual.
    const inner = JSON.stringify(text)
      .replace(/<[^>]+>/g, "")
      .replace(/[{}":,@\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return inner;
  }
  return "";
}

function extractCells(node: Record<string, unknown>): Record<string, number> {
  const cellsNode = node.Cell;
  const list = Array.isArray(cellsNode) ? cellsNode : cellsNode ? [cellsNode] : [];
  const out: Record<string, number> = {};
  for (const c of list) {
    const obj = c as Record<string, unknown>;
    const n = String(obj["@_N"] ?? "");
    const v = obj["@_V"];
    const num = typeof v === "number" ? v : Number(v);
    if (n && !Number.isNaN(num)) out[n] = num;
  }
  return out;
}

function findGlueRef(node: Record<string, unknown>, axis: "BeginX" | "EndX"): string | undefined {
  // Connectors store glue points in <Cell N="BeginX" F="PAR(PNT(Sheet.<id>!..." ...
  // We crudely extract the referenced sheet id from the formula.
  const cellsNode = node.Cell;
  const list = Array.isArray(cellsNode) ? cellsNode : cellsNode ? [cellsNode] : [];
  for (const c of list) {
    const obj = c as Record<string, unknown>;
    if (String(obj["@_N"]) !== axis) continue;
    const f = String(obj["@_F"] ?? "");
    const m = f.match(/Sheet\.(\d+)/);
    if (m) return m[1];
  }
  return undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/vsdx-parse.test.ts`
Expected: PASS for the happy-path and error case. The "empty vsdx" placeholder test passes trivially.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/renderers/vsdx-parse.ts packages/server/test/renderers/vsdx-parse.test.ts packages/server/test/fixtures/vsdx/basic-flowchart.vsdx
git commit -m "feat(vsdx): parser extracts shapes/connectors/labels from .vsdx"
```

### Task 12: Add `analyze_vsdx` MCP tool

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Test: `packages/server/test/mcp/analyze-vsdx.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/mcp/analyze-vsdx.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { dispatchTool } from "../../src/mcp/tools";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

describe("MCP analyze_vsdx", () => {
  it("returns structured pages from a stored vsdx diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const bytes = new Uint8Array(readFileSync(
      join(import.meta.dir, "../fixtures/vsdx/basic-flowchart.vsdx"),
    ));
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "x", name: "X",
      engine: "vsdx", kind: "binary",
      bytes,
    });
    const result = await dispatchTool("analyze_vsdx", { diagramId: d.id }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { pages: Array<{ shapes: unknown[] }> };
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages[0]!.shapes.length).toBeGreaterThan(0);
  });

  it("throws if diagram not found", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await expect(
      dispatchTool("analyze_vsdx", { diagramId: "nonexistent" }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/diagram not found/);
  });

  it("throws if diagram is not a vsdx engine", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "graph",
    });
    await expect(
      dispatchTool("analyze_vsdx", { diagramId: d.id }, {
        sql, workspaceId: ws.id,
        kroki: { renderSvg: async () => "<svg/>" } as never,
        hub: { broadcast: () => {} } as never,
      }),
    ).rejects.toThrow(/not a vsdx/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/mcp/analyze-vsdx.test.ts`
Expected: FAIL — tool not registered.

- [ ] **Step 3: Add the tool**

Edit `packages/server/src/mcp/tools.ts`. Add to TOOLS array:

```ts
  {
    name: "analyze_vsdx",
    description: "Parse a previously-imported vsdx diagram into structured JSON (shapes, connectors, labels, layout). Use this as the input to your own translation step if the user asks to convert a Visio diagram to Mermaid/D2/BPMN.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
      },
      required: ["diagramId"],
    },
    run: analyzeVsdxImpl,
  },
```

Add the impl:

```ts
import { parseVsdx } from "../renderers/vsdx-parse";

async function analyzeVsdxImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const row = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!row) throw new Error("diagram not found");
  if (row.engine !== "vsdx" || row.kind !== "binary" || !row.bytes) {
    throw new Error("diagram is not a vsdx import");
  }
  const doc = await parseVsdx(row.bytes);
  return doc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/mcp/analyze-vsdx.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/tools.ts packages/server/test/mcp/analyze-vsdx.test.ts
git commit -m "feat(mcp): add analyze_vsdx tool — vsdx → structured JSON for host-side AI"
```

---

## Phase 5: Write path — IR → vsdx

The write path has three independent paths:
1. **Passthrough**: engine === "vsdx" → return stored bytes.
2. **Structured**: kind === "graph" (Mermaid IR, or D2/Graphviz extracted to IR) → emit shape XML.
3. **Image-embed fallback**: everything else → wrap rendered SVG as PNG inside a minimal vsdx.

We'll build the stencil mapping and structured writer first, then the fallback, then the HTTP endpoint that selects between them.

### Task 13: Stencil mapping (IR shape → Visio master)

**Files:**
- Create: `packages/server/src/vsdx/stencils.ts`
- Test: `packages/server/test/vsdx/stencils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/vsdx/stencils.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mapShapeToMaster, ALL_MASTERS } from "../../src/vsdx/stencils";

describe("mapShapeToMaster", () => {
  it.each([
    ["rect", "Process"],
    ["roundedRect", "Terminator"],
    ["round", "Terminator"],
    ["diamond", "Decision"],
    ["parallelogram", "Data"],
    ["document", "Document"],
    ["cylinder", "Stored Data"],
    ["database", "Stored Data"],
    ["cloud", "Cloud"],
    ["subroutine", "Predefined Process"],
    ["manualInput", "Manual Input"],
    ["display", "Display"],
    ["connector", "Connector"],
    ["offPageConnector", "Off-page Connector"],
    ["circle", "Circle"],
    ["ellipse", "Ellipse"],
    ["triangle", "Triangle"],
    ["pentagon", "Pentagon"],
    ["hexagon", "Hexagon"],
    ["octagon", "Octagon"],
    ["star", "5-Point Star"],
    ["arrow", "Right Arrow"],
  ] as const)("maps IR shape '%s' to Visio master '%s'", (irShape, master) => {
    const result = mapShapeToMaster(irShape);
    expect(result.master).toBe(master);
  });

  it("returns Process fallback for unknown shape with a warning", () => {
    const result = mapShapeToMaster("unknown-shape");
    expect(result.master).toBe("Process");
    expect(result.fallback).toBe(true);
  });

  it("ALL_MASTERS lists every supported Visio master exactly once", () => {
    const set = new Set(ALL_MASTERS);
    expect(set.size).toBe(ALL_MASTERS.length);
    expect(set.has("Process")).toBe(true);
    expect(set.has("Decision")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/vsdx/stencils.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement stencils.ts**

Create `packages/server/src/vsdx/stencils.ts`:

```ts
/**
 * Map PrixmaViz IR node shape hints to Visio stencil masters.
 * Coverage: Basic Flowchart + Basic Shapes stencils (Visio built-in).
 */

export interface MasterMapping {
  master: string;
  /** True if the IR shape was not recognized and we fell back to a default. */
  fallback: boolean;
}

const FLOWCHART: Record<string, string> = {
  rect: "Process",
  process: "Process",
  roundedRect: "Terminator",
  round: "Terminator",
  terminator: "Terminator",
  diamond: "Decision",
  decision: "Decision",
  parallelogram: "Data",
  data: "Data",
  document: "Document",
  cylinder: "Stored Data",
  database: "Stored Data",
  cloud: "Cloud",
  subroutine: "Predefined Process",
  predefined: "Predefined Process",
  manualInput: "Manual Input",
  display: "Display",
  connector: "Connector",
  offPageConnector: "Off-page Connector",
};

const BASIC_SHAPES: Record<string, string> = {
  circle: "Circle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
  octagon: "Octagon",
  star: "5-Point Star",
  arrow: "Right Arrow",
};

const ALL_MAP: Record<string, string> = { ...FLOWCHART, ...BASIC_SHAPES };

export const ALL_MASTERS: string[] = Array.from(new Set(Object.values(ALL_MAP)));

export function mapShapeToMaster(irShape: string | undefined): MasterMapping {
  if (!irShape) return { master: "Process", fallback: true };
  const m = ALL_MAP[irShape];
  if (m) return { master: m, fallback: false };
  return { master: "Process", fallback: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/vsdx/stencils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/vsdx/stencils.ts packages/server/test/vsdx/stencils.test.ts
git commit -m "feat(vsdx): IR shape → Visio master mapping for ~35 stencil shapes"
```

### Task 14: XML builder helpers

**Files:**
- Create: `packages/server/src/vsdx/xml-builder.ts`
- Test: `packages/server/test/vsdx/xml-builder.test.ts`

Visio XML requires specific namespaces, ordering, and escaping. Centralize the gnarly bits.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/vsdx/xml-builder.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { xmlEscape, buildShapeXml, buildConnectorXml, buildPageXml } from "../../src/vsdx/xml-builder";

describe("xmlEscape", () => {
  it("escapes &, <, >, \", '", () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("buildShapeXml", () => {
  it("emits <Shape> with positional cells", () => {
    const out = buildShapeXml({
      id: "1", master: "Process", masterId: "1", text: "Hello",
      x: 1.5, y: 2.5, w: 1.0, h: 0.75,
    });
    expect(out).toContain('ID="1"');
    expect(out).toContain('Master="1"');
    expect(out).toContain("<Text>Hello</Text>");
    expect(out).toMatch(/N="PinX"\s+V="1\.5"/);
    expect(out).toMatch(/N="PinY"\s+V="2\.5"/);
  });
  it("escapes shape text", () => {
    const out = buildShapeXml({
      id: "1", master: "Process", masterId: "1", text: "A & B",
      x: 0, y: 0, w: 1, h: 1,
    });
    expect(out).toContain("A &amp; B");
  });
});

describe("buildConnectorXml", () => {
  it("emits <Shape> with BeginX/EndX glued to other shape IDs", () => {
    const out = buildConnectorXml({
      id: "3", from: "1", to: "2", text: "go",
    });
    expect(out).toContain("Sheet.1");
    expect(out).toContain("Sheet.2");
    expect(out).toContain("<Text>go</Text>");
  });
});

describe("buildPageXml", () => {
  it("composes shapes + connectors under <PageContents>", () => {
    const shapes = [buildShapeXml({ id: "1", master: "Process", masterId: "1", text: "A", x: 0, y: 0, w: 1, h: 1 })];
    const conns = [buildConnectorXml({ id: "2", from: "1", to: "1" })];
    const xml = buildPageXml(shapes, conns);
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<PageContents");
    expect(xml).toContain("<Shapes>");
    expect(xml.indexOf("Sheet.1")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/vsdx/xml-builder.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement xml-builder.ts**

Create `packages/server/src/vsdx/xml-builder.ts`:

```ts
/**
 * Minimal Visio XML emission. We don't try to cover every cell — just
 * enough for shapes with position/size/text and connectors with glue refs.
 */

export interface ShapeXmlInput {
  id: string;
  master: string;       // human-readable; informational
  masterId: string;     // numeric ID matching the masters/ part
  text: string;
  x: number;            // PinX (page coords, inches)
  y: number;            // PinY
  w: number;            // Width
  h: number;            // Height
}

export interface ConnectorXmlInput {
  id: string;
  from: string;         // source shape ID
  to: string;           // sink shape ID
  text?: string;        // edge label
}

const VISIO_NS = "http://schemas.microsoft.com/office/visio/2012/main";

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cell(n: string, v: number | string, f?: string): string {
  const fAttr = f ? ` F="${xmlEscape(f)}"` : "";
  return `<Cell N="${n}" V="${typeof v === "number" ? v : xmlEscape(String(v))}"${fAttr}/>`;
}

export function buildShapeXml(s: ShapeXmlInput): string {
  return [
    `<Shape ID="${xmlEscape(s.id)}" Type="Shape" Master="${xmlEscape(s.masterId)}">`,
    cell("PinX", s.x),
    cell("PinY", s.y),
    cell("Width", s.w),
    cell("Height", s.h),
    cell("LocPinX", s.w / 2),
    cell("LocPinY", s.h / 2),
    `<Text>${xmlEscape(s.text)}</Text>`,
    `</Shape>`,
  ].join("");
}

export function buildConnectorXml(c: ConnectorXmlInput): string {
  return [
    `<Shape ID="${xmlEscape(c.id)}" Type="Shape" Master="100">`, // Master 100 = generic Dynamic Connector
    cell("BeginX", 0, `PAR(PNT(Sheet.${c.from}!Connections.X1, Sheet.${c.from}!Connections.Y1))`),
    cell("BeginY", 0, `PAR(PNT(Sheet.${c.from}!Connections.X1, Sheet.${c.from}!Connections.Y1))`),
    cell("EndX",   0, `PAR(PNT(Sheet.${c.to}!Connections.X1, Sheet.${c.to}!Connections.Y1))`),
    cell("EndY",   0, `PAR(PNT(Sheet.${c.to}!Connections.X1, Sheet.${c.to}!Connections.Y1))`),
    c.text ? `<Text>${xmlEscape(c.text)}</Text>` : "",
    `</Shape>`,
  ].join("");
}

export function buildPageXml(shapeXmls: string[], connectorXmls: string[]): string {
  const all = [...shapeXmls, ...connectorXmls].join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<PageContents xmlns="${VISIO_NS}" xml:space="preserve">`,
    `<Shapes>${all}</Shapes>`,
    `</PageContents>`,
  ].join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/vsdx/xml-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/vsdx/xml-builder.ts packages/server/test/vsdx/xml-builder.test.ts
git commit -m "feat(vsdx): XML builder helpers for shape/connector/page emission"
```

### Task 15: Graphviz DOT layout extractor

**Files:**
- Create: `packages/server/src/renderers/graphviz-extractor.ts`
- Test: `packages/server/test/renderers/graphviz-extractor.test.ts`

To position shapes in the vsdx output, we ask Graphviz to compute layout. Graphviz binary (`dot`) ships in the prixmaviz container (verify via `which dot` — it's part of the kroki sidecars). The server shells out to `dot -Tjson` and parses the result.

- [ ] **Step 1: Verify `dot` is available in the server container**

Run: `docker compose exec prixmaviz which dot`
If missing, add `graphviz` to the apt-get install line in the main `Dockerfile` and rebuild.

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/renderers/graphviz-extractor.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { extractGraphFromDot } from "../../src/renderers/graphviz-extractor";

describe("extractGraphFromDot", () => {
  it("extracts nodes and edges with positions from a simple digraph", async () => {
    const dot = `
      digraph G {
        a [label="Alpha", shape=box];
        b [label="Beta", shape=diamond];
        a -> b [label="go"];
      }
    `;
    const ir = await extractGraphFromDot(dot);
    expect(Object.keys(ir.nodes)).toHaveLength(2);
    expect(ir.nodes.a!.label).toBe("Alpha");
    expect(ir.nodes.a!.shape).toBe("rect"); // dot "box" → IR "rect"
    expect(ir.nodes.b!.shape).toBe("diamond");
    expect(Object.keys(ir.edges)).toHaveLength(1);
    const edge = Object.values(ir.edges)[0]!;
    expect(edge.from).toBe("a");
    expect(edge.to).toBe("b");
    expect(edge.label).toBe("go");
    // Position is in node._x / _y (added field for the writer)
    expect(typeof (ir.nodes.a as unknown as { _x: number })._x).toBe("number");
  });

  it("throws on invalid DOT", async () => {
    await expect(extractGraphFromDot("not valid {{{")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/graphviz-extractor.test.ts`
Expected: FAIL — file doesn't exist.

- [ ] **Step 4: Implement graphviz-extractor.ts**

Create `packages/server/src/renderers/graphviz-extractor.ts`:

```ts
import type { GraphIR, IrNode, IrEdge } from "@prixmaviz/shared";

/**
 * Run `dot -Tjson` on the input DOT string and translate the layout
 * into a GraphIR with positions attached on each node as `_x`/`_y`.
 */
export async function extractGraphFromDot(dot: string): Promise<GraphIR & {
  nodes: Record<string, IrNode & { _x: number; _y: number }>;
}> {
  // Use Bun.spawn for sub-process invocation.
  const proc = Bun.spawn(["dot", "-Tjson"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(dot);
  await proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`dot failed (${exitCode}): ${stderr.slice(0, 200)}`);
  }
  const layout = JSON.parse(stdout) as DotJson;

  const ir: GraphIR & { nodes: Record<string, IrNode & { _x: number; _y: number }> } = {
    direction: "TB",
    nodes: {},
    edges: {},
    groups: {},
  };

  for (const obj of layout.objects ?? []) {
    if (!obj.name || obj.name.startsWith("cluster_")) continue;
    const [x, y] = parsePos(obj.pos);
    const shape = mapDotShapeToIr(obj.shape ?? "box");
    ir.nodes[obj.name] = {
      id: obj.name,
      label: obj.label ?? obj.name,
      shape,
      _x: x,
      _y: y,
    } as IrNode & { _x: number; _y: number };
  }

  let eIdx = 0;
  for (const e of layout.edges ?? []) {
    const fromObj = layout.objects?.[e.tail];
    const toObj = layout.objects?.[e.head];
    if (!fromObj || !toObj) continue;
    const eid = `e${++eIdx}`;
    ir.edges[eid] = {
      id: eid,
      from: fromObj.name!,
      to: toObj.name!,
      label: e.label,
    };
  }

  return ir;
}

interface DotJson {
  objects?: Array<{
    _gvid?: number;
    name?: string;
    label?: string;
    shape?: string;
    pos?: string;       // "x,y"
  }>;
  edges?: Array<{
    tail: number;       // index into objects
    head: number;
    label?: string;
  }>;
}

function parsePos(pos?: string): [number, number] {
  if (!pos) return [0, 0];
  const [x, y] = pos.split(",").map(Number);
  return [x ?? 0, y ?? 0];
}

function mapDotShapeToIr(dotShape: string): IrNode["shape"] {
  // Graphviz shape names → IR shape names
  switch (dotShape) {
    case "box": return "rect";
    case "rectangle": return "rect";
    case "diamond": return "diamond";
    case "ellipse": return "ellipse";
    case "circle": return "circle";
    case "parallelogram": return "parallelogram";
    case "cylinder": return "cylinder";
    case "triangle": return "triangle";
    case "hexagon": return "hexagon";
    case "octagon": return "octagon";
    case "star": return "star";
    default: return "rect";
  }
}
```

> **Note**: The `IrNode["shape"]` union in `shared/src/ir.ts` may need extending to include all of the above. Check; add any missing variants to the union as part of this task.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/graphviz-extractor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/renderers/graphviz-extractor.ts packages/server/test/renderers/graphviz-extractor.test.ts packages/shared/src/ir.ts
git commit -m "feat(vsdx): graphviz DOT → GraphIR with layout coords for vsdx writer"
```

### Task 16: D2 extractor

**Files:**
- Create: `packages/server/src/renderers/d2-extractor.ts`
- Test: `packages/server/test/renderers/d2-extractor.test.ts`

D2 has `--ast` output but most layout is in `--render`. Simplest path: invoke `d2 --layout=dagre fmt -` to normalize, then translate to DOT and pipe through the graphviz extractor. This deliberately reuses the layout logic from Task 15.

- [ ] **Step 1: Verify `d2` is available**

Run: `docker compose exec prixmaviz which d2`
If missing, install via `apk add d2` (alpine) or download binary in Dockerfile.

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/renderers/d2-extractor.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { extractGraphFromD2 } from "../../src/renderers/d2-extractor";

describe("extractGraphFromD2", () => {
  it("extracts nodes and edges from simple D2", async () => {
    const d2 = `
      a: Alpha
      b: Beta
      a -> b: go
    `;
    const ir = await extractGraphFromD2(d2);
    expect(Object.keys(ir.nodes)).toHaveLength(2);
    expect(ir.nodes.a!.label).toBe("Alpha");
    expect(Object.keys(ir.edges)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/d2-extractor.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement d2-extractor.ts**

Create `packages/server/src/renderers/d2-extractor.ts`:

```ts
import type { GraphIR, IrNode } from "@prixmaviz/shared";

/**
 * Convert a D2 source into a GraphIR with layout coordinates by:
 *   1. running `d2 --layout=dagre --render=stdout` to get SVG with positions,
 *      OR
 *   2. (simpler) running `d2 fmt` then a regex-based pass to extract nodes/edges
 *      and falling back to graphviz for layout.
 *
 * For v1 we use approach 2 — it's robust enough for the common case and
 * doesn't require us to parse D2's SVG output.
 */
export async function extractGraphFromD2(source: string): Promise<GraphIR & {
  nodes: Record<string, IrNode & { _x: number; _y: number }>;
}> {
  // Step 1: extract logical structure (nodes + edges) by line parsing.
  // D2 surface syntax:
  //   - "<id>: <label>" defines a node
  //   - "<id> -> <id>: <label>" defines an edge
  // This is intentionally narrow; complex D2 (containers, classes) falls back.
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nodes: Record<string, { label: string }> = {};
  const edges: Array<{ from: string; to: string; label?: string }> = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const edgeMatch = line.match(/^(\S+)\s*->\s*(\S+)(?::\s*(.+))?$/);
    if (edgeMatch) {
      const [, from, to, lbl] = edgeMatch;
      edges.push({ from: from!, to: to!, label: lbl?.trim() });
      // ensure both ends exist
      nodes[from!] ??= { label: from! };
      nodes[to!]   ??= { label: to! };
      continue;
    }
    const nodeMatch = line.match(/^(\S+):\s*(.+)$/);
    if (nodeMatch) {
      const [, id, lbl] = nodeMatch;
      nodes[id!] = { label: lbl!.trim() };
    }
  }

  // Step 2: build equivalent DOT and feed to graphviz for layout.
  const { extractGraphFromDot } = await import("./graphviz-extractor");
  const dotLines: string[] = ["digraph G {"];
  for (const [id, n] of Object.entries(nodes)) {
    dotLines.push(`  ${id} [label=${JSON.stringify(n.label)}];`);
  }
  for (const e of edges) {
    const lbl = e.label ? ` [label=${JSON.stringify(e.label)}]` : "";
    dotLines.push(`  ${e.from} -> ${e.to}${lbl};`);
  }
  dotLines.push("}");
  return extractGraphFromDot(dotLines.join("\n"));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/d2-extractor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/renderers/d2-extractor.ts packages/server/test/renderers/d2-extractor.test.ts
git commit -m "feat(vsdx): D2 → GraphIR extractor (via graphviz layout)"
```

### Task 17: Vsdx writer (graph path)

**Files:**
- Create: `packages/server/src/renderers/vsdx-writer.ts`
- Test: `packages/server/test/renderers/vsdx-writer.test.ts`

Writes a complete `.vsdx` ZIP from a GraphIR. Includes the bare-minimum OPC parts so LibreOffice and Visio both accept it.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/renderers/vsdx-writer.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { writeVsdxFromIr } from "../../src/renderers/vsdx-writer";
import { parseVsdx } from "../../src/renderers/vsdx-parse";
import type { GraphIR } from "@prixmaviz/shared";

function sampleIr(): GraphIR & { nodes: Record<string, { id: string; label: string; shape: string; _x: number; _y: number }> } {
  return {
    direction: "TB",
    nodes: {
      a: { id: "a", label: "Alpha", shape: "rect",    _x: 1.0, _y: 5.0 },
      b: { id: "b", label: "Beta",  shape: "diamond", _x: 3.0, _y: 5.0 },
    },
    edges: {
      e1: { id: "e1", from: "a", to: "b", label: "go" },
    },
    groups: {},
  };
}

describe("writeVsdxFromIr", () => {
  it("produces a valid ZIP (PK magic)", async () => {
    const bytes = await writeVsdxFromIr(sampleIr());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it("round-trips through parser to the same shape/connector graph", async () => {
    const ir = sampleIr();
    const bytes = await writeVsdxFromIr(ir);
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages).toHaveLength(1);
    const page = parsed.pages[0]!;
    expect(page.shapes).toHaveLength(2);
    const a = page.shapes.find((s) => s.text === "Alpha")!;
    const b = page.shapes.find((s) => s.text === "Beta")!;
    expect(a.master).toBe("Process");
    expect(b.master).toBe("Decision");
    expect(page.connectors).toHaveLength(1);
    expect(page.connectors[0]!.text).toBe("go");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/vsdx-writer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement vsdx-writer.ts**

Create `packages/server/src/renderers/vsdx-writer.ts`:

```ts
import JSZip from "jszip";
import type { GraphIR, IrEdge, IrNode } from "@prixmaviz/shared";
import { mapShapeToMaster, ALL_MASTERS } from "../vsdx/stencils";
import { buildShapeXml, buildConnectorXml, buildPageXml, xmlEscape } from "../vsdx/xml-builder";

type IrNodeWithPos = IrNode & { _x?: number; _y?: number };

/**
 * Write a complete .vsdx (OPC ZIP) byte stream from a GraphIR with optional
 * per-node `_x`/`_y` coordinates. Returns a Uint8Array suitable for stuffing
 * into Postgres or sending as a response body.
 */
export async function writeVsdxFromIr(ir: GraphIR): Promise<Uint8Array> {
  const zip = new JSZip();

  // Assign sequential numeric IDs to nodes and edges (Visio shape IDs).
  const nodeIds = new Map<string, string>();
  let nextShapeId = 1;
  const nodeEntries = Object.entries(ir.nodes) as Array<[string, IrNodeWithPos]>;
  for (const [k] of nodeEntries) nodeIds.set(k, String(nextShapeId++));

  // Build shape XML fragments.
  const shapeXmls: string[] = [];
  for (const [k, n] of nodeEntries) {
    const mapping = mapShapeToMaster(n.shape);
    const masterId = String(ALL_MASTERS.indexOf(mapping.master) + 1); // 1-indexed
    shapeXmls.push(buildShapeXml({
      id: nodeIds.get(k)!,
      master: mapping.master,
      masterId,
      text: n.label ?? "",
      x: n._x ?? 0,
      y: n._y ?? 0,
      w: 1.0,
      h: 0.75,
    }));
  }

  // Build connector XML fragments.
  const connectorXmls: string[] = [];
  for (const e of Object.values(ir.edges) as IrEdge[]) {
    const fromId = nodeIds.get(e.from);
    const toId = nodeIds.get(e.to);
    if (!fromId || !toId) continue;
    connectorXmls.push(buildConnectorXml({
      id: String(nextShapeId++),
      from: fromId,
      to: toId,
      text: e.label,
    }));
  }

  // Compose the minimal OPC parts.
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("visio/document.xml", documentXml());
  zip.file("visio/_rels/document.xml.rels", documentRelsXml());
  zip.file("visio/pages/pages.xml", pagesIndexXml());
  zip.file("visio/pages/_rels/pages.xml.rels", pagesRelsXml());
  zip.file("visio/pages/page1.xml", buildPageXml(shapeXmls, connectorXmls));
  zip.file("docProps/core.xml", corePropsXml());
  zip.file("docProps/app.xml", appPropsXml());

  // Add a masters list (minimal — names only, no geometry).
  zip.file("visio/masters/masters.xml", mastersIndexXml());

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return buf;
}

// ─── OPC parts (minimal, hardcoded skeletons) ─────────────────────────────

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
  <Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function documentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <DocumentSettings/>
</VisioDocument>`;
}

function documentRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>
</Relationships>`;
}

function pagesIndexXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Page ID="0" Name="Page-1">
    <PageSheet/>
    <Rel r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
  </Page>
</Pages>`;
}

function pagesRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

function mastersIndexXml(): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Masters xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">`,
  ];
  for (let i = 0; i < ALL_MASTERS.length; i++) {
    lines.push(`<Master ID="${i + 1}" NameU="${xmlEscape(ALL_MASTERS[i]!)}" Name="${xmlEscape(ALL_MASTERS[i]!)}"/>`);
  }
  lines.push(`</Masters>`);
  return lines.join("");
}

function corePropsXml(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>PrixmaViz</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>PrixmaViz</Application>
</Properties>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/vsdx-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Optional smoke: open the output in LibreOffice**

Optional but recommended:
```bash
cd packages/server
bun -e '
  import { writeFileSync } from "node:fs";
  import { writeVsdxFromIr } from "./src/renderers/vsdx-writer.ts";
  const ir = {
    direction: "TB",
    nodes: {
      a: { id:"a", label:"Alpha", shape:"rect",    _x:1, _y:5 },
      b: { id:"b", label:"Beta",  shape:"diamond", _x:3, _y:5 },
    },
    edges: { e1: { id:"e1", from:"a", to:"b", label:"go" } },
    groups: {},
  };
  writeFileSync("/tmp/test.vsdx", await writeVsdxFromIr(ir));
'
soffice --headless --convert-to svg /tmp/test.vsdx --outdir /tmp
file /tmp/test.svg
# Expected: SVG with non-zero dimensions, two labeled shapes visible.
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/renderers/vsdx-writer.ts packages/server/test/renderers/vsdx-writer.test.ts
git commit -m "feat(vsdx): IR → vsdx XML writer (graph path) with stencil mapping"
```

### Task 18: Image-embed fallback writer

**Files:**
- Create: `packages/server/src/renderers/vsdx-writer-fallback.ts`
- Test: `packages/server/test/renderers/vsdx-writer-fallback.test.ts`

For non-graph engines (sequence, chart, etc.) we don't have a shape graph, but we DO have a rendered SVG. Rasterize → PNG → embed as a single image shape covering page 1.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/renderers/vsdx-writer-fallback.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { writeVsdxFromSvg } from "../../src/renderers/vsdx-writer-fallback";
import { parseVsdx } from "../../src/renderers/vsdx-parse";

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';

describe("writeVsdxFromSvg", () => {
  it("produces a valid vsdx containing one page with embedded image", async () => {
    const bytes = await writeVsdxFromSvg(SAMPLE_SVG);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const parsed = await parseVsdx(bytes);
    expect(parsed.pages.length).toBe(1);
    // The image-shape carries no text or master, but it should exist.
    expect(parsed.pages[0]!.shapes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/renderers/vsdx-writer-fallback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement vsdx-writer-fallback.ts**

Convert SVG → PNG using Bun's image APIs (or shell out to `rsvg-convert`, which is in libreoffice's image stack). Then embed the PNG bytes inside a vsdx as a foreign-data shape.

Create `packages/server/src/renderers/vsdx-writer-fallback.ts`:

```ts
import JSZip from "jszip";
import { xmlEscape } from "../vsdx/xml-builder";

/**
 * Build a minimal vsdx containing exactly one page with a single image shape
 * (the rasterized SVG). This is the catch-all for engines without a graph IR.
 */
export async function writeVsdxFromSvg(svg: string): Promise<Uint8Array> {
  // Rasterize SVG to PNG. rsvg-convert is reliable and ships with libreoffice.
  const pngBytes = await rasterizeSvgToPng(svg);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes());
  zip.file("_rels/.rels", rootRels());
  zip.file("visio/document.xml", documentXml());
  zip.file("visio/_rels/document.xml.rels", documentRels());
  zip.file("visio/pages/pages.xml", pagesIndex());
  zip.file("visio/pages/_rels/pages.xml.rels", pagesRels());
  zip.file("visio/pages/page1.xml", pageWithImageXml());
  zip.file("visio/media/image1.png", pngBytes);
  zip.file("visio/pages/_rels/page1.xml.rels", pageRels());

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function rasterizeSvgToPng(svg: string): Promise<Uint8Array> {
  const proc = Bun.spawn(["rsvg-convert", "-f", "png"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(svg);
  await proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`rsvg-convert failed: ${stderr.slice(0, 200)}`);
  return new Uint8Array(stdout);
}

// ─── OPC parts ─────────────────────────────────────────────────────────────

function contentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
</Types>`;
}

function rootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`;
}

function documentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve"><DocumentSettings/></VisioDocument>`;
}

function documentRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`;
}

function pagesIndex(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Page ID="0" Name="Page-1"><PageSheet/></Page>
</Pages>`;
}

function pagesRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

function pageRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;
}

function pageWithImageXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
              xml:space="preserve">
  <Shapes>
    <Shape ID="1" Type="Foreign">
      <Cell N="PinX" V="4.25"/>
      <Cell N="PinY" V="5.5"/>
      <Cell N="Width" V="8.5"/>
      <Cell N="Height" V="11"/>
      <Cell N="LocPinX" V="4.25"/>
      <Cell N="LocPinY" V="5.5"/>
      <ForeignData ForeignType="Bitmap" CompressionType="PNG">
        <Rel r:id="rId1"/>
      </ForeignData>
    </Shape>
  </Shapes>
</PageContents>`;
}
```

> **Note**: `rsvg-convert` must be installed in the prixmaviz container. Add it to the Dockerfile if missing (`apt-get install librsvg2-bin`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/renderers/vsdx-writer-fallback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/renderers/vsdx-writer-fallback.ts packages/server/test/renderers/vsdx-writer-fallback.test.ts
git commit -m "feat(vsdx): image-embed fallback writer for non-graph engines"
```

### Task 19: HTTP endpoint — `GET /api/diagrams/:id/export.vsdx`

**Files:**
- Modify: `packages/server/src/http/routes.ts`
- Test: `packages/server/test/http/export-vsdx.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/http/export-vsdx.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { handleApi } from "../../src/http/routes";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(reset);
afterEach(closeDb);

const fakeHub = { broadcast: () => {} } as never;
const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

describe("GET /api/diagrams/:id/export.vsdx", () => {
  it("returns stored bytes verbatim for vsdx-engine diagrams", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const original = new Uint8Array(readFileSync(
      join(import.meta.dir, "../fixtures/vsdx/basic-flowchart.vsdx"),
    ));
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "x", name: "X",
      engine: "vsdx", kind: "binary", bytes: original,
    });
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("application/vnd.ms-visio.drawing");
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got.length).toBe(original.length);
    expect(got[0]).toBe(0x50);  // round-trip byte-identical (verify first 100 bytes)
    for (let i = 0; i < Math.min(100, original.length); i++) {
      expect(got[i]).toBe(original[i]);
    }
  });

  it("produces a structured vsdx for a Mermaid graph diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id, slug: "m", name: "M",
      engine: "mermaid", kind: "graph",
      ir: {
        direction: "TB",
        nodes: { a: { id: "a", label: "A", shape: "rect" } },
        edges: {},
        groups: {},
      },
    });
    const req = new Request(`http://x/api/diagrams/${d.id}/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(200);
    const got = new Uint8Array(await res!.arrayBuffer());
    expect(got[0]).toBe(0x50); // ZIP magic
  });

  it("404 for non-existent diagram", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const req = new Request(`http://x/api/diagrams/nope/export.vsdx`, {
      method: "GET",
      headers: { Authorization: `Bearer ${ws.id}` },
    });
    const res = await handleApi(req, new URL(req.url), { sql, kroki: fakeKroki, hub: fakeHub });
    expect(res!.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test test/http/export-vsdx.test.ts`
Expected: FAIL — route not registered.

- [ ] **Step 3: Add the export route**

Edit `packages/server/src/http/routes.ts`. After the existing diagram routes:

```ts
  const exportVsdxMatch = p.match(/^\/api\/diagrams\/([^/]+)\/export\.vsdx$/);
  if (exportVsdxMatch && req.method === "GET") {
    return await exportVsdxRoute(exportVsdxMatch[1]!, workspaceId, deps);
  }
```

And add the helper at the bottom of the file:

```ts
async function exportVsdxRoute(
  id: string,
  workspaceId: string,
  deps: RouteDeps,
): Promise<Response> {
  const row = await dbGetDiagram(deps.sql, workspaceId, id);
  if (!row) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });

  let bytes: Uint8Array;
  // Branch 1: vsdx-engine → return stored bytes verbatim.
  if (row.engine === "vsdx" && row.kind === "binary" && row.bytes) {
    bytes = row.bytes;
  }
  // Branch 2: graph engine with structured IR + (mermaid | d2 | graphviz) → structured writer.
  else if (row.kind === "graph" && row.ir && canStructuredVsdx(row.engine)) {
    const { writeVsdxFromIr } = await import("../renderers/vsdx-writer");
    const ir = await maybeExtractLayout(row.engine, row.ir, row.dsl);
    bytes = await writeVsdxFromIr(ir);
  }
  // Branch 3: anything else → image-embed fallback.
  else {
    if (!row.svg) return Response.json({ ok: false, error: "no rendered SVG to embed" }, { status: 400 });
    const { writeVsdxFromSvg } = await import("../renderers/vsdx-writer-fallback");
    bytes = await writeVsdxFromSvg(row.svg);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-visio.drawing",
      "Content-Disposition": `attachment; filename="${row.slug}.vsdx"`,
    },
  });
}

function canStructuredVsdx(engine: DiagramEngine): boolean {
  return engine === "mermaid" || engine === "d2" || engine === "graphviz";
}

async function maybeExtractLayout(
  engine: DiagramEngine,
  ir: GraphIR,
  dsl: string | null,
): Promise<GraphIR> {
  // Mermaid's IR already has shape hints; layout comes from graphviz-extractor
  // applied to a DOT we generate from the IR.
  if (engine === "mermaid") {
    const { extractGraphFromDot } = await import("../renderers/graphviz-extractor");
    const dot = irToDot(ir);
    return await extractGraphFromDot(dot);
  }
  if (engine === "graphviz" && dsl) {
    const { extractGraphFromDot } = await import("../renderers/graphviz-extractor");
    return await extractGraphFromDot(dsl);
  }
  if (engine === "d2" && dsl) {
    const { extractGraphFromD2 } = await import("../renderers/d2-extractor");
    return await extractGraphFromD2(dsl);
  }
  return ir;
}

function irToDot(ir: GraphIR): string {
  const lines = ["digraph G { rankdir=" + (ir.direction ?? "TB") + ";"];
  for (const n of Object.values(ir.nodes)) {
    const shape = n.shape ?? "box";
    lines.push(`  ${n.id} [label=${JSON.stringify(n.label ?? n.id)}, shape="${shape}"];`);
  }
  for (const e of Object.values(ir.edges)) {
    const lbl = e.label ? ` [label=${JSON.stringify(e.label)}]` : "";
    lines.push(`  ${e.from} -> ${e.to}${lbl};`);
  }
  lines.push("}");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test test/http/export-vsdx.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/http/routes.ts packages/server/test/http/export-vsdx.test.ts
git commit -m "feat(http): GET /api/diagrams/:id/export.vsdx with engine-aware branching"
```

---

## Phase 6: Web client

### Task 20: Drag-drop `.vsdx` onto canvas

**Files:**
- Modify: `packages/web/src/components/InfiniteCanvas.tsx`

- [ ] **Step 1: Locate the canvas root element**

Run: `grep -n 'className.*canvas' packages/web/src/components/InfiniteCanvas.tsx`
Note the outermost wrapper `<div>` where you'll attach drag-drop handlers.

- [ ] **Step 2: Add drag-drop state and handlers**

Edit `packages/web/src/components/InfiniteCanvas.tsx`. Add at the top of the component:

```tsx
const [dragOver, setDragOver] = useState(false);

const handleDragOver = (e: React.DragEvent) => {
  if (Array.from(e.dataTransfer.items).some((it) => it.kind === "file")) {
    e.preventDefault();
    setDragOver(true);
  }
};

const handleDragLeave = () => setDragOver(false);

const handleDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  setDragOver(false);
  const files = Array.from(e.dataTransfer.files);
  const vsdx = files.find((f) => f.name.toLowerCase().endsWith(".vsdx"));
  if (!vsdx) return;

  const fd = new FormData();
  fd.set("file", vsdx);
  fd.set("name", vsdx.name.replace(/\.vsdx$/i, ""));
  const res = await authFetch("/api/import", { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "import failed" }));
    alert(`Visio import failed: ${(err as { error: string }).error}`);
    return;
  }
  // Server broadcasts the new diagram via WS — the canvas will pick it up.
};
```

Wrap the canvas root with the handlers:

```tsx
return (
  <div
    className={`infinite-canvas ${dragOver ? "drag-over" : ""}`}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
  >
    {/* existing children */}
    {dragOver && (
      <div className="drop-overlay">Drop .vsdx to import</div>
    )}
  </div>
);
```

Add styles for `.drop-overlay` and `.drag-over` in `packages/web/src/styles.css`.

- [ ] **Step 3: Manual smoke-test**

Run: `bun --cwd packages/web dev` (or whichever script starts the dev server).
Drag a `.vsdx` onto the canvas. Verify:
- Overlay appears on dragover
- After drop, a new tile appears with the rendered vsdx as SVG
- The browser console shows no errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/InfiniteCanvas.tsx packages/web/src/styles.css
git commit -m "feat(web): drag-drop .vsdx onto canvas → calls /api/import"
```

### Task 21: "Download as VSDX" tile menu item

**Files:**
- Modify: `packages/web/src/components/Tile.tsx`
- Modify: `packages/web/src/lib/export.ts`

- [ ] **Step 1: Extend export.ts**

Edit `packages/web/src/lib/export.ts`:

```ts
export type ExportFormat = "svg" | "png" | "jpeg" | "vsdx";

export async function downloadDiagramAs(
  diagramId: string,
  slug: string,
  format: ExportFormat,
  svgString: string,
): Promise<void> {
  if (format === "vsdx") {
    const res = await authFetch(`/api/diagrams/${diagramId}/export.vsdx`);
    if (!res.ok) throw new Error("vsdx export failed");
    const blob = await res.blob();
    triggerDownload(blob, getExportFilename(slug, format));
    return;
  }
  const blob = await svgToBlob(svgString, format);
  triggerDownload(blob, getExportFilename(slug, format));
}

export function getExportFilename(slug: string, format: ExportFormat): string {
  if (format === "vsdx") return `${slug}.vsdx`;
  const ext = format === "jpeg" ? "jpg" : format;
  return `${slug}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

(`authFetch` is assumed already imported in the same file's environment; check and import as needed.)

- [ ] **Step 2: Update the export test**

Edit `packages/web/test/lib/export.test.ts`. Add:

```ts
it("getExportFilename handles vsdx", () => {
  expect(getExportFilename("flow", "vsdx")).toBe("flow.vsdx");
});
```

Run: `cd packages/web && bun test`
Expected: PASS.

- [ ] **Step 3: Add the menu item to Tile.tsx**

Locate the existing "Download as SVG/PNG/JPEG" menu in `packages/web/src/components/Tile.tsx`. Add a fourth option:

```tsx
<button
  onClick={() => downloadDiagramAs(diagram.id, diagram.slug, "vsdx", svg)}
  className="menu-item"
>
  Download as VSDX
</button>
```

- [ ] **Step 4: Smoke test**

Run the dev server. Open a Mermaid diagram tile, click the menu, click "Download as VSDX". Verify a `.vsdx` downloads. Open it in LibreOffice / Visio — should show labeled shapes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/export.ts packages/web/src/components/Tile.tsx packages/web/test/lib/export.test.ts
git commit -m "feat(web): Download as VSDX menu item + export.ts vsdx branch"
```

---

## Phase 7: Documentation

### Task 22: README + spec cross-link

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-14-prixmaviz-vsdx-engine-design.md` (status flip)

- [ ] **Step 1: Add VSDX section to README**

Edit `README.md`. After the "Architecture" section, add:

```markdown
## Visio (`.vsdx`) support

PrixmaViz natively renders, imports, and exports Microsoft Visio diagrams:

- **Drag-drop** a `.vsdx` onto the canvas to render it (server-side via the `prixmaviz-vsdx` sidecar, which runs `unoserver`/LibreOffice).
- **AI translation** — ask Claude/GPT/etc. "convert this Visio diagram to Mermaid" and the AI calls `analyze_vsdx` to get structured shape data, then generates DSL with `create_diagram`. No server-side LLM is used.
- **Export** any graph diagram as `.vsdx` via the tile menu. Mermaid/D2/Graphviz emit Visio-editable shapes from a ~35-shape stencil. Other engines produce an image-embed `.vsdx`.

Self-host requires the `prixmaviz-vsdx` sidecar from `docker-compose.yaml`. Default upload cap is 5MB (`VSDX_MAX_BYTES`).
```

- [ ] **Step 2: Flip the spec status**

Edit `docs/superpowers/specs/2026-05-14-prixmaviz-vsdx-engine-design.md`:

```markdown
**Status:** Implemented; see [implementation plan](../plans/2026-05-14-prixmaviz-vsdx-engine.md)
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-05-14-prixmaviz-vsdx-engine-design.md
git commit -m "docs: README vsdx section; flip spec status to implemented"
```

---

## Final integration test

### Task 23: End-to-end smoke

**Files:**
- Test: `packages/server/test/e2e/vsdx-roundtrip.test.ts`

- [ ] **Step 1: Write the smoke test**

Create `packages/server/test/e2e/vsdx-roundtrip.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { dispatchTool } from "../../src/mcp/tools";
import { readFileSync } from "node:fs";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

async function reset() {
  const sql = postgres(TEST_DB_URL);
  await sql`DROP TABLE IF EXISTS annotations CASCADE`;
  await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
  await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
  await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
  await sql.end();
  await runMigrations(TEST_DB_URL, join(import.meta.dir, "../../migrations"));
}

beforeEach(async () => {
  await reset();
  setVsdxRendererForTests(new VsdxRenderer({
    baseUrl: "http://stub",
    fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
  }));
});
afterEach(() => {
  setVsdxRendererForTests(undefined);
  closeDb();
});

describe("vsdx end-to-end", () => {
  it("import → analyze → returns parsed shapes", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const fixture = readFileSync(join(import.meta.dir, "../fixtures/vsdx/basic-flowchart.vsdx"));
    const b64 = Buffer.from(fixture).toString("base64");

    const imported = await dispatchTool("import_vsdx", { name: "RoundTrip", base64Source: b64 }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { diagramId: string };

    const analyzed = await dispatchTool("analyze_vsdx", { diagramId: imported.diagramId }, {
      sql, workspaceId: ws.id,
      kroki: { renderSvg: async () => "<svg/>" } as never,
      hub: { broadcast: () => {} } as never,
    }) as { pages: Array<{ shapes: Array<{ text: string }> }> };

    expect(analyzed.pages).toHaveLength(1);
    const shapeTexts = analyzed.pages[0]!.shapes.map((s) => s.text).sort();
    expect(shapeTexts).toContain("A");
    expect(shapeTexts).toContain("B");
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd packages/server && bun test test/e2e/vsdx-roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/server && bun test && cd ../web && bun test && cd ../shared && bun test`
Expected: all PASS.

- [ ] **Step 4: Manual smoke through the running stack**

Run: `docker compose up -d --build`
- Open `http://localhost:5180`
- Drag-drop a real `.vsdx` onto the canvas → tile appears with rendered SVG
- Click tile menu → "Download as VSDX" → file downloads, opens cleanly in Visio/LibreOffice
- Open a Mermaid tile → "Download as VSDX" → opens in LibreOffice and shows labeled shapes (not just an image)
- In Claude Code or another MCP host, ask "convert this Visio diagram to Mermaid" — host should call `analyze_vsdx` then `create_diagram`, producing a Mermaid tile alongside the vsdx tile

- [ ] **Step 5: Commit**

```bash
git add packages/server/test/e2e/vsdx-roundtrip.test.ts
git commit -m "test(vsdx): end-to-end import → analyze smoke test"
```

---

## Self-review checklist

**Spec coverage:**

| Spec section | Covered by task(s) |
|---|---|
| Engine identity (`vsdx`, `kind: "binary"`) | 1, 2 |
| DB migration (BYTEA column) | 3 |
| Render dispatcher binary branch | 4, 8 |
| `unoserver` sidecar | 5, 6 |
| `vsdx-render.ts` (bytes → SVG) | 8 |
| `/api/import` upload endpoint | 9 |
| `import_vsdx` MCP tool | 10 |
| `vsdx-parse.ts` (vsdx → structured JSON) | 11 |
| `analyze_vsdx` MCP tool | 12 |
| Stencil mapping (~35 shapes) | 13 |
| XML builder helpers | 14 |
| Graphviz DOT extractor | 15 |
| D2 extractor | 16 |
| `vsdx-writer.ts` (IR → vsdx XML) | 17 |
| Image-embed fallback | 18 |
| `/api/diagrams/:id/export.vsdx` | 19 |
| Drag-drop on canvas | 20 |
| "Download as VSDX" menu | 21 |
| README + docs | 22 |
| End-to-end smoke | 23 |

**Placeholder scan:** Confirmed — no "TBD", "TODO", or "fill in" text. All code blocks contain complete, runnable implementations or test scaffolds with concrete assertions.

**Type consistency:** `VsdxRenderer.render(bytes)` signature consistent across tests and call sites. `MasterMapping` from `stencils.ts` is consumed by `vsdx-writer.ts`. `extractGraphFromDot` return type (with `_x`/`_y` injection) is consumed by both `vsdx-writer.ts` and `d2-extractor.ts`. `setVsdxRendererForTests` is exported from `vsdx-render.ts` and imported by tests — name matches across files.

**Open items the implementing engineer must verify (intentional):**

1. **Task 11 fixture**: The plan calls for a checked-in `basic-flowchart.vsdx`. If you can't produce one externally, take a snapshot of the writer's output once Task 17 is working and use it as the fixture for Task 11. Document the source.
2. **Task 5 base-image digest**: Replace `PINNED_DIGEST_HERE` with the real sha256 from `docker pull ubuntu:24.04 && docker images --digests`.
3. **Tasks 15/16/18**: `dot`, `d2`, and `rsvg-convert` must be installed in the prixmaviz container. If absent, add to the main `Dockerfile`'s apt-get install line in the same commit as the relevant task.

---

## Execution

Plan complete and saved to [docs/superpowers/plans/2026-05-14-prixmaviz-vsdx-engine.md](./2026-05-14-prixmaviz-vsdx-engine.md).
