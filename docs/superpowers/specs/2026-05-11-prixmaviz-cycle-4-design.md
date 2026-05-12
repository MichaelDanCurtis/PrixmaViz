# PrixmaViz Cycle 4 — Service-First Architecture

**Date:** 2026-05-11
**Status:** Design approved; pending implementation plan
**Predecessor:** [Cycle 3 — Claude Code Plugin](2026-05-08-prixmaviz-cycle-3-design.md)
**Canonical hosted URL:** `https://prixmaviz.alexis.com`

## Goal

PrixmaViz transitions from a **local-only Claude Code plugin** to a **hosted service** delivered as a Docker stack. The hosted instance you run at `prixmaviz.alexis.com` becomes the canonical entry point. The Cycle 3 local-binary mode is retired. The workspace UI doubles as a marketing surface, surfacing other Alexis products as users return repeatedly.

## Where this fits

Cycle 4 is the **strategic pivot** identified during Cycle 3 manual smoke testing: most of Cycle 3's complexity (local binary distribution, plugin install cache sync, Tauri lifecycle, settings file management) disappears when the renderer is a hosted service. Subsequent host-port cycles (Codex, VS Code) become trivial after Cycle 4.

| Cycle | Theme |
|---|---|
| 3 (shipped) | Claude Code plugin — local binary, Tauri optional, Kroki via Docker |
| **4 (this)** | **Service-first — Docker stack, multi-tenant, Cycle 3 local mode retired** |
| 5 | Codex plugin (becomes a small shim port — server-side untouched) |
| 6 | VS Code plugin (same pattern) |
| 7 | Free vs paid tier, account upgrade path (email/OAuth), basic collaboration |
| 8 | Embed-code generator UI, dedicated embed-mode chrome |
| later | Enterprise SSO, audit log, paid Kroki-included tier, etc. |

## Design decisions (the brainstorm resolution)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Multi-tenant single deploy.** One container hosts many workspaces. | Max marketing-surface leverage; one ops surface |
| 2 | **Anonymous workspace UUID** as the auth token. | Zero-friction entry; matches the AI-loop use case where the shim needs a token to send |
| 3 | **docker-compose with separate containers** (prixmaviz + postgres + kroki + 4 sidecars). | Independent scaling, swappable Kroki, mature ops story |
| 4 | **Postgres** with bundled service by default + `DATABASE_URL` escape hatch for production. | Industry standard, mature backup tooling, you already run it |
| 5 | **Standalone Bun-compiled binary** MCP shim (same build pipeline as Cycle 3). | Zero deps on user machine, proven pipeline, ~300 lines of HTTP forwarding |
| 6 | **Footer + occasional cross-promo** for the marketing surface. | Present but non-intrusive; canvas remains the value |
| 7 | **Deprecate Cycle 3 local-binary mode entirely.** | No users yet, no migration debt; one code path going forward |
| 8 | **Read-only public URL only** (no embed-code UI in v1). | Lay groundwork; build embed UI when there's demand |

## Architecture

### Docker compose stack

```
                ┌─────────────────────────────────────────────────────┐
                │              prixmaviz.alexis.com                   │
                │                                                     │
   browser ─────┤  ┌─────────────┐                                   │
   (workspace)  │  │  prixmaviz  │ ← Bun: HTTP API + WS + webview    │
                │  │   :5180     │   single externally exposed port  │
                │  └─────┬───────┘                                   │
                │        │                                            │
                │        ├── postgres ←── DATABASE_URL or bundled    │
                │        │                                            │
                │        └── kroki ────┬── kroki-mermaid             │
                │           (orch)    ├── kroki-plantuml             │
                │                     ├── kroki-bpmn                 │
                │                     └── kroki-excalidraw            │
   CC + shim ───┘                                                    │
   (HTTPS API)                                                       │
                └─────────────────────────────────────────────────────┘
```

### Services in `docker-compose.yaml`

| Service | Image | Purpose | Externally exposed |
|---|---|---|---|
| `prixmaviz` | `prixmaviz/prixmaviz:<tag>` (we build) | HTTP API + WS + webview | yes |
| `postgres` | `postgres:16-alpine` | Persistence | no (internal) |
| `kroki` | `yuzutech/kroki:latest` | Render orchestrator | no |
| `kroki-mermaid` | `yuzutech/kroki-mermaid:latest` | Mermaid sidecar | no |
| `kroki-plantuml` | `yuzutech/kroki-plantuml:latest` | PlantUML / sequence / class | no |
| `kroki-bpmn` | `yuzutech/kroki-bpmn:latest` | BPMN | no |
| `kroki-excalidraw` | `yuzutech/kroki-excalidraw:latest` | Excalidraw | no |

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | bundled postgres | Override to use your production Postgres |
| `KROKI_URL` | `http://kroki:8000` | Override to use external Kroki |
| `PRIXMAVIZ_PUBLIC_URL` | `https://prixmaviz.alexis.com` | Canonical URL used in API responses |
| `PRIXMAVIZ_BIND_HOST` | `0.0.0.0` | Listen address inside container |
| `PRIXMAVIZ_BIND_PORT` | `5180` | Listen port inside container |

### Compose profiles

- **Default**: starts everything including bundled Postgres. One-machine deploy / dev.
- **`--profile production`**: skips bundled `postgres`. Expects `DATABASE_URL` to point at external Postgres.

### Volumes

- `postgres-data` — persists Postgres data across `docker compose down`
- No filesystem volume for diagrams — all data lives in Postgres (no more `.pviz` files on disk)

## Data model

Three tables. Workspace UUID doubles as the bearer token; no separate auth/sessions table in v1.

### `workspaces`

```sql
CREATE TABLE workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  camera        JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  tiles         JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `diagrams`

```sql
CREATE TABLE diagrams (
  id            TEXT PRIMARY KEY,                 -- d_<ulid12>
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  engine        TEXT NOT NULL,
  kind          TEXT NOT NULL,                    -- graph | passthrough
  ir            JSONB,
  dsl           TEXT,
  svg           TEXT,                             -- cached rendered output
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_view   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX idx_diagrams_workspace ON diagrams(workspace_id);
CREATE INDEX idx_diagrams_public ON diagrams(id) WHERE public_view = true;
```

SVG is cached in the row; re-render only when DSL/IR changes. With Postgres TOAST compression, a 60KB Mermaid SVG occupies ~15KB on disk.

### `annotations`

```sql
CREATE TABLE annotations (
  id              TEXT PRIMARY KEY,                  -- ann_<ulid26>
  diagram_id      TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,                     -- tag | region | pin
  text            TEXT,
  color           TEXT,
  resolved_at     TIMESTAMPTZ,
  target_nodes    JSONB,
  bbox_pixel      JSONB,
  bbox_data       JSONB,
  point           JSONB,
  nearest_node    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_annotations_diagram ON annotations(diagram_id);
CREATE INDEX idx_annotations_unresolved ON annotations(diagram_id) WHERE resolved_at IS NULL;
```

Schema mirrors Cycle 1+2's `Annotation` type on the wire; just persisted in Postgres now.

### Migrations

- `0001_init.sql` — the three tables above
- Live in `packages/server/migrations/`; run on container startup
- Future cycles add new migration files; never edit shipped ones

### Explicitly NOT in the schema (yet)

- `users`, `sessions` (anonymous-only in v1)
- billing
- audit log
- soft-delete (cascade is fine; restore-from-backup is the recovery model)

## API surface

### Auth model

Every `/api/*` route requires `Authorization: Bearer <workspace-uuid>`. The server resolves the workspace from the token; all operations are scoped to that workspace. Cross-workspace access returns 404 (not 403 — don't leak existence).

`/p/*` routes (public diagram view) need no auth and serve only `public_view = true` diagrams.

### Endpoints

**Workspace state:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workspaces` | Create new (no auth required; returns `{ id }`) |
| GET | `/api/workspace` | Camera + tiles + recent diagrams |
| PUT | `/api/workspace/camera` | Update camera |

**Tiles:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/tiles` | Open a diagram as a tile |
| PATCH | `/api/tiles/:id` | Move/resize |
| DELETE | `/api/tiles/:id` | Close |

**Diagrams:**

| Method | Path | MCP tool | Purpose |
|---|---|---|---|
| POST | `/api/diagrams` | `create_diagram` | New diagram |
| GET | `/api/diagrams` | `list_diagrams` | Library |
| GET | `/api/diagrams/:id` | `load_diagram` | Fetch |
| POST | `/api/diagrams/:id/patch` | `apply_patch` | IR ops |
| POST | `/api/render-dsl` | `render_dsl` | One-shot DSL render |
| POST | `/api/diagrams/:id/visibility` | (UI) | Toggle `public_view` |
| DELETE | `/api/diagrams/:id` | (UI) | Permanent delete |

**Annotations:**

| Method | Path | MCP tool | Purpose |
|---|---|---|---|
| POST | `/api/annotations` | (UI) | Create |
| PATCH | `/api/annotations/:id` | (UI) | Update |
| DELETE | `/api/annotations/:id` | (UI) | Remove |
| GET | `/api/diagrams/:id/annotations` | `get_annotations` | List |

**Workspace helpers (MCP-side):**

| Method | Path | MCP tool | Purpose |
|---|---|---|---|
| GET | `/api/workspace/focused-tile` | `get_focused_tile` | Deictic resolution |
| GET | `/api/workspace/url` | `get_view_url` | Canonical user URL |

**Public view:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/p/:diagramId` | Read-only HTML page |
| GET | `/p/:diagramId.svg` | Raw SVG (iframe + image-embed friendly) |

### MCP tools (11 total — 14 in Cycle 3 minus 3 deprecated)

**Stays the same (11):** `create_diagram`, `apply_patch`, `save_diagram`, `load_diagram`, `list_diagrams`, `render_dsl`, `get_annotations`, `update_tile`, `set_view`, `get_focused_tile`, `get_view_url`.

**Removed (3):** `install_mcp_plugin`, `check_app_running`, `launch_app` — Tauri-coupled, irrelevant in service-first model.

Skill content (the markdown files) needs **zero changes** since the kept tools have identical names and arguments.

### Real-time updates

WebSocket on `/ws?token=<workspace-uuid>` (query param because most browsers can't set Authorization on `new WebSocket()`).

Server pushes:
- `diagram:rendered` / `diagram:patched`
- `annotation:created` / `:updated` / `:deleted`
- `workspace:tiles` / `workspace:camera`

Multi-device "just works" via WS: open the same workspace URL in two tabs, render in one, see it appear in the other.

## MCP shim binary

Thin HTTP forwarder, Bun-compiled, distributed via the existing CC plugin payload. ~300 lines of code, ~60 MB compiled (Bun runtime baggage).

### Configuration via `.mcp.json`

```json
{
  "mcpServers": {
    "prixmaviz": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/prixmaviz-mcp",
      "args": [],
      "env": {
        "PRIXMAVIZ_REMOTE_URL": "https://prixmaviz.alexis.com",
        "PRIXMAVIZ_WORKSPACE": "${PRIXMAVIZ_WORKSPACE:-}"
      }
    }
  }
}
```

### First-launch workspace bootstrap

When `PRIXMAVIZ_WORKSPACE` is empty:
1. Check `~/.config/prixmaviz/workspace.txt` — if present, use it.
2. Otherwise `POST $REMOTE_URL/api/workspaces` (no auth required) → server returns `{ id }`, shim writes to `~/.config/prixmaviz/workspace.txt`, uses it.
3. Print to stderr: `prixmaviz: workspace ${uuid} — view at ${REMOTE_URL}/w/${uuid}`.

### Tool dispatch

Each tool's `run` function forwards to `POST $REMOTE_URL/api/mcp/<tool>` with `Authorization: Bearer <uuid>`. Server-side has one route per tool wrapping the existing implementation.

### Error handling

Network errors and 5xx responses propagate as MCP errors with a clear message. CC users see "prixmaviz: cannot reach https://prixmaviz.alexis.com — check connectivity or PRIXMAVIZ_REMOTE_URL." No retry loops in shim; CC's MCP client handles reconnect.

### Cross-platform builds

`prixmaviz-mcp-{darwin,linux,windows}-{arm64,x64}` via `bun build --compile`. Plugin payload's `bin/` directory contains the binary for the host platform (selected at install time).

## Workspace UI + marketing surface

The Cycle 3 webview UX (infinite canvas, tiles, annotation tools, settings panel) stays. **New in Cycle 4:**

### Footer (always visible, non-intrusive)

~32px bar at the bottom of the workspace view:

- Left: "PrixmaViz — an Alexis product" linking to `https://alexis.com`
- Center: 2-3 inline product chips (rotatable via env var)
- Right: the canonical workspace URL (encourages bookmarking)

Built with the same dark aesthetic as the Topbar.

### First-session welcome panel

Shown ONCE when a fresh workspace is created. Dismissible via cookie. Explains: workspace URL, bookmark it, anyone-with-URL access model.

### Empty-state cross-promo cards

When the workspace has zero diagrams, the panel shows 1-3 cross-promo cards alongside the "Ask an AI to create a diagram" prompt. Disappears as soon as the library has diagrams.

### "Make public" toggle per diagram

In the tile header (next to export), a small lock icon → popover offering Public/Private radio. If public, popover shows the `/p/<diagram-id>` URL with copy-to-clipboard. No fancy embed-code generator (v1 of the embed story per Q8).

### Settings panel additions

Cycle 3's settings panel (Kroki URL) extends with:
- Workspace name (editable)
- Workspace UUID (read-only, copyable)
- Delete workspace (danger action — drops the workspace + all diagrams via `ON DELETE CASCADE`)

> **Note:** "Rotate workspace token" was discussed but deferred to a future cycle. Updating the workspace UUID would require cascading changes across all FK references in `diagrams` and `annotations`, and the threat model (anonymous URL leak) is low-likelihood for v1. If you accidentally leak a workspace URL, the path is "delete the workspace and start a new one" until rotate-token lands.

## Wave structure

Roughly the shape of Cycle 3, ~25-30 tasks across 5 waves.

### Wave 1 — Server-side multi-tenant refactor (~7 tasks)

The biggest shift: rewire everything to be workspace-keyed instead of project-root-keyed.

- Add Postgres migration runner + `0001_init.sql`
- Replace `paths.diagramsDir`-based persistence with Postgres CRUD
- Add `Authorization: Bearer <uuid>` middleware
- Rewrite `WorkspaceStore`, `DiagramStore`, `AnnotationStore` against Postgres
- Refactor existing 11 tools-that-stay to use workspace context
- Add `POST /api/workspaces` (anonymous create) + `GET /api/workspaces/me`
- Server-side tests covering workspace isolation

### Wave 2 — Docker compose stack (~5 tasks)

- `Dockerfile` (multi-stage Bun build, ~150 MB final image)
- `docker-compose.yaml` with 6 services + healthchecks + volumes
- Compose profiles (`default` boots bundled Postgres; `production` skips it)
- `.env.example` documenting all configurable knobs
- One-machine smoke: `docker compose up` → `/api/health` returns 200

### Wave 3 — MCP shim rewrite (~5 tasks)

- Strip current binary to ~300-line HTTP forwarder
- First-launch workspace bootstrap (POST /api/workspaces, cache UUID locally)
- 11 hardcoded tool defs; each forwards to `/api/mcp/<tool>`
- Update plugin payload's `.mcp.json`
- Cross-platform compile of `prixmaviz-mcp-{darwin,linux,windows}-{arm64,x64}`

### Wave 4 — Marketing-surface UI (~6 tasks)

- Footer component (brand link, cross-promo chips, URL)
- First-session welcome panel (one-time, dismissible)
- Empty-state cross-promo cards
- "Make public" tile-header toggle + popover with copyable public URL
- `/p/:diagramId` and `/p/:diagramId.svg` public-view routes
- Settings panel additions (workspace name, rotate token, delete workspace)

### Wave 5 — Deprecation + acceptance (~4 tasks)

- Remove Cycle 3's local-binary code paths (Kroki client local mode, `.pviz` writers, project-root concept)
- Remove deprecated MCP tools (`install_mcp_plugin`, `check_app_running`, `launch_app`)
- Update README with Cycle 4 install + self-host instructions
- Final acceptance: deploy to `prixmaviz.alexis.com`, install plugin in fresh CC session, full loop works

## Acceptance criteria

End-to-end demo on a fresh machine:

1. `git clone` + `docker compose up` (`.env` pointing at `prixmaviz.alexis.com`) → stack starts cleanly
2. Open browser to `https://prixmaviz.alexis.com` → redirected to a new workspace at `/w/<uuid>` with welcome panel
3. From a separate CC session: `claude plugins install prixmaviz@prixmaviz-alexis` → plugin installs, MCP shim bootstraps its own workspace
4. Ask AI: *"Draw the OAuth 2.1 PKCE flow"* → AI calls `render_dsl`, plantuml renders via the Kroki stack, returns
5. AI's response includes the workspace URL → user clicks → sees the diagram in the canvas
6. Toggle diagram to public → copy `/p/<id>` URL → open in incognito → diagram loads, no auth
7. Footer shows Alexis cross-promo links throughout
8. **Negative test:** swap `Authorization` bearer to a different workspace's UUID → server returns 404, not the other workspace's data

If 1–8 pass, Cycle 4 ships.

## Out of scope (deferred to future cycles)

| Item | Target cycle |
|---|---|
| Codex plugin (port of the shim) | 5 |
| VS Code plugin (port of the shim) | 6 |
| Email/OAuth auth, account-upgrade for anonymous workspaces | 7 |
| Free vs paid tier, rate limits, billing | 7 |
| Embed-code generator UI, embed-mode chrome | 8 |
| Multi-workspace switcher (one browser, multiple workspaces) | 8 |
| Telemetry/analytics dashboards (data collected; no UI) | later |
| Enterprise SSO / SAML / audit log | later |
| Migration tool from Cycle 3 `.pviz` files | not planned (no users to migrate) |
| Mermaid-in-browser for offline / privacy default | merged into "browser-side rendering" — likely later |

## Open questions for Wave 1 research

These don't block design approval but should be resolved before Wave 1 implementation:

- **Postgres migration runner.** Recommend raw SQL files + a small custom Bun runner (~40 lines). Avoids `drizzle-kit` / `node-pg-migrate` dependency bloat. Decide in Wave 1 Task 1.
- **TLS termination.** Likely at your existing reverse proxy in front of the container, not at the `prixmaviz` container itself. Decide based on your infra topology.
- **WebSocket auth.** Query-param `?token=<uuid>` vs subprotocol header. Query param is most compatible but the token shows up in server logs. Subprotocol cleaner. Decide in Wave 1 Task 6 (WS handler refactor).
- **CSP for `/p/:diagramId`.** Set `frame-ancestors *` for max iframe embeddability vs restrict to known origins. Decide in Wave 4 alongside the public route implementation.
- **Workspace cleanup policy.** Stale workspaces (last_seen_at older than N months) — auto-prune or keep forever? Probably "keep forever for v1" and revisit when storage matters.

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Postgres migrations break on upgrade | low | All migrations idempotent; test on snapshot before deploy |
| MCP shim version drift (server adds tools shim doesn't know) | medium | `tools/list` is forwarded from server; shim hardcodes only what it sends. Server-added tools surface automatically. Document the contract |
| URL secrecy compromise (someone leaks a workspace UUID) | medium | "Rotate token" feature in settings (Wave 4); document anonymous-trust model in welcome panel |
| Public diagram abuse (illegal content) | low (small scale) | DMCA-style reporting handled out-of-band; consider rate-limiting `public_view=true` in a future cycle |
| Cross-workspace data leak via bug | high impact, low likelihood | Workspace isolation tests in Wave 1; pen-test before public launch |
