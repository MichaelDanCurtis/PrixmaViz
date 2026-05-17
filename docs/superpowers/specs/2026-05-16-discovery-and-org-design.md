# PrixmaViz — Discovery & Org (Issue #7) — Design

**Date:** 2026-05-16
**Issue:** [#7](https://github.com/MichaelDanCurtis/PrixmaViz/issues/7)
**Scope:** 5 features — FTS endpoint + folders + interactive tag filter + pinned/recent + metadata UI. Companion to Issue #5 (which shipped the FTS migration + `search_diagrams` MCP tool).

---

## Purpose

The Library is a flat list with substring-only filtering. Once a workspace passes ~30 diagrams it becomes hostile to navigate. This epic turns the Library into something you can actually navigate:

- **Find** anything via Postgres full-text search across DSL + annotations.
- **Organize** into folders with drag-and-drop.
- **Filter** by clicking any tag chip.
- **Surface** recents and pinned items above the noise.
- **Edit** the metadata (description / author / notes) that already lives in `meta` JSONB but has no UI.

---

## Scope

### In scope — 5 features

| ID | Feature | Server | Web |
|---|---|---|---|
| F1 | FTS search endpoint | New `GET /api/diagrams/search` | Wires Library input to it (≥2 chars) |
| F2 | Folders | `parent_path` column + folder routes | Tree view + drag-drop + folder actions |
| F3 | Interactive tag filter | Tag autocomplete query | Click-to-filter chips + filter chips row + tag editor |
| F4 | Pinned + Recents | `pinned` + `last_opened_at` columns + pin route | 3-section Library layout + star icon |
| F5 | Metadata UI | PATCH route on `meta` + extend `DiagramMeta` type | Item-detail modal |

### Out of scope

- Semantic / LLM-driven search — out per issue.
- Sort dropdown / scroll cues — already shipped by Issue #4.
- Tag-based access control — Issue #8 covers sharing/permissions.
- Materialized tag-autocomplete view — follow-up if performance bites at scale.

---

## Architecture

### DB migrations (2)

**`0007_diagram_folders.sql`**

```sql
ALTER TABLE diagrams
  ADD COLUMN IF NOT EXISTS parent_path TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_diagrams_parent_path
  ON diagrams(workspace_id, parent_path);
```

Empty string = workspace root. Slash-delimited Unix-style paths (`"mercury/wire-format"`). No leading or trailing slash. Empty folders live in `workspaces.settings.emptyFolders: string[]` (the `settings` JSONB column already exists; no new migration needed).

**`0008_diagram_pinned_recents.sql`**

```sql
ALTER TABLE diagrams
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_diagrams_recent
  ON diagrams(workspace_id, last_opened_at DESC NULLS LAST)
  WHERE last_opened_at IS NOT NULL;
```

Partial index — only non-null rows are interesting for "recent."

### Shared types

Extend `DiagramMeta` in [packages/shared/src/ir.ts](packages/shared/src/ir.ts) (all optional, additive, no migration needed since `meta` is JSONB):

```ts
export interface DiagramMeta {
  createdAt: string;
  updatedAt: string;
  tags: string[];
  sourcePaths: string[];
  description?: string;
  author?: string;
  notes?: string; // markdown body
}
```

Add a new `LibraryEntry` field-set to surface the new columns to the client:

```ts
export interface LibraryEntry {
  // existing fields...
  parentPath: string;
  pinned: boolean;
  lastOpenedAt: string | null;
}
```

### New HTTP routes

All workspace-scoped via the existing `authenticate` middleware.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/diagrams/search?q&engines&tags&parent_path&since&sort&limit` | Calls the same impl as the `search_diagrams` MCP tool — one query path, two transports |
| `POST` | `/api/diagrams/:id/pin` | Toggle `pinned`. Body `{ pinned: boolean }` |
| `PATCH` | `/api/diagrams/:id/meta` | Update `meta.description / .author / .notes`. Returns updated meta |
| `PATCH` | `/api/diagrams/:id/move` | `{ parentPath: string }` updates `parent_path` |
| `POST` | `/api/folders/empty` | `{ path: string, action: 'add' \| 'remove' }` mutates `workspaces.settings.emptyFolders` |
| `POST` | `/api/folders/rename` | `{ from: string, to: string }` cascade-renames |
| `POST` | `/api/folders/delete` | `{ path: string, cascade: boolean }` — cascade deletes nested diagrams + empty-folder entries; otherwise fails if any diagram exists under the path |
| `GET` | `/api/diagrams/tags` | Distinct tag list for autocomplete |

**`/api/diagrams/search`** wraps the `search_diagrams` MCP impl exported from `packages/server/src/mcp/tools/search.ts`. Route translates query params → tool input shape, calls the impl, returns its response. No SQL duplication.

**Folder rename SQL — use `starts_with()`, not `LIKE`:**

```sql
-- WRONG: user folder name "foo%bar" would silently match siblings
UPDATE diagrams
   SET parent_path = REPLACE(parent_path, $old, $new)
 WHERE workspace_id = $ws
   AND parent_path LIKE $old || '/%';

-- RIGHT: starts_with() does not interpret wildcards
UPDATE diagrams
   SET parent_path = $new || SUBSTRING(parent_path FROM LENGTH($old) + 1)
 WHERE workspace_id = $ws
   AND (parent_path = $old OR starts_with(parent_path, $old || '/'));
```

PG 11+ ships `starts_with`. If the project supports older PG, fall back to `LEFT(parent_path, LENGTH($old || '/')) = $old || '/'`.

**`last_opened_at` write semantics:** every `loadBySlug` and `createTile` updates the column. NOT on read-only refreshes (Library mount, WS reconnect). The bump is wrapped in `IF last_opened_at IS NULL OR now() - last_opened_at > interval '1 second'` to avoid hot-loop writes if a client triggers multiple loads in rapid succession.

### New MCP tools (3)

Symmetric with the new HTTP routes — each tool is a thin wrapper:

- **`update_diagram_meta`** — `{ diagramId, description?, author?, notes? }` → `{ ok, meta }`.
- **`move_diagram`** — `{ diagramId, parentPath }` → `{ ok }`.
- **`pin_diagram`** — `{ diagramId, pinned }` → `{ ok, pinned }`. Symmetric with the toggle on the UI.

Registered in [packages/server/src/mcp/tools.ts](packages/server/src/mcp/tools.ts) as a new group at `packages/server/src/mcp/tools/library.ts`.

### Library refactor (split the big file)

Current [packages/web/src/components/Library.tsx](packages/web/src/components/Library.tsx) is ~500 lines and growing. Split:

```
packages/web/src/components/Library/
├── Library.tsx           # outer shell, search input, sort dropdown, sections
├── Tree.tsx              # recursive folder tree view (F2)
├── Card.tsx              # single diagram entry (extracted from current Library)
├── FilterChips.tsx       # active tag-filter chips row (F3)
├── DetailModal.tsx       # item-detail modal (F5)
├── FolderActions.tsx     # New folder / Rename / Delete menu (F2)
└── TagEditor.tsx         # tag chip editor with autocomplete (F3 + F5)
```

The bare file at `packages/web/src/components/Library.tsx` re-exports `Library` from the folder for back-compat with existing imports.

### Store extensions (`packages/web/src/store/index.ts`)

```ts
// F3
activeTagFilters: Set<string>;
addTagFilter: (tag: string) => void;
removeTagFilter: (tag: string) => void;
clearTagFilters: () => void;

// F2
selectedFolderPath: string;          // "" = root; selecting a folder scopes the All section
setSelectedFolderPath: (p: string) => void;
expandedFolderPaths: Set<string>;    // tree open/close state, persisted to localStorage
toggleFolderExpanded: (p: string) => void;

// F1
serverSearchResults: SearchResult[] | null;  // null = no active server search
setServerSearchResults: (r: SearchResult[] | null) => void;

// F3
tagAutocompleteCache: string[];      // in-memory cache, refreshed via WS event
setTagAutocomplete: (tags: string[]) => void;

// F5
detailModalDiagramId: string | null;
openDetailModal: (id: string) => void;
closeDetailModal: () => void;
```

### Library layout

The Library renders **3 sections** in this order, only when populated:

```
┌─ Search [....................] [Sort ▾]    ┐
├─ Active filters: [mercury ×] [auth ×]      ┤  (F3 — FilterChips)
├─ Folder tree                               ┤  (F2 — Tree)
│    📁 mercury
│       📁 wire-format
│           • packet anatomy
│           • bytefield-v2
│    📁 auth-flows
│       • oauth dance
│    • ungrouped-diagram-1
├─ Pinned ★                                  ┤
│    • critical-thing                        │
├─ Recent                                    ┤  (last 10 opened)
│    • last-thing-i-touched                  │
└─ All                                       ┘
     • (everything else, filtered by folder/tags/search, sorted)
```

**Section sort behavior:**

- **Pinned** — honors the sort dropdown.
- **Recent** — ALWAYS sorts by `last_opened_at DESC`. Ignores the user's sort selection. (Recent's whole purpose is "what did I last touch?" — overriding with name-sort makes it useless.)
- **All** — honors the sort dropdown.

The tree is a sibling to the sections (not a section itself); selecting a folder in the tree filters Pinned/Recent/All to that folder's contents.

### Drag-drop (folders)

Native HTML5 DnD — no new dep.

- Each `Card` sets `dataTransfer.setData("application/x-prixmaviz-diagram", slug)` on `onDragStart`.
- Each folder row in `Tree` handles `onDragOver` (preventDefault + `dropEffect = "move"`) and `onDrop` (parse the slug, call `PATCH /api/diagrams/:id/move`).
- **Known limitation:** native HTML5 DnD does NOT auto-scroll the container during a drag. Library list is in a scrollable sidebar; if the user drags toward the bottom edge while a target folder is off-screen, they must release and try again. Mitigation: a small `onDragOver` handler at the Library's top/bottom edges that scrolls the list when the pointer is within 24px of an edge. Acceptable scope tradeoff.
- Reject drops onto a folder that is a descendant of the dragged item (no infinite loop).

### FTS Library wiring

`Library/Library.tsx` reads `search` state. When `search.length >= 2`:

- Debounce 200ms.
- Call `GET /api/diagrams/search?q=<search>&parent_path=<selectedFolderPath>&tags=<activeTagFilters>`.
- While in-flight, show "Searching…" placeholder in the All section to avoid flicker.
- On response, set `serverSearchResults`. The Library renders results in the All section (replacing the local-filtered list).
- When `search.length < 2`, clear `serverSearchResults` and fall back to the existing client-side filter.

### WS events

Server emits these new payloads via the existing hub:

- `{ type: "library:diagram-updated", diagramId, change: "pinned" | "moved" | "meta" }`
- `{ type: "library:diagram-opened", diagramId, lastOpenedAt }`
- `{ type: "library:folders-changed", emptyFolders: string[] }`
- `{ type: "library:tags-changed" }` — triggers tag-autocomplete cache refresh

All web clients (in any tab) refresh their local Library state on these events.

---

## Tool specifications

### F5: Item-detail modal

Triggered by a `⋯` button on each Library card.

**Fields:**

- **Name** — text input, editable. Save → PATCH name (existing path).
- **Description** — single-line text. Renders as the card's `title` hover tooltip when set.
- **Author** — text input. Renders as small byline on card (e.g., "by alice").
- **Notes** — multi-line textarea. In view mode: markdown-rendered. In edit mode: raw textarea. Toggle button switches.
- **Tags** — chip editor with autocomplete from `serverSearchResults` or `/api/diagrams/tags`.
- **Folder** — read-only display of current `parent_path` + "Move to…" picker.
- **Pinned** — star toggle.

**Save behavior:**

- Each field commits on blur OR via an explicit Save button. Maintainer's call — go with **on-blur** for fast iteration; Cmd/Ctrl+Enter on notes textarea triggers blur explicitly.
- PATCH endpoints called per field, not a single batched save. Smaller blast radius if one field fails.

### F3: Tag chip interaction

- Hover a `.tag` chip on any card → cursor changes to pointer; tooltip "Filter by `<tag>`".
- Click → adds tag to `activeTagFilters` set.
- Active filter chip appears in the `FilterChips` row at the top.
- X on the filter chip → removes from set.
- Multi-tag = AND.
- "Clear all" button when 2+ filters active.
- Tag editor (in modal) has a `+` button that opens an autocomplete combobox sourced from `tagAutocompleteCache`.

### F2: New folder UX

- "New folder" button in `FolderActions.tsx` opens a small inline input.
- User types `mercury/v2` and presses Enter.
- Client POSTs to `/api/folders/empty` with `{ path: "mercury/v2", action: "add" }`.
- Server validates: no leading/trailing slash, no double slashes, no path traversal (`..`).
- Adds to `workspaces.settings.emptyFolders`. Returns updated list. WS broadcast.
- First drag-drop into the new folder removes the path from `emptyFolders` (since the folder now has real children).

### F4: Pinned star icon

- Each card has a small ☆ in the top-right corner.
- Click → toggles `pinned`. Optimistic UI update + POST `/api/diagrams/:id/pin`.
- Pinned cards float to the **Pinned** section at the top.
- Pinned section is sticky during scroll (CSS `position: sticky` on its header — like the Pinned header in `Sublime Merge`).

---

## Cross-cutting

- All new tools register input schemas with the dispatcher's validator (PR #26).
- Path validation: `parent_path` must match `/^[a-z0-9](?:[a-z0-9-_/]*[a-z0-9])?$/i` (lower-kebab-case segments, no leading/trailing slashes, no double slashes, no `..`). Single regex, applied server-side.
- WS events thread through the existing hub — no new transport.
- Shim updates: `update_diagram_meta`, `move_diagram`, `pin_diagram` descriptors added to [packages/shim/src/tools.ts](packages/shim/src/tools.ts). Version bumps:
  - `packages/shim/package.json` → `0.8.0`
  - `plugin/.claude-plugin/plugin.json` → `0.8.0`
  - `plugin/.claude-plugin/marketplace.json` → `0.8.0`
  - `SHIM_VERSION` constant in `packages/shim/src/index.ts` → `0.8.0`
  - Plugin doc count: 28 → 31 tools.

### Tag autocomplete performance

- Client-side: `tagAutocompleteCache: string[]` in zustand. Populated on Library mount via `GET /api/diagrams/tags`. Refreshed on WS `library:tags-changed` event.
- Server-side query: `SELECT DISTINCT jsonb_array_elements_text(meta->'tags') FROM diagrams WHERE workspace_id = $1`. GIN index on `meta->'tags'` (already created in 0004) makes this fast up to ~10k diagrams.
- If/when it bites: introduce a materialized view of tags per workspace, refresh on insert/update via trigger. Follow-up — not in this epic.

---

## Swarm sequencing

Two waves total. Wave 1 is sequential (foundation → routes); Wave 2 parallelizes the web work; Wave 3 ships the shim.

### Wave 1A — Foundation (solo, must finish first)

- Migrations `0007_diagram_folders.sql`, `0008_diagram_pinned_recents.sql`.
- Extend `DiagramMeta` type in `packages/shared/src/ir.ts`.
- Extend `LibraryEntry` with `parentPath`, `pinned`, `lastOpenedAt`.
- DB helpers: `dbSetPinned`, `dbBumpLastOpenedAt`, `dbMoveDiagram`, `dbRenameFolder`, `dbDeleteFolder`, `dbListTags`, `dbUpdateMeta`.
- Update `dbListDiagrams` to project the 3 new fields.
- Tests for each helper.

### Wave 1B — HTTP routes + MCP tools (after 1A merges)

- New HTTP routes per the table above.
- New MCP tools: `update_diagram_meta`, `move_diagram`, `pin_diagram`.
- WS event payload types and dispatch.
- Tests for each route + tool.

### Wave 2 — Web work (parallel, 3 agents after 1B merges)

- **Agent C — Library refactor + Tree + DnD.** Split [Library.tsx](packages/web/src/components/Library.tsx) into the folder structure. Implement `Tree.tsx`, `FolderActions.tsx`. Drag-drop wiring. Edge-scroll helper.
- **Agent D — Sections layout + pinned + recents.** Implement the 3-section view, star icon, `last_opened_at` wiring on `loadBySlug` + `createTile`. Recent always sorts by `last_opened_at DESC`.
- **Agent E — Interactive tags + filter chips + detail modal (F3 + F5).** `FilterChips.tsx`, `TagEditor.tsx`, `DetailModal.tsx`. Tag autocomplete cache.

These three Wave 2 agents will conflict on the new `Library/` folder structure and on `store/index.ts`. Standard rebase-resolve pattern from Issues #5 and prior swarms.

### Wave 3 — Shim v0.8.0 (after Wave 2 merges)

- Add the 3 new tool descriptors.
- Version bumps everywhere.
- Plugin doc 28 → 31 tools.

---

## Tests

### Server (~30-35 new)

- Migration apply tests for 0007 + 0008.
- HTTP route tests: search params shape, pin toggle, meta PATCH, move, folder rename cascade (3-level depth), folder delete cascade vs no-cascade, empty-folder add/remove round-trip, tag list distinct.
- MCP tool tests: `update_diagram_meta` happy/missing/forbidden, `move_diagram` happy + path validation, `pin_diagram` toggle.
- DB helper tests: `starts_with`-based folder rename, `last_opened_at` write semantics (no-op when bumped within 1s window).

### Web (~30-40 new)

- Tree rendering with nested paths.
- Drag-drop state machine (drag start, hover over folder, drop, cancel).
- Tag-filter AND semantics (2 filters → only diagrams with both).
- Pinned sticky during scroll.
- Recent section ignores sort dropdown.
- Detail modal: open / edit / save per field / cancel.
- FTS wiring: <2 char uses client filter, ≥2 char debounces + hits HTTP.
- Auto-scroll during edge-of-list drag.

---

## Risks and known limitations

1. **Native HTML5 DnD has no auto-scroll.** Mitigated by an edge-scroll helper at the top and bottom 24px of the list.
2. **Folder rename of a deep tree is one transaction.** Locking implications if many diagrams. Mitigation: cap depth + node count, return an error if rename would touch > 500 rows. (Follow-up: row-batched async rename for very large workspaces.)
3. **`last_opened_at` write contention.** The 1-second debounce + partial index limits write amplification. If many users on the same workspace open the same diagram in parallel, last writer wins — acceptable, since `last_opened_at` is "approximately recent" not "exact."
4. **Empty-folder cleanup race.** If creating a diagram in an empty folder fails between the diagram INSERT and the emptyFolders REMOVE, the folder persists in both lists. Mitigation: do both in one transaction. If the post-cleanup WS broadcast fails, the next mount-time refresh self-heals.
5. **Tag-autocomplete cache staleness.** If a WS event is missed, the client's tag list could be stale by one diagram. Re-fetch on Library re-mount and on focus return.
6. **Sort dropdown vs Recent section.** Documented in the design: Recent always sorts by `last_opened_at`. Surface this in the UI with a small "(by recency)" label next to the Recent section header so users don't think the sort is broken.

---

## Open follow-ups (not in this epic)

- Materialized view for tag autocomplete (perf).
- Server-side batched folder rename for very large workspaces.
- Bulk move (select N diagrams → move to folder) — pairs with Issue #2's multi-select but extends it.
- Tag colors / icons.
- Search-results-only mode (hide non-matching folders during search).
