# PrixmaViz — Missing MCP Tools (Issue #5) — Design

**Date:** 2026-05-15
**Issue:** [#5](https://github.com/MichaelDanCurtis/PrixmaViz/issues/5)
**Scope:** 13 new MCP tools across 6 groups (A–F). All shipped in one epic.

---

## Purpose

Today's MCP surface (15 tools) covers create / render / read flows but is missing complete CRUD, real discoverability, write paths on annotations, canvas-state introspection, workspace lifecycle, and bulk operations. This epic closes those gaps so agents can:

- Delete and duplicate diagrams without polluting workspaces
- Search by content / tags / engine instead of substring-on-name
- Validate DSL without burning render cycles
- Write annotations (add / update / resolve) — not just read them
- Enumerate, focus, and snapshot the canvas
- Create and list workspaces from MCP
- Bulk-import N diagrams in one call

---

## Scope

**In scope — 13 new MCP tools:**

| Group | Tools |
|---|---|
| A (CRUD) | `delete_diagram`, `duplicate_diagram` + extending `load_diagram` to accept `diagramId` |
| B (Discoverability) | `search_diagrams`, `validate_dsl` |
| C (Annotation writes) | `add_annotation`, `update_annotation`, `resolve_annotation` |
| D (Canvas state) | `list_tiles`, `focus_tile`, `take_canvas_snapshot` |
| E (Workspace) | `create_workspace`, `list_workspaces` |
| F (Bulk) | `import_diagrams` |

**Out of scope:**

- Anything LLM-mediated (natural-language → DSL, semantic search, summarisation)
- A3 `get_diagram` as a standalone tool — folded into `load_diagram` (adds optional `diagramId` to its existing schema)
- Snapshot font scoping (D3 ships an MVP; font scoping is a follow-up)
- pg_trgm fuzzy search (B1 ships standard FTS; trigram is a follow-up)
- Cross-workspace permissions / sharing (Issue #8)

---

## Architecture

### Tool registry split

Current `packages/server/src/mcp/tools.ts` is a single 800-line file. Split into a registry that imports tool defs from per-group modules:

```
packages/server/src/mcp/
├── tools.ts                 # registry only: TOOLS = [...crudTools, ...searchTools, ...]
├── dispatch.ts              # existing dispatcher + validator (PR #26)
└── tools/
    ├── crud.ts              # delete_diagram, duplicate_diagram + load_diagram patch
    ├── search.ts            # search_diagrams, validate_dsl
    ├── annotations.ts       # add_annotation, update_annotation, resolve_annotation
    ├── canvas.ts            # list_tiles, focus_tile, take_canvas_snapshot
    ├── workspaces.ts        # create_workspace, list_workspaces
    └── bulk.ts              # import_diagrams
```

Each module exports `{ toolDefs, impls }`. `tools.ts` concatenates `toolDefs` into the `TOOLS` array and registers impls into the dispatcher's tool map.

### Shared helpers

- **`packages/server/src/mcp/broadcast.ts`** — `broadcastWorkspaceUpdate(ctx, workspaceId)` reads the current workspace state and emits a single canonical `{ type: "workspace", camera, tiles }` event. Replaces ad-hoc `ctx.hub.broadcast(...)` callsites.
- **`packages/server/src/canvas/snapshot-svg.ts`** — `composeWorkspaceSvg({ tiles, padding, background })` returns a composed SVG string + computed bbox. Used by D3 today; also a building block for future workspace-export flows.
- **`packages/server/src/kroki/parse-errors.ts`** — `parseEngineError(engine, krokiResponseText)` returns `Array<{ line?, column?, message }>`. Used by B2 today; also slot-in upgrade for the inline editor's render-error UI from #6.

### DB migrations

#### `0004_diagrams_fts.sql`

```sql
-- Generated tsvector column over name + dsl. Annotation bodies are
-- joined at search time (see search_diagrams impl) since they live in
-- a separate table and are mutable independently of diagrams.
ALTER TABLE diagrams
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(dsl, '')), 'B')
  ) STORED;

CREATE INDEX diagrams_search_tsv_idx ON diagrams USING GIN (search_tsv);

-- Tag containment index — meta is JSONB, tags live at meta->'tags'.
CREATE INDEX diagrams_meta_tags_idx ON diagrams USING GIN ((meta -> 'tags'));
```

#### `0005_workspace_owner.sql`

```sql
ALTER TABLE workspaces ADD COLUMN owner_token_hash TEXT NULL;
CREATE INDEX workspaces_owner_token_hash_idx ON workspaces (owner_token_hash);
```

`owner_token_hash = sha256(workspaceId)`. Existing rows stay NULL (anonymous, MCP-callable but not listed by E2). First MCP call from a token that owns workspace X claims it for that token. Listing returns workspaces where `owner_token_hash = sha256(callerToken)`.

#### `0006_annotation_resolution.sql`

```sql
ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resolution TEXT NULL;
```

Idempotent in case `resolved_at` already exists from earlier work.

---

## Tool specifications

### Group A — CRUD

#### A1. `delete_diagram`

**Input:**
```json
{
  "slug?":     "string",
  "diagramId?":"string",
  "cascade?":  "boolean (default true)"
}
```
Exactly one of `slug` / `diagramId` required (enforced by the dispatch validator).

**Output:**
```json
{
  "ok": true,
  "deletedId": "string",
  "deletedTileIds": ["string"],
  "deletedAnnotationIds": ["string"]
}
```

**Behavior:**

1. Resolve target via `dbGetDiagramBySlug` (slug) or `dbGetDiagram` (id). 404-style error if missing.
2. If `cascade: true` (default): in a single transaction —
   - Collect annotation IDs where `diagram_id = target.id`, delete them.
   - Collect tile IDs in `ws.tiles` referencing the diagram, remove from `tiles` JSON.
   - Delete the diagram row.
3. If `cascade: false` and orphans exist: return `{ ok: false, error: "diagram has N tiles, M annotations" }`.
4. Call `broadcastWorkspaceUpdate(ctx, workspaceId)` so live clients refresh.

**Acceptance:**

- Deleting a diagram with 2 tiles + 3 annotations removes all 6 rows atomically.
- Subsequent `list_diagrams` excludes it.
- Connected WS clients receive a workspace update event.

#### A2. `duplicate_diagram`

**Input:**
```json
{
  "sourceSlug?":     "string",
  "sourceDiagramId?":"string",
  "newName":         "string",
  "tags?":           ["string"],
  "preserveAnnotations?": "boolean (default false)"
}
```

**Output:** `{ diagramId, slug, name, engine, kind, render: RenderResult }`

**Behavior:**

1. Load source via `dbGetDiagram` / `dbGetDiagramBySlug`.
2. Generate target slug via the existing `slugify(newName)`; on collision use `createDiagramWithUniqueSlug`.
3. `dbCreateDiagram` cloning `engine`, `kind`, `ir`, `dsl`, with `meta.tags = [...source.tags, ...input.tags]` deduped.
4. Re-render via `renderDiagram` — clone gets its own SVG (engine versions may have drifted).
5. If `preserveAnnotations: true`: copy annotation rows with new `id` (uuid()) and the new `diagram_id`.
6. Broadcast.

**Acceptance:**

- Clone of a graph diagram has identical IR/DSL but distinct ID + slug.
- Modifying the clone via `apply_patch` doesn't affect the source.
- `preserveAnnotations: false` produces zero annotation rows on the clone.

#### A3 (folded): extend `load_diagram` schema

`load_diagram`'s existing `{ slug }` input becomes `{ slug? | diagramId? }`. Validator enforces oneOf. Routes to `dbGetDiagramBySlug` vs `dbGetDiagram`. New optional `includeSvg: boolean (default false)` omits the cached SVG from the response when false to keep MCP transcripts lean.

---

### Group B — Discoverability

#### B1. `search_diagrams`

**Input:**
```json
{
  "query?":         "string",
  "engines?":       ["string"],
  "tags?":          ["string"],
  "updatedSince?":  "string (ISO datetime)",
  "sort?":          "'updated' | 'created' | 'name' | 'relevance' (default 'relevance')",
  "limit?":         "integer (default 20, max 100)"
}
```

**Output:**
```json
{
  "results": [
    {
      "slug": "string",
      "name": "string",
      "engine": "string",
      "tags": ["string"],
      "updatedAt": "string",
      "createdAt": "string",
      "snippet?": "string",
      "score?": "number"
    }
  ]
}
```

**Behavior:**

Build SQL dynamically:

- If `query`: `WHERE search_tsv @@ websearch_to_tsquery('english', $query)`. Annotation bodies joined via subquery: `OR EXISTS (SELECT 1 FROM annotations a WHERE a.diagram_id = d.id AND to_tsvector('english', a.body) @@ websearch_to_tsquery('english', $query))`.
- If `tags`: `WHERE meta->'tags' @> $tags::jsonb` (AND across all tags).
- If `engines`: `WHERE engine = ANY($engines)`.
- If `updatedSince`: `WHERE updated_at >= $ts`.
- Sort: `relevance` → `ORDER BY ts_rank(search_tsv, query) DESC`; others map to obvious `ORDER BY`.
- `snippet`: `ts_headline('english', dsl, query, 'MaxFragments=1, MaxWords=12, MinWords=4')` when `query` provided.

**Acceptance:**

- `query: "enableEntities"` against a workspace with one DSL containing that word returns it ranked first.
- `tags: ["mercury", "auth"]` returns only diagrams with both tags.
- Empty `query` + filters returns the filtered list (no relevance scoring).

#### B2. `validate_dsl`

**Input:** `{ engine: ALL_ENGINES, source: string }`

**Output:** `{ ok: boolean, errors?: [{ line?, column?, message }], warnings?: [...] }`

**Behavior:**

1. Call `krokiClient.render(engine, source)` discarding the SVG.
2. On Kroki 200 → `{ ok: true }`.
3. On Kroki 400/422 → `parseEngineError(engine, response.body)` → structured errors.
4. Per-engine parsers in `kroki/parse-errors.ts`:
   - **mermaid**: regex `/line (\d+):(\d+)?(.+)/` style messages
   - **graphviz**: regex `/syntax error in line (\d+)/i` + extract message tail
   - **plantuml**: `Error line (\d+)`
   - **d2**: parses its `\\d+:\\d+: ` prefix
   - Unknown engines fall back to `{ message: rawBody }`.

**Acceptance:**

- Valid mermaid → `{ ok: true }`.
- Mermaid syntax error at line 5 → `{ ok: false, errors: [{ line: 5, message: "..." }] }`.
- No SVG cached or sent.

---

### Group C — Annotation writes

All three reuse `packages/server/src/db/annotations.ts` primitives and broadcast over WS so the web client picks up live.

#### C1. `add_annotation`

**Input:**
```json
{
  "diagramId":      "string",
  "body":           "string (markdown)",
  "author?":        "string (default 'agent')",
  "targetNodes?":   ["string"],
  "bboxData?":      { "x": "number", "y": "number", "w": "number", "h": "number" }
}
```

Validator rule: `targetNodes` and `bboxData` are mutually exclusive (both undefined = diagram-wide annotation).

**Output:** `{ annotationId, createdAt }`

**Acceptance:**

- New annotation appears in next `get_annotations` call.
- WS broadcast delivers it to connected web clients.
- Supplying both `targetNodes` + `bboxData` returns a validation error.

#### C2. `update_annotation`

**Input:** `{ annotationId: string, body: string, force?: boolean (default false) }`

**Output:** `{ ok: true, updatedAt }`

**Behavior:** PATCH the annotation row. If `resolved_at IS NOT NULL` and `force !== true` → return `{ ok: false, code: "annotation_resolved", message: "annotation is resolved; pass force: true to update" }`.

**Acceptance:**

- Updated body returned by next `get_annotations`.
- Update on resolved annotation without `force` returns structured error.
- With `force: true` succeeds.
- Update on non-existent ID returns 404-style error.

#### C3. `resolve_annotation`

**Input:** `{ annotationId: string, resolution?: string }`

**Output:** `{ ok: true, resolvedAt }`

**Behavior:** `UPDATE annotations SET resolved_at = now(), resolution = $1 WHERE id = $2`. Idempotent — resolving an already-resolved annotation just updates `resolution` text.

**Acceptance:**

- Resolved annotations excluded from `get_annotations` unless `includeResolved: true`.
- `resolvedAt` set.
- Optional `resolution` text readable via `get_annotations(includeResolved: true)`.

---

### Group D — Canvas state

#### D1. `list_tiles`

**Input:** `{}` (workspace scoped via auth)

**Output:**
```json
{
  "tiles": [
    {
      "id": "string",
      "diagramId": "string",
      "diagramSlug": "string",
      "x": "number", "y": "number", "w": "number", "h": "number",
      "z": "number",
      "focused?": "boolean"
    }
  ]
}
```

**Behavior:** `dbGetWorkspace(sql, workspaceId).tiles` pass-through. `focused: true` for the tile matching `get_focused_tile`'s logic. `z` is the tile's stacking order (currently each tile carries a `z` field; if not, derive from array index).

**Acceptance:**

- All tiles returned with geometry.
- Exactly 0 or 1 tile has `focused: true`.
- Empty workspace returns `{ tiles: [] }`.

#### D2. `focus_tile`

**Input:** `{ tileId?: string, diagramSlug?: string, pan?: boolean (default false) }`

**Output:** `{ ok: true, tileId, newZ, panTo?: { x, y } }`

**Behavior:**

1. Resolve tile by `tileId` (direct lookup) or `diagramSlug` (first matching tile).
2. `z = max(allTiles.z) + 1`. Persist via `dbUpdateWorkspaceTiles`.
3. If `pan: true`: compute world coordinate of the tile center → return `panTo: { x: tile.x + tile.w/2, y: tile.y + tile.h/2 }`. Server doesn't know viewport dims, so doesn't return zoom; client computes its own viewport center.
4. Broadcast workspace update.

**Acceptance:**

- Target tile's `z` is the new max.
- Web clients raise the tile.
- `pan: true` returns the tile-center world coords; web client centers on them.

#### D3. `take_canvas_snapshot` (MVP)

**Input:**
```json
{
  "format?":             "'svg' | 'png' | 'jpeg' (default 'svg')",
  "includeAnnotations?": "boolean (default false)",
  "padding?":            "number (default 40)",
  "background?":         "string (CSS color or 'transparent', default 'transparent')"
}
```

**Output:** `{ format, mimeType, base64, width, height, tileCount }`

**Behavior:** Implemented in `canvas/snapshot-svg.ts::composeWorkspaceSvg`:

1. Enumerate all tiles. For each, look up the diagram's cached SVG; if missing, call `renderDiagram` to populate the cache. (Cache-first; render-on-miss.)
2. Compute bbox: `min(x..w)`, `max(x+w..)`, etc., padded.
3. Emit outer `<svg viewBox="...">` with optional `<rect>` background.
4. For each tile: `<g transform="translate(x y)"><svg width=w height=h viewBox=tileViewBox>...tile contents...</svg></g>`.
5. ID collision avoidance: prefix every `id` attribute in nested tile SVGs with `t${tileIndex}_` via a one-pass regex on the tile SVG content. **Out of scope for MVP**: font scoping; will rely on browser fallback fonts for now.
6. If `format !== "svg"`: hand the composed SVG to the existing Kroki binary export path (`exportDiagramBinary` from PR #20's plumbing).
7. `includeAnnotations`: defer to follow-up; MVP ignores this flag with a warning in the response payload.

**Acceptance:**

- 3-tile canvas produces a composed SVG that visually matches the layout (modulo annotations).
- `tileCount` matches `list_tiles().length`.
- PNG/JPEG output renders correctly via existing binary-export pipeline.

---

### Group E — Workspace

**Token-as-owner model:**

- `owner_token_hash` column added by migration `0005`. Stores `sha256(workspaceId)` of the workspace token used in the auth header.
- On any MCP call where `owner_token_hash IS NULL` for the called workspace, set it to `sha256(callerToken)` (claim-on-first-call). This handles existing pre-migration workspaces gracefully.
- `list_workspaces` returns rows where `owner_token_hash = sha256(callerToken)`.

#### E1. `create_workspace`

**Input:** `{ name?: string (default 'Untitled workspace') }`

**Output:** `{ workspaceId, name, createdAt }`

**Behavior:**

1. `dbCreateWorkspace(sql, name)` — existing helper.
2. Set `owner_token_hash = sha256(callerToken)` on the new row.
3. Return the new workspace.

**Acceptance:**

- New workspace queryable by ID.
- Subsequent diagrams against that workspaceId are isolated.
- Token used to create is the only one that sees it in E2.

#### E2. `list_workspaces`

**Input:** `{}`

**Output:** `{ workspaces: [{ id, name, diagramCount, createdAt, updatedAt }] }`

**Behavior:** `SELECT ... FROM workspaces WHERE owner_token_hash = sha256($1)` + `LEFT JOIN diagrams` count.

**Acceptance:**

- Returns one entry per workspace the caller owns (claim-on-first-call covers existing anonymous workspaces the caller has interacted with).
- `diagramCount` matches `list_diagrams.length` for that workspace.

---

### Group F — Bulk

#### F1. `import_diagrams`

**Input:**
```json
{
  "items": [
    {
      "name": "string",
      "engine": "ALL_ENGINES",
      "kind?": "'graph' | 'passthrough' (inferred from engine if missing)",
      "source?": "string (DSL for passthrough kinds)",
      "tags?": ["string"]
    }
  ],
  "stopOnError?": "boolean (default false)"
}
```

**Output:**
```json
{
  "created": [{ "slug", "diagramId", "render": "RenderResult" }],
  "failed":  [{ "name", "error" }]
}
```

**Behavior:**

1. For each item, call the existing `createDiagramImpl` logic.
2. On error:
   - `stopOnError: true` → abort, return `created: [...up to error]`, `failed: [erroring item]`, do NOT roll back. Maintainer's call confirmed: per-item semantics, no transaction across the whole batch.
   - `stopOnError: false` (default) → continue, push to `failed[]`.
3. Slug-collision within the batch handled by `createDiagramWithUniqueSlug`.
4. After loop, emit **one** `broadcastWorkspaceUpdate(ctx, workspaceId)`.

**Acceptance:**

- 10-item batch with one bad item + `stopOnError: false` → 9 created, 1 failed.
- `stopOnError: true` halts on first error.
- Exactly one WS broadcast emitted regardless of batch size.

---

## Cross-cutting

### Validator integration (PR #26)

All 13 new tools register their JSON schemas with the dispatcher's validator. Free error envelope: `{ ok: false, error: { code, message, parameter?, expected?, tool, correlationId? } }` per the contract documented in PR #26's body.

`oneOf` and `mutually exclusive` constraints (A1, A2, A3-folded, C1) need validator extensions — the validator from PR #26 handles `required` + types + enums + unknown keys; it does not yet handle `oneOf` or "exactly one of N". Add:

- `oneOf: [string]` on the tool def → validator picks first present from the list and errors if zero or multiple are present.
- `mutuallyExclusive: [[string, string], ...]` → validator errors if both members of any pair are present.

### Broadcast pattern

Every tool that mutates workspace state (A1, A2, C1, C2, C3, D2, F1, indirectly E1) emits `broadcastWorkspaceUpdate(ctx, workspaceId)` after persistence. Encapsulates the current ad-hoc `ctx.hub.broadcast(workspaceId, { type: "workspace", ... })` calls into one helper that reads the canonical workspace state and emits the canonical payload.

### Shim updates

`packages/shim/src/tools.ts` gets 13 new tool descriptors. Bumps:
- `packages/shim/package.json` → `0.7.0`
- `plugin/.claude-plugin/plugin.json` → `0.7.0`
- `plugin/.claude-plugin/marketplace.json` → `0.7.0`
- Shim version sentinel in `packages/shim/src/index.ts` → `0.7.0`

### Testing

Each tool gets:
- Unit test in `packages/server/test/mcp/tools/<group>.test.ts` covering happy path + validator-rejection + edge cases listed under each tool's acceptance criteria.
- Search migration tested in `packages/server/test/db/diagrams-fts.test.ts`.
- Bulk + transactional semantics tested in `packages/server/test/mcp/tools/bulk.test.ts`.

Target: ~50 new tests. Existing ~210 server tests must remain green.

---

## Sequencing for swarm execution

The swarm can run these in parallel waves (matches the issue's wave recommendation):

**Wave 1 — parallel:**
- Agent 1: Migrations (`0004`, `0005`, `0006`) + helpers (`broadcast.ts`, `parse-errors.ts`, `snapshot-svg.ts`) + dispatcher validator extensions (`oneOf`, `mutuallyExclusive`)
- Agent 2: Group A (delete, duplicate, load_diagram extension)
- Agent 3: Group C (annotation writes — uses existing annotation DB layer; no migration dependency for the resolve_annotation `resolution` text since 0006 ships in Wave 1)

**Wave 2 — depends on Wave 1 helpers + migrations:**
- Agent 4: Group B (search, validate — depends on `parse-errors.ts` and FTS migration)
- Agent 5: Group D (list/focus/snapshot — depends on `snapshot-svg.ts` and `broadcast.ts`)
- Agent 6: Group E + F (workspaces + bulk — depend on `owner_token_hash` migration and `broadcast.ts`)

After Wave 2 merges, Agent 7 bumps shim + plugin versions and adds the 13 tool descriptors.

---

## Out of scope / followups

- **D3 font scoping** — defer until users hit font issues. Note in the snapshot tool's response if any tile uses a custom font.
- **D3 `includeAnnotations`** — the spec accepts the flag and ignores it with a warning. Full annotation overlay rendering is a follow-up.
- **pg_trgm fuzzy search** — add if FTS results feel too literal.
- **Stricter F1 transactionality** — current spec is per-item. If users complain about partial-failure cleanup, add an `atomic: true` mode that wraps the batch in BEGIN/COMMIT and rolls back on first error.
- **B2 Path 2** — bundled engine parsers. Add if validate becomes a hot path or if Kroki latency becomes a problem.
- **Cross-workspace permissions** — covered by Issue #8 (sharing & embedding).

---

## Open risks

1. **FTS performance on large workspaces.** GIN index on a tsvector + JSONB tags should hold up to ~10k diagrams/workspace. If a single workspace ever has 100k+ diagrams, partitioning becomes necessary — note for future.
2. **`owner_token_hash` claim-on-first-call race.** Two concurrent MCP calls from the same token on the same anonymous workspace could both attempt to claim. Use `UPDATE workspaces SET owner_token_hash = $1 WHERE id = $2 AND owner_token_hash IS NULL` (single-statement, idempotent — if it already claimed, the second update affects zero rows and that's fine).
3. **D3 snapshot SVG composition correctness.** Per-tile ID prefixing via regex is fragile if Kroki ever returns SVG with IDs in unexpected attributes. Mitigation: ship behind a flag, monitor for visual bugs, document the known limitation.
4. **Slug-collision during F1 import_diagrams across concurrent batches.** Two batches importing the same name simultaneously could both pick `name-2`. Mitigation: `createDiagramWithUniqueSlug` retries on unique-violation; bounded retry count.
