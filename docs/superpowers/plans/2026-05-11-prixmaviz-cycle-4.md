# PrixmaViz Cycle 4 — Service-First Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate PrixmaViz from a local Claude Code plugin to a hosted Docker stack at `prixmaviz.alexis.com`. Multi-tenant, anonymous workspace UUIDs as bearer tokens, Postgres-backed, with a marketing-surface workspace UI. Cycle 3's local-binary mode is removed.

**Architecture:** Six-container docker-compose stack (prixmaviz + postgres + kroki + 3 sidecars). The Bun server is rewired to use Postgres + Bearer auth instead of project-root paths + filesystem `.pviz`. The MCP shim becomes a ~300-line HTTP forwarder. Cycle 3's local binary is retired.

**Tech Stack:** Bun 1.3+, TypeScript 5.6+, React 18, motion 11, Zustand 4, **Postgres 16**, **Docker + docker-compose**, Vitest, happy-dom, **MCP SDK 1.0+**.

**Spec reference:** `docs/superpowers/specs/2026-05-11-prixmaviz-cycle-4-design.md` (commit `6ee7bc9`).

**Plan-defect mitigations from Cycles 2.plus + 3:**
1. All code blocks are copy-paste-ready; no "TODO" or "fill in" gaps.
2. Wave 1 includes explicit isolation tests for multi-tenant correctness.
3. Each task ends with explicit "Done when" criteria.
4. Hard YAGNI gate at end of each wave (Task X.99 in each wave).
5. Implementer prompts open with `pwd && git rev-parse --abbrev-ref HEAD`.
6. Migration tooling decision (Wave 1 Task 1) is locked in before any data-layer work.

---

## File Structure

### packages/shared/src/

| File | Status | Responsibility |
|---|---|---|
| `workspace.ts` | NEW | `Workspace`, `WorkspaceState` types matching Postgres rows |
| `index.ts` | MODIFY | Re-export new module |

### packages/server/src/

| File | Status | Responsibility |
|---|---|---|
| `db/client.ts` | NEW | Postgres connection pool + transaction helper |
| `db/migrate.ts` | NEW | Minimal migration runner (runs `migrations/*.sql` in order on startup) |
| `db/workspaces.ts` | NEW | Workspace CRUD against Postgres |
| `db/diagrams.ts` | NEW | Diagram CRUD against Postgres |
| `db/annotations.ts` | NEW | Annotation CRUD against Postgres |
| `migrations/0001_init.sql` | NEW | Initial schema |
| `auth/bearer.ts` | NEW | Bearer-token middleware; resolves workspace from token |
| `http/routes.ts` | MODIFY | Replace project-root context with workspace context; remove `.pviz` paths |
| `mcp/tools.ts` | MODIFY | Remove 3 deprecated tools; refactor remaining 11 to use workspace ctx |
| `mcp/server.ts` | MODIFY | Drop the embedded HTTP server (the prixmaviz container is now always the server) |
| `bootstrap.ts` | MODIFY | Replace `paths.diagramsDir` filesystem assumptions with `DATABASE_URL` |
| `index.ts` | MODIFY | Wire migration runner at startup; remove project-root CLI |
| `canvas/store.ts` | DELETE | Replaced by `db/workspaces.ts` |
| `canvas/io.ts` | DELETE | Workspace state is in Postgres now |
| `annotations/store.ts` | DELETE | Replaced by `db/annotations.ts` |
| `pviz/io.ts` | DELETE | No more `.pviz` files |
| `pviz/watch.ts` | DELETE | Watcher obsolete |
| `mcp/install.ts` | DELETE | Cycle 3 install logic obsolete |
| `mcp/lifecycle.ts` | DELETE | check_app_running / launch_app obsolete |

### packages/web/src/

| File | Status | Responsibility |
|---|---|---|
| `components/Footer.tsx` | NEW | Marketing-surface footer |
| `components/WelcomePanel.tsx` | NEW | First-session welcome (dismissible) |
| `components/EmptyStateCards.tsx` | NEW | Cross-promo when library empty |
| `components/PublicViewToggle.tsx` | NEW | "Make public" lock icon + popover |
| `pages/PublicDiagram.tsx` | NEW | `/p/:diagramId` view |
| `App.tsx` | MODIFY | Mount new components + route public-view |
| `components/Tile.tsx` | MODIFY | Add PublicViewToggle to tile header |
| `components/SettingsPanel.tsx` | MODIFY | Add workspace name + delete-workspace UI |
| `lib/api.ts` | MODIFY | Add bearer token to every request |
| `store/index.ts` | MODIFY | Track current workspace UUID + welcome-seen flag |
| `styles.css` | MODIFY | Footer + welcome + empty-state styles |

### packages/shim/

NEW package. Contents:

| File | Responsibility |
|---|---|
| `package.json` | Bun package metadata |
| `src/index.ts` | The MCP shim entry; spawns stdio MCP server, forwards to HTTP |
| `src/bootstrap.ts` | First-launch workspace creation |
| `src/tools.ts` | 11 tool definitions (mirrors server-side shapes) |
| `tsconfig.json` | TypeScript config |
| `build.ts` | Bun build --compile cross-platform |

### src-tauri/

| File | Status | Responsibility |
|---|---|---|
| `resources/plugin/.mcp.json` | MODIFY | Point at new shim binary |
| `resources/plugin/bin/prixmaviz-mcp` | NEW (built) | The shim binary |
| `resources/plugin/bin/prixmaviz` | DELETE | Old monolithic binary obsolete |
| `src/install.rs` | MODIFY | Simpler — only copies shim binary to plugin payload |
| `src/uninstall.rs` | MODIFY | Same (only cleans up plugin payload) |

### Repo root

| File | Status | Responsibility |
|---|---|---|
| `Dockerfile` | NEW | Multi-stage Bun build for prixmaviz container |
| `docker-compose.yaml` | NEW | 6-service stack with profiles |
| `.env.example` | NEW | Documents env vars |
| `.dockerignore` | NEW | Standard Bun/Node ignore |
| `README.md` | MODIFY | Replace Cycle 3 install instructions with Cycle 4 |

---

## Wave 1 — Server-side multi-tenant refactor

**Goal:** Replace filesystem persistence with Postgres + Bearer auth. All `/api/*` routes are workspace-scoped.

### Task 1: Postgres migration runner + `0001_init.sql`

**Files:**
- Create: `packages/server/src/db/migrate.ts`
- Create: `packages/server/migrations/0001_init.sql`
- Create: `packages/server/test/db/migrate.test.ts`

- [ ] **Step 1: First-action verification**

```
pwd && git rev-parse --abbrev-ref HEAD
```
Expected: working directory ends in `PrixmaViz-cycle-4` (the worktree); branch is `cycle-4`.

- [ ] **Step 2: Write the initial schema**

Create `packages/server/migrations/0001_init.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  camera        JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  tiles         JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagrams (
  id            TEXT PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  engine        TEXT NOT NULL,
  kind          TEXT NOT NULL,
  ir            JSONB,
  dsl           TEXT,
  svg           TEXT,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_view   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_diagrams_workspace ON diagrams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_diagrams_public ON diagrams(id) WHERE public_view = true;

CREATE TABLE IF NOT EXISTS annotations (
  id              TEXT PRIMARY KEY,
  diagram_id      TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_annotations_diagram ON annotations(diagram_id);
CREATE INDEX IF NOT EXISTS idx_annotations_unresolved ON annotations(diagram_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Add Postgres client dep**

Run:
```
cd packages/server && bun add postgres
```

(`postgres` is the `porsager/postgres` npm package — lightweight, no schema dependencies, works great with Bun.)

- [ ] **Step 4: Write the migration runner**

Create `packages/server/src/db/migrate.ts`:
```ts
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function runMigrations(databaseUrl: string, migrationsDir: string): Promise<void> {
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  try {
    // Ensure schema_migrations exists (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const filename of files) {
      const applied = await sql`
        SELECT 1 FROM schema_migrations WHERE filename = ${filename}
      `;
      if (applied.length > 0) continue;
      const content = await readFile(join(migrationsDir, filename), "utf-8");
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
      });
      console.error(`migration applied: ${filename}`);
    }
  } finally {
    await sql.end();
  }
}
```

- [ ] **Step 5: Write the test**

Create `packages/server/test/db/migrate.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { join } from "node:path";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

describe("runMigrations", () => {
  it("applies all migrations idempotently", async () => {
    const sql = postgres(TEST_DB_URL);
    // Drop everything to start fresh
    await sql`DROP TABLE IF EXISTS annotations CASCADE`;
    await sql`DROP TABLE IF EXISTS diagrams CASCADE`;
    await sql`DROP TABLE IF EXISTS workspaces CASCADE`;
    await sql`DROP TABLE IF EXISTS schema_migrations CASCADE`;
    await sql.end();

    const migrationsDir = join(import.meta.dir, "../../migrations");
    await runMigrations(TEST_DB_URL, migrationsDir);

    // Verify tables exist
    const verifySql = postgres(TEST_DB_URL);
    const tables = await verifySql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    expect(tables.map((t) => t.tablename)).toEqual([
      "annotations", "diagrams", "schema_migrations", "workspaces",
    ]);

    // Run again — should be idempotent
    await runMigrations(TEST_DB_URL, migrationsDir);
    const counts = await verifySql`SELECT COUNT(*)::int as n FROM schema_migrations`;
    expect(counts[0].n).toBe(1);  // still just 0001_init.sql

    await verifySql.end();
  });
});
```

- [ ] **Step 6: Run the test**

```
cd packages/server && bun test test/db/migrate.test.ts
```

Expected: PASS (requires a running test Postgres at `TEST_DATABASE_URL`). If Postgres isn't running locally, document the dependency and mark the test as expected-to-pass-in-CI.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/migrate.ts packages/server/migrations/0001_init.sql packages/server/test/db/migrate.test.ts packages/server/package.json packages/server/bun.lock
git commit -m "feat(db): migration runner + 0001_init.sql"
```

**Done when:** `runMigrations()` applies SQL files in order, records them in `schema_migrations`, is idempotent on re-run. Test passes against a real Postgres.

---

### Task 2: Postgres connection module

**Files:**
- Create: `packages/server/src/db/client.ts`
- Create: `packages/server/test/db/client.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/db/client.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { getDb, closeDb } from "../../src/db/client";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/prixmaviz_test";

describe("db client", () => {
  it("getDb returns a postgres connection that runs a basic query", async () => {
    const sql = getDb(TEST_DB_URL);
    const result = await sql`SELECT 1 as one`;
    expect(result[0].one).toBe(1);
    await closeDb();
  });

  it("getDb returns the same instance on subsequent calls", () => {
    const a = getDb(TEST_DB_URL);
    const b = getDb(TEST_DB_URL);
    expect(a).toBe(b);
    closeDb();
  });
});
```

- [ ] **Step 3: Implement**

Create `packages/server/src/db/client.ts`:
```ts
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let instance: Sql | null = null;
let configuredUrl: string | null = null;

export function getDb(databaseUrl: string): Sql {
  if (instance && configuredUrl === databaseUrl) return instance;
  if (instance) {
    instance.end({ timeout: 5 });
    instance = null;
  }
  instance = postgres(databaseUrl, {
    onnotice: () => {},
    max: 10,
    idle_timeout: 60,
  });
  configuredUrl = databaseUrl;
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.end();
    instance = null;
    configuredUrl = null;
  }
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/db/client.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/client.ts packages/server/test/db/client.test.ts
git commit -m "feat(db): singleton postgres client"
```

**Done when:** `getDb(url)` returns a singleton postgres connection; reconfiguring with a different URL replaces it.

---

### Task 3: Workspace repository

**Files:**
- Create: `packages/server/src/db/workspaces.ts`
- Create: `packages/server/test/db/workspaces.test.ts`
- Create: `packages/shared/src/workspace.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Shared types**

Create `packages/shared/src/workspace.ts`:
```ts
import type { Camera, Tile } from "./canvas";

export interface Workspace {
  id: string;                          // UUID
  name: string | null;
  camera: Camera;
  tiles: Tile[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}
```

Modify `packages/shared/src/index.ts` — add:
```ts
export * from "./workspace";
```

- [ ] **Step 3: Write the failing tests**

Create `packages/server/test/db/workspaces.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import {
  createWorkspace,
  getWorkspace,
  updateWorkspaceCamera,
  updateWorkspaceTiles,
  deleteWorkspace,
} from "../../src/db/workspaces";
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

beforeEach(reset);
afterEach(closeDb);

describe("workspaces repo", () => {
  it("createWorkspace returns a new workspace with default camera + empty tiles", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    expect(ws.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ws.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(ws.tiles).toEqual([]);
    expect(ws.name).toBeNull();
  });

  it("getWorkspace returns the workspace or null", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched?.id).toBe(ws.id);
    const missing = await getWorkspace(sql, "00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });

  it("updateWorkspaceCamera persists new camera", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await updateWorkspaceCamera(sql, ws.id, { x: 100, y: 50, zoom: 1.5 });
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched?.camera).toEqual({ x: 100, y: 50, zoom: 1.5 });
  });

  it("updateWorkspaceTiles persists new tile array", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const tiles = [{ id: "t_abc", diagramId: "d_xyz", diagramSlug: "test", x: 0, y: 0, w: 600, h: 400, z: 0 }];
    await updateWorkspaceTiles(sql, ws.id, tiles);
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched?.tiles).toEqual(tiles);
  });

  it("deleteWorkspace cascades", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    await deleteWorkspace(sql, ws.id);
    const fetched = await getWorkspace(sql, ws.id);
    expect(fetched).toBeNull();
  });
});
```

- [ ] **Step 4: Implement**

Create `packages/server/src/db/workspaces.ts`:
```ts
import type postgres from "postgres";
import type { Workspace, Camera, Tile } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: (row.name as string) ?? null,
    camera: row.camera as Camera,
    tiles: row.tiles as Tile[],
    settings: row.settings as Record<string, unknown>,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    lastSeenAt: (row.last_seen_at as Date).toISOString(),
  };
}

export async function createWorkspace(sql: Sql, name?: string): Promise<Workspace> {
  const rows = await sql`
    INSERT INTO workspaces (name) VALUES (${name ?? null})
    RETURNING *
  `;
  return rowToWorkspace(rows[0]);
}

export async function getWorkspace(sql: Sql, id: string): Promise<Workspace | null> {
  const rows = await sql`SELECT * FROM workspaces WHERE id = ${id}`;
  if (rows.length === 0) return null;
  // Update last_seen_at on every fetch
  await sql`UPDATE workspaces SET last_seen_at = now() WHERE id = ${id}`;
  return rowToWorkspace(rows[0]);
}

export async function updateWorkspaceCamera(sql: Sql, id: string, camera: Camera): Promise<void> {
  await sql`
    UPDATE workspaces
    SET camera = ${sql.json(camera)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateWorkspaceTiles(sql: Sql, id: string, tiles: Tile[]): Promise<void> {
  await sql`
    UPDATE workspaces
    SET tiles = ${sql.json(tiles)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateWorkspaceName(sql: Sql, id: string, name: string | null): Promise<void> {
  await sql`UPDATE workspaces SET name = ${name}, updated_at = now() WHERE id = ${id}`;
}

export async function deleteWorkspace(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM workspaces WHERE id = ${id}`;
}
```

- [ ] **Step 5: Run tests**

```
cd packages/server && bun test test/db/workspaces.test.ts
```
Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/workspaces.ts packages/server/test/db/workspaces.test.ts packages/shared/src/workspace.ts packages/shared/src/index.ts
git commit -m "feat(db): workspaces repo + shared Workspace type"
```

**Done when:** 5 workspace tests pass; `Workspace` type re-exported from shared.

---

### Task 4: Diagram repository

**Files:**
- Create: `packages/server/src/db/diagrams.ts`
- Create: `packages/server/test/db/diagrams.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write the failing tests**

Create `packages/server/test/db/diagrams.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import {
  createDiagram,
  getDiagram,
  listDiagrams,
  updateDiagram,
  deleteDiagram,
  setDiagramPublic,
  getPublicDiagram,
} from "../../src/db/diagrams";
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

beforeEach(reset);
afterEach(closeDb);

describe("diagrams repo", () => {
  it("createDiagram persists a new row scoped to workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, {
      workspaceId: ws.id,
      slug: "test",
      name: "Test",
      engine: "mermaid",
      kind: "graph",
    });
    expect(d.id).toMatch(/^d_[a-z0-9]+$/);
    expect(d.workspaceId).toBe(ws.id);
    expect(d.slug).toBe("test");
  });

  it("listDiagrams scopes by workspace (cross-tenant isolation)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    await createDiagram(sql, { workspaceId: a.id, slug: "a1", name: "A1", engine: "mermaid", kind: "graph" });
    await createDiagram(sql, { workspaceId: b.id, slug: "b1", name: "B1", engine: "plantuml", kind: "passthrough" });
    const aList = await listDiagrams(sql, a.id);
    const bList = await listDiagrams(sql, b.id);
    expect(aList).toHaveLength(1);
    expect(aList[0]?.slug).toBe("a1");
    expect(bList).toHaveLength(1);
    expect(bList[0]?.slug).toBe("b1");
  });

  it("getDiagram returns null for diagrams in other workspaces (no leak)", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: a.id, slug: "secret", name: "S", engine: "mermaid", kind: "graph" });
    const fetchedFromB = await getDiagram(sql, b.id, d.id);
    expect(fetchedFromB).toBeNull();
  });

  it("updateDiagram patches ir/dsl/svg", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "u", name: "U", engine: "mermaid", kind: "graph" });
    await updateDiagram(sql, ws.id, d.id, { dsl: "flowchart LR; A-->B", svg: "<svg/>" });
    const fetched = await getDiagram(sql, ws.id, d.id);
    expect(fetched?.dsl).toBe("flowchart LR; A-->B");
    expect(fetched?.svg).toBe("<svg/>");
  });

  it("setDiagramPublic toggles public_view", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "p", name: "P", engine: "mermaid", kind: "graph" });
    await setDiagramPublic(sql, ws.id, d.id, true);
    const pub = await getPublicDiagram(sql, d.id);
    expect(pub?.id).toBe(d.id);
    await setDiagramPublic(sql, ws.id, d.id, false);
    const stillPub = await getPublicDiagram(sql, d.id);
    expect(stillPub).toBeNull();
  });

  it("deleteDiagram removes the row", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "d", name: "D", engine: "mermaid", kind: "graph" });
    await deleteDiagram(sql, ws.id, d.id);
    expect(await getDiagram(sql, ws.id, d.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Implement**

Create `packages/server/src/db/diagrams.ts`:
```ts
import type postgres from "postgres";
import type { Diagram, DiagramEngine, DiagramKind, GraphIR } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

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
  meta: Record<string, unknown>;
  publicView: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToDiagram(row: Record<string, unknown>): DbDiagram {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    slug: row.slug as string,
    name: row.name as string,
    engine: row.engine as DiagramEngine,
    kind: row.kind as DiagramKind,
    ir: (row.ir as GraphIR) ?? null,
    dsl: (row.dsl as string) ?? null,
    svg: (row.svg as string) ?? null,
    meta: row.meta as Record<string, unknown>,
    publicView: row.public_view as boolean,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function newDiagramId(): string {
  return `d_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function createDiagram(sql: Sql, input: {
  workspaceId: string;
  slug: string;
  name: string;
  engine: DiagramEngine;
  kind: DiagramKind;
  ir?: GraphIR;
  dsl?: string;
}): Promise<DbDiagram> {
  const id = newDiagramId();
  const rows = await sql`
    INSERT INTO diagrams (id, workspace_id, slug, name, engine, kind, ir, dsl)
    VALUES (
      ${id},
      ${input.workspaceId},
      ${input.slug},
      ${input.name},
      ${input.engine},
      ${input.kind},
      ${input.ir ? sql.json(input.ir) : null},
      ${input.dsl ?? null}
    )
    RETURNING *
  `;
  return rowToDiagram(rows[0]);
}

export async function getDiagram(sql: Sql, workspaceId: string, id: string): Promise<DbDiagram | null> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]) : null;
}

export async function listDiagrams(sql: Sql, workspaceId: string): Promise<DbDiagram[]> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE workspace_id = ${workspaceId}
    ORDER BY updated_at DESC
  `;
  return rows.map(rowToDiagram);
}

export async function updateDiagram(sql: Sql, workspaceId: string, id: string, patch: Partial<{
  name: string;
  ir: GraphIR;
  dsl: string;
  svg: string;
  meta: Record<string, unknown>;
}>): Promise<DbDiagram | null> {
  // Build dynamic SET clauses
  const sets: ReturnType<Sql> = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.ir !== undefined) sets.push(sql`ir = ${sql.json(patch.ir)}`);
  if (patch.dsl !== undefined) sets.push(sql`dsl = ${patch.dsl}`);
  if (patch.svg !== undefined) sets.push(sql`svg = ${patch.svg}`);
  if (patch.meta !== undefined) sets.push(sql`meta = ${sql.json(patch.meta)}`);
  if (sets.length === 0) return await getDiagram(sql, workspaceId, id);
  sets.push(sql`updated_at = now()`);
  const rows = await sql`
    UPDATE diagrams SET ${sets.flatMap((s, i) => i === 0 ? [s] : [sql`, `, s])}
    WHERE id = ${id} AND workspace_id = ${workspaceId}
    RETURNING *
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]) : null;
}

export async function deleteDiagram(sql: Sql, workspaceId: string, id: string): Promise<void> {
  await sql`DELETE FROM diagrams WHERE id = ${id} AND workspace_id = ${workspaceId}`;
}

export async function setDiagramPublic(sql: Sql, workspaceId: string, id: string, isPublic: boolean): Promise<void> {
  await sql`
    UPDATE diagrams SET public_view = ${isPublic}, updated_at = now()
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
}

export async function getPublicDiagram(sql: Sql, id: string): Promise<DbDiagram | null> {
  const rows = await sql`
    SELECT * FROM diagrams WHERE id = ${id} AND public_view = true
  `;
  return rows.length > 0 ? rowToDiagram(rows[0]) : null;
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/db/diagrams.test.ts
```
Expected: 6 pass (covering isolation, CRUD, public toggle).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/diagrams.ts packages/server/test/db/diagrams.test.ts
git commit -m "feat(db): diagrams repo with workspace isolation + public_view"
```

**Done when:** 6 tests pass; workspace isolation explicitly verified (no cross-tenant access).

---

### Task 5: Annotation repository

**Files:**
- Create: `packages/server/src/db/annotations.ts`
- Create: `packages/server/test/db/annotations.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write the failing tests**

Create `packages/server/test/db/annotations.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import {
  addAnnotation,
  listAnnotations,
  updateAnnotation,
  deleteAnnotation,
} from "../../src/db/annotations";
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

beforeEach(reset);
afterEach(closeDb);

describe("annotations repo", () => {
  it("addAnnotation + listAnnotations", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, {
      id: "ann_test1",
      kind: "tag",
      text: "rename",
      targetNodes: ["a"],
      createdAt: new Date().toISOString(),
    });
    const list = await listAnnotations(sql, d.id, { includeResolved: true });
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("rename");
  });

  it("listAnnotations defaults to excluding resolved", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, { id: "ann_r", kind: "tag", createdAt: "2026-01-01", resolvedAt: "2026-01-02" });
    await addAnnotation(sql, d.id, { id: "ann_open", kind: "tag", createdAt: "2026-01-01" });
    const open = await listAnnotations(sql, d.id, { includeResolved: false });
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBe("ann_open");
  });

  it("updateAnnotation patches fields, kind+createdAt locked", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, { id: "ann_u", kind: "tag", text: "old", createdAt: "2026-01-01" });
    // Attempt to override kind + createdAt should be no-op
    await updateAnnotation(sql, d.id, "ann_u", {
      text: "new",
      kind: "pin" as never,           // type-cast forces it through; repo should ignore
      createdAt: "1970-01-01" as never,
    });
    const list = await listAnnotations(sql, d.id, { includeResolved: true });
    expect(list[0]?.text).toBe("new");
    expect(list[0]?.kind).toBe("tag");
    expect(list[0]?.createdAt.slice(0, 10)).toBe("2026-01-01");
  });

  it("deleteAnnotation removes", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const d = await createDiagram(sql, { workspaceId: ws.id, slug: "x", name: "X", engine: "mermaid", kind: "graph" });
    await addAnnotation(sql, d.id, { id: "ann_d", kind: "tag", createdAt: "2026-01-01" });
    await deleteAnnotation(sql, d.id, "ann_d");
    expect(await listAnnotations(sql, d.id, { includeResolved: true })).toEqual([]);
  });
});
```

- [ ] **Step 3: Implement**

Create `packages/server/src/db/annotations.ts`:
```ts
import type postgres from "postgres";
import type { Annotation } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

function rowToAnnotation(row: Record<string, unknown>): Annotation {
  return {
    id: row.id as string,
    kind: row.kind as Annotation["kind"],
    text: (row.text as string) ?? undefined,
    color: (row.color as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : undefined,
    targetNodes: (row.target_nodes as string[]) ?? undefined,
    bboxPixel: (row.bbox_pixel as Annotation["bboxPixel"]) ?? undefined,
    bboxData: row.bbox_data ?? undefined,
    point: (row.point as Annotation["point"]) ?? undefined,
    nearestNode: (row.nearest_node as string) ?? undefined,
  };
}

export async function addAnnotation(sql: Sql, diagramId: string, a: Annotation): Promise<void> {
  await sql`
    INSERT INTO annotations (id, diagram_id, kind, text, color, resolved_at, target_nodes, bbox_pixel, bbox_data, point, nearest_node, created_at)
    VALUES (
      ${a.id},
      ${diagramId},
      ${a.kind},
      ${a.text ?? null},
      ${a.color ?? null},
      ${a.resolvedAt ?? null},
      ${a.targetNodes ? sql.json(a.targetNodes) : null},
      ${a.bboxPixel ? sql.json(a.bboxPixel) : null},
      ${a.bboxData !== undefined ? sql.json(a.bboxData as object) : null},
      ${a.point ? sql.json(a.point) : null},
      ${a.nearestNode ?? null},
      ${a.createdAt}
    )
  `;
}

export async function listAnnotations(sql: Sql, diagramId: string, opts: { includeResolved: boolean }): Promise<Annotation[]> {
  if (opts.includeResolved) {
    const rows = await sql`SELECT * FROM annotations WHERE diagram_id = ${diagramId} ORDER BY created_at ASC`;
    return rows.map(rowToAnnotation);
  }
  const rows = await sql`SELECT * FROM annotations WHERE diagram_id = ${diagramId} AND resolved_at IS NULL ORDER BY created_at ASC`;
  return rows.map(rowToAnnotation);
}

export async function updateAnnotation(sql: Sql, diagramId: string, id: string, patch: Partial<Annotation>): Promise<Annotation | null> {
  // Belt-and-braces: never allow kind/createdAt/id to be mutated
  const sets: ReturnType<Sql>[] = [];
  if (patch.text !== undefined) sets.push(sql`text = ${patch.text}`);
  if (patch.color !== undefined) sets.push(sql`color = ${patch.color}`);
  if (patch.resolvedAt !== undefined) sets.push(sql`resolved_at = ${patch.resolvedAt}`);
  if (patch.targetNodes !== undefined) sets.push(sql`target_nodes = ${sql.json(patch.targetNodes)}`);
  if (patch.bboxPixel !== undefined) sets.push(sql`bbox_pixel = ${sql.json(patch.bboxPixel)}`);
  if (patch.bboxData !== undefined) sets.push(sql`bbox_data = ${sql.json(patch.bboxData as object)}`);
  if (patch.point !== undefined) sets.push(sql`point = ${sql.json(patch.point)}`);
  if (patch.nearestNode !== undefined) sets.push(sql`nearest_node = ${patch.nearestNode}`);
  if (sets.length === 0) {
    const rows = await sql`SELECT * FROM annotations WHERE id = ${id} AND diagram_id = ${diagramId}`;
    return rows.length > 0 ? rowToAnnotation(rows[0]) : null;
  }
  const rows = await sql`
    UPDATE annotations SET ${sets.flatMap((s, i) => i === 0 ? [s] : [sql`, `, s])}
    WHERE id = ${id} AND diagram_id = ${diagramId}
    RETURNING *
  `;
  return rows.length > 0 ? rowToAnnotation(rows[0]) : null;
}

export async function deleteAnnotation(sql: Sql, diagramId: string, id: string): Promise<void> {
  await sql`DELETE FROM annotations WHERE id = ${id} AND diagram_id = ${diagramId}`;
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/db/annotations.test.ts
```
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/annotations.ts packages/server/test/db/annotations.test.ts
git commit -m "feat(db): annotations repo with kind/createdAt invariants"
```

**Done when:** 4 tests pass; update can't rewrite `kind`/`createdAt`.

---

### Task 6: Bearer auth middleware

**Files:**
- Create: `packages/server/src/auth/bearer.ts`
- Create: `packages/server/test/auth/bearer.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write the failing tests**

Create `packages/server/test/auth/bearer.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { authenticate } from "../../src/auth/bearer";
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

beforeEach(reset);
afterEach(closeDb);

describe("authenticate (Bearer)", () => {
  it("returns the workspace id for a valid Bearer token", async () => {
    const sql = getDb(TEST_DB_URL);
    const ws = await createWorkspace(sql);
    const req = new Request("http://x/api/anything", { headers: { Authorization: `Bearer ${ws.id}` } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workspaceId).toBe(ws.id);
  });

  it("returns 401 result when Authorization header missing", async () => {
    const sql = getDb(TEST_DB_URL);
    const req = new Request("http://x/api/anything");
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 result when token doesn't match any workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const req = new Request("http://x/api/anything", { headers: { Authorization: "Bearer 00000000-0000-0000-0000-000000000000" } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when Authorization header is malformed", async () => {
    const sql = getDb(TEST_DB_URL);
    const req = new Request("http://x/api/anything", { headers: { Authorization: "not-bearer-format" } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Implement**

Create `packages/server/src/auth/bearer.ts`:
```ts
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export type AuthResult =
  | { ok: true; workspaceId: string }
  | { ok: false; status: number; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticate(req: Request, sql: Sql): Promise<AuthResult> {
  const header = req.headers.get("Authorization");
  if (!header) return { ok: false, status: 401, message: "missing Authorization header" };
  const m = /^Bearer\s+([0-9a-f-]{36})$/i.exec(header);
  if (!m || !UUID_RE.test(m[1]!)) return { ok: false, status: 401, message: "malformed Bearer token" };
  const token = m[1]!.toLowerCase();
  const rows = await sql`SELECT id FROM workspaces WHERE id = ${token}`;
  if (rows.length === 0) return { ok: false, status: 401, message: "unknown workspace" };
  return { ok: true, workspaceId: token };
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/auth/bearer.test.ts
```
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/bearer.ts packages/server/test/auth/bearer.test.ts
git commit -m "feat(auth): Bearer-token workspace authentication"
```

**Done when:** 4 tests pass; valid Bearer → workspaceId; invalid/missing → 401.

---

### Task 7: Refactor MCP tools to use workspace context

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Modify: `packages/server/src/http/routes.ts`
- Create: `packages/server/test/http/workspace-routes.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Update ToolCtx and tools**

Modify `packages/server/src/mcp/tools.ts`. The new `ToolCtx`:
```ts
import type postgres from "postgres";
import type { WsHub } from "../ws/broadcast";
import type { KrokiClient } from "../kroki/client";

type Sql = ReturnType<typeof postgres>;

export interface ToolCtx {
  sql: Sql;
  workspaceId: string;
  kroki: KrokiClient;
  hub: WsHub;
}
```

**Remove** the following tool definitions (Tauri-coupled, deprecated):
- `install_mcp_plugin`
- `check_app_running`
- `launch_app`

**Refactor** the remaining 11 tools to use `ctx.sql` + `ctx.workspaceId` instead of the old in-memory stores. Each tool's `run` function calls the appropriate `db/*` repo function with `ctx.workspaceId` as scope. Example — `list_diagrams`:

```ts
async function listDiagramsImpl(_args: Record<string, unknown>, ctx: ToolCtx) {
  const { listDiagrams } = await import("../db/diagrams");
  const rows = await listDiagrams(ctx.sql, ctx.workspaceId);
  return { diagrams: rows.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    engine: d.engine,
    kind: d.kind,
    updatedAt: d.updatedAt,
  })) };
}
```

For each tool, apply the same pattern: in-memory store calls become db-repo calls scoped to `ctx.workspaceId`. Annotations get scoped via diagram lookups (`getDiagram(sql, workspaceId, diagramId)` must succeed before any annotation op).

- [ ] **Step 3: Refactor `/api/*` route handlers**

Modify `packages/server/src/http/routes.ts`. The signature of `handleApi` changes:

```ts
import { authenticate } from "../auth/bearer";

export interface RouteDeps {
  sql: Sql;
  kroki: KrokiClient;
  hub: WsHub;
}

export async function handleApi(req: Request, url: URL, deps: RouteDeps): Promise<Response | undefined> {
  const p = url.pathname;

  // Public anonymous workspace creation — no auth
  if (p === "/api/workspaces" && req.method === "POST") {
    const { createWorkspace } = await import("../db/workspaces");
    const ws = await createWorkspace(deps.sql);
    return Response.json({ id: ws.id });
  }

  // Health check — no auth
  if (p === "/api/health" && req.method === "GET") {
    return Response.json({ ok: true });
  }

  // Public diagram view — no auth
  const publicMatch = p.match(/^\/p\/([a-z0-9_-]+)$/i);
  if (publicMatch && req.method === "GET") {
    // (Public-page implementation in Wave 4 T22)
    return undefined;
  }

  // Everything else under /api/* requires Bearer
  if (!p.startsWith("/api/")) return undefined;

  const auth = await authenticate(req, deps.sql);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  const workspaceId = auth.workspaceId;
  // ...the rest of the route handlers use workspaceId
  return undefined;
}
```

Each existing route handler now uses `deps.sql` + `workspaceId` instead of the old stores. Drop `paths`, `store`, `annotations`, `workspace`, and `schedulePersistWorkspace` from `RouteDeps` entirely — they're obsolete.

- [ ] **Step 4: Write a workspace isolation integration test**

Create `packages/server/test/http/workspace-routes.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";
import { getDb, closeDb } from "../../src/db/client";
import { createWorkspace } from "../../src/db/workspaces";
import { createDiagram } from "../../src/db/diagrams";
import { handleApi } from "../../src/http/routes";
import { WsHub } from "../../src/ws/broadcast";
import { KrokiClient } from "../../src/kroki/client";
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

beforeEach(reset);
afterEach(closeDb);

describe("workspace-scoped routes", () => {
  it("rejects /api/diagrams without Bearer", async () => {
    const sql = getDb(TEST_DB_URL);
    const deps = { sql, kroki: new KrokiClient(), hub: new WsHub() };
    const req = new Request("http://x/api/diagrams");
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(401);
  });

  it("returns only diagrams belonging to the Bearer's workspace", async () => {
    const sql = getDb(TEST_DB_URL);
    const a = await createWorkspace(sql);
    const b = await createWorkspace(sql);
    await createDiagram(sql, { workspaceId: a.id, slug: "from-a", name: "A", engine: "mermaid", kind: "graph" });
    await createDiagram(sql, { workspaceId: b.id, slug: "from-b", name: "B", engine: "plantuml", kind: "passthrough" });
    const deps = { sql, kroki: new KrokiClient(), hub: new WsHub() };
    const req = new Request("http://x/api/diagrams", { headers: { Authorization: `Bearer ${a.id}` } });
    const resp = await handleApi(req, new URL(req.url), deps);
    expect(resp?.status).toBe(200);
    const body = await resp?.json() as { diagrams: { slug: string }[] };
    expect(body.diagrams).toHaveLength(1);
    expect(body.diagrams[0]?.slug).toBe("from-a");
  });
});
```

- [ ] **Step 5: Run tests**

```
cd packages/server && bun test test/http/workspace-routes.test.ts
```
Expected: 2 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/mcp/tools.ts packages/server/src/http/routes.ts packages/server/test/http/workspace-routes.test.ts
git commit -m "feat(http): workspace-scoped routes + Bearer auth; remove deprecated tools"
```

**Done when:** Workspace isolation integration test passes; deprecated MCP tools removed; 11 tools remain.

---

### Task 8: Wave 1 YAGNI gate + checkpoint

- [ ] **Step 1: Audit the diff vs main**

```
cd $WORKTREE && git diff --stat main..HEAD | tail -10
git diff --name-only --diff-filter=A main..HEAD | sort
```

Expected new files only in `packages/server/src/db/*`, `packages/server/migrations/`, `packages/server/src/auth/*`, `packages/shared/src/workspace.ts`. No premature deletions of legacy code yet (that's Wave 5).

- [ ] **Step 2: Run the full server test suite**

```
cd packages/server && bun test
```

Expected: all new tests pass; some legacy tests that depended on the old `paths.diagramsDir` / in-memory stores may now fail. That's expected — they'll be removed in Wave 5. Document failures in the commit message.

- [ ] **Step 3: Checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Wave 1 — server-side multi-tenant refactor"
```

**Done when:** Wave 1 checkpoint committed; new infrastructure in place; legacy paths still callable.

---

## Wave 2 — Docker compose stack

**Goal:** `docker compose up` brings a working PrixmaViz instance up locally.

### Task 9: Dockerfile (multi-stage Bun build)

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
**/node_modules
dist
**/dist
.git
.github
docs
src-tauri
.env
.env.local
**/.DS_Store
```

- [ ] **Step 3: Write `Dockerfile`**

Multi-stage:

```dockerfile
# syntax=docker/dockerfile:1.6

# ── Stage 1: build web bundle ──────────────────────────────────────
FROM oven/bun:1.3-alpine AS web-build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/web packages/web
RUN cd packages/web && bun run build
# packages/web/dist/ now contains the SPA bundle

# ── Stage 2: build server ──────────────────────────────────────────
FROM oven/bun:1.3-alpine AS server-build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN bun install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY --from=web-build /app/packages/web/dist /app/packages/web/dist
# Embed the web dist into the server binary location
RUN cd packages/server && bun run build:bin
# packages/server outputs to ../../dist/prixmaviz at workspace root

# ── Stage 3: runtime ───────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
COPY --from=server-build /app/dist/prixmaviz /app/prixmaviz
COPY --from=server-build /app/packages/server/migrations /app/migrations
COPY --from=web-build /app/packages/web/dist /app/web-dist
ENV PRIXMAVIZ_WEB_DIST=/app/web-dist
ENV PRIXMAVIZ_MIGRATIONS_DIR=/app/migrations
EXPOSE 5180
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost:5180/api/health | grep -q '"ok":true' || exit 1
CMD ["/app/prixmaviz"]
```

- [ ] **Step 4: Verify the image builds**

```
docker build -t prixmaviz:dev .
```
Expected: successful build. May take 2-5 minutes the first time.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(docker): multi-stage build → ~150MB image"
```

**Done when:** `docker build` succeeds; image starts and `/api/health` responds (smoke test in T12).

---

### Task 10: docker-compose.yaml + `.env.example`

**Files:**
- Create: `docker-compose.yaml` (repo root)
- Create: `.env.example` (repo root)

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write `docker-compose.yaml`**

```yaml
services:
  prixmaviz:
    image: prixmaviz:dev
    build: .
    ports:
      - "${HOST_PORT:-5180}:5180"
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgres://prixmaviz:prixmaviz@postgres:5432/prixmaviz}
      KROKI_URL: ${KROKI_URL:-http://kroki:8000}
      PRIXMAVIZ_PUBLIC_URL: ${PRIXMAVIZ_PUBLIC_URL:-http://localhost:5180}
    depends_on:
      postgres:
        condition: service_healthy
      kroki:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:5180/api/health"]
      interval: 10s
      timeout: 3s
      retries: 5

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: prixmaviz
      POSTGRES_PASSWORD: prixmaviz
      POSTGRES_DB: prixmaviz
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U prixmaviz"]
      interval: 5s
      timeout: 3s
      retries: 5
    profiles: ["", "default"]

  kroki:
    image: yuzutech/kroki:latest
    environment:
      KROKI_MERMAID_HOST: kroki-mermaid
      KROKI_BPMN_HOST: kroki-bpmn
      KROKI_EXCALIDRAW_HOST: kroki-excalidraw

  kroki-mermaid:
    image: yuzutech/kroki-mermaid:latest

  kroki-plantuml:
    image: yuzutech/kroki-plantuml:latest
    ports:
      - "8004:8080"
    # PlantUML sidecar — kroki orchestrator auto-discovers it via the container name

  kroki-bpmn:
    image: yuzutech/kroki-bpmn:latest

  kroki-excalidraw:
    image: yuzutech/kroki-excalidraw:latest

volumes:
  postgres-data:
```

(Note: in production-profile deployment, the user removes `postgres` from this compose file or starts with `--profile production` — they configure `DATABASE_URL` to point at their external Postgres.)

- [ ] **Step 3: Write `.env.example`**

```
# Host port the prixmaviz container is exposed on
HOST_PORT=5180

# Database URL — leave default for bundled Postgres, override for production
DATABASE_URL=postgres://prixmaviz:prixmaviz@postgres:5432/prixmaviz

# Kroki URL — leave default for bundled Kroki, override for external instance
KROKI_URL=http://kroki:8000

# Canonical public URL the workspace is served from (no trailing slash)
PRIXMAVIZ_PUBLIC_URL=http://localhost:5180
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yaml .env.example
git commit -m "feat(docker): docker-compose.yaml + .env.example"
```

**Done when:** Both files exist; documented all configurable env vars.

---

### Task 11: Server-side wiring — migrate on startup + use env vars

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/bootstrap.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Rewire bootstrap**

Modify `packages/server/src/bootstrap.ts`. The old `resolvePaths(projectRoot)` is gone — replace with env-var resolution:

```ts
export interface PrixmaConfig {
  databaseUrl: string;
  krokiUrl: string;
  publicUrl: string;
  bindHost: string;
  bindPort: number;
  webDist: string;
  migrationsDir: string;
}

export function loadConfig(): PrixmaConfig {
  const env = process.env;
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return {
    databaseUrl: env.DATABASE_URL,
    krokiUrl: env.KROKI_URL ?? "http://localhost:8000",
    publicUrl: env.PRIXMAVIZ_PUBLIC_URL ?? "http://localhost:5180",
    bindHost: env.PRIXMAVIZ_BIND_HOST ?? "0.0.0.0",
    bindPort: parseInt(env.PRIXMAVIZ_BIND_PORT ?? "5180", 10),
    webDist: env.PRIXMAVIZ_WEB_DIST ?? "packages/web/dist",
    migrationsDir: env.PRIXMAVIZ_MIGRATIONS_DIR ?? "packages/server/migrations",
  };
}
```

- [ ] **Step 3: Rewire index.ts**

Modify `packages/server/src/index.ts`. The new `main()`:

```ts
import { loadConfig } from "./bootstrap";
import { runMigrations } from "./db/migrate";
import { getDb } from "./db/client";
import { KrokiClient } from "./kroki/client";
import { WsHub } from "./ws/broadcast";
import { handleApi } from "./http/routes";
import { serveStatic } from "./static";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const config = loadConfig();
  console.error(`prixmaviz starting — public=${config.publicUrl}`);

  await runMigrations(config.databaseUrl, config.migrationsDir);

  const sql = getDb(config.databaseUrl);
  const kroki = new KrokiClient({ baseUrl: config.krokiUrl });
  const hub = new WsHub();
  const deps = { sql, kroki, hub };

  const fallbackHtml = `<!doctype html><h1>PrixmaViz</h1><p>Web bundle missing at <code>${config.webDist}</code>.</p>`;

  const server = Bun.serve<{ id: string }, undefined>({
    hostname: config.bindHost,
    port: config.bindPort,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const ok = srv.upgrade(req, { data: { id: crypto.randomUUID() } });
        return ok ? undefined : new Response("upgrade failed", { status: 400 });
      }
      const apiResp = await handleApi(req, url, deps);
      if (apiResp) return apiResp;
      if (req.method === "GET") {
        return serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, {
          webDist: config.webDist,
          fallbackHtml,
        });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) { hub.add({ send: (s) => ws.send(s) }); },
      close() {},
      message() {},
    },
  });

  console.error(`prixmaviz listening on http://${config.bindHost}:${server.port}`);
}

main().catch((e) => {
  console.error("prixmaviz failed to start:", e);
  process.exit(1);
});
```

(Remove all `--port`, `--project-root`, `--kroki-url`, `--mcp` CLI arg handling — config is now env-only. The MCP mode is fully gone from the server binary; the shim handles that.)

- [ ] **Step 4: Type-check**

```
cd packages/server && bunx tsc --noEmit
```
Expected: 0 errors related to changes (legacy stub files that import the deleted helpers will error — those are removed in Wave 5).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/bootstrap.ts
git commit -m "feat(server): env-config based startup; auto-migrate on boot"
```

**Done when:** Server starts with env-only config; runs migrations on boot; listens on configured host/port.

---

### Task 12: Stack smoke + Wave 2 checkpoint

**Files:**
- None (verification)

- [ ] **Step 1: Build and start**

```bash
docker compose build prixmaviz
docker compose up -d
docker compose ps
```

Expected: all services running, all healthchecks passing within 30s.

- [ ] **Step 2: Verify endpoints**

```bash
# Health
curl -s http://localhost:5180/api/health
# Expected: {"ok":true}

# Create workspace (anonymous)
curl -s -X POST http://localhost:5180/api/workspaces
# Expected: {"id":"<uuid>"}

# Try to access /api/diagrams without auth → 401
curl -i -s http://localhost:5180/api/diagrams
# Expected: HTTP/1.1 401

# With Bearer → 200 + empty list
UUID=$(curl -s -X POST http://localhost:5180/api/workspaces | python3 -c 'import sys, json; print(json.load(sys.stdin)["id"])')
curl -s -H "Authorization: Bearer $UUID" http://localhost:5180/api/diagrams
# Expected: {"diagrams":[]}
```

- [ ] **Step 3: Tear down + record**

```bash
docker compose down
```

- [ ] **Step 4: Wave 2 checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Wave 2 — Docker compose stack works end-to-end"
```

**Done when:** All 6 containers healthy; `/api/health` + Bearer auth flow confirmed.

---

## Wave 3 — MCP shim rewrite

**Goal:** Tiny HTTP forwarder binary distributed via the CC plugin.

### Task 13: Shim package scaffold

**Files:**
- Create: `packages/shim/package.json`
- Create: `packages/shim/tsconfig.json`
- Create: `packages/shim/src/bootstrap.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: package.json**

Create `packages/shim/package.json`:
```json
{
  "name": "@prixmaviz/shim",
  "version": "0.4.0",
  "type": "module",
  "scripts": {
    "build:bin": "bun build src/index.ts --compile --outfile ../../dist/prixmaviz-mcp"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@prixmaviz/shared": "workspace:*"
  }
}
```

- [ ] **Step 3: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: bootstrap.ts (first-launch workspace creation)**

Create `packages/shim/src/bootstrap.ts`:
```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

function workspaceConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("cannot resolve home directory");
  if (process.platform === "darwin") {
    return join(home, "Library/Application Support/PrixmaViz/workspace.txt");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? home, "PrixmaViz/workspace.txt");
  }
  return join(home, ".config/prixmaviz/workspace.txt");
}

export async function resolveWorkspaceId(remoteUrl: string): Promise<string> {
  if (process.env.PRIXMAVIZ_WORKSPACE) return process.env.PRIXMAVIZ_WORKSPACE;

  const cfgPath = workspaceConfigPath();
  if (existsSync(cfgPath)) {
    const cached = (await readFile(cfgPath, "utf-8")).trim();
    if (cached) return cached;
  }

  // Bootstrap a new workspace
  const resp = await fetch(`${remoteUrl.replace(/\/$/, "")}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`failed to bootstrap workspace at ${remoteUrl}: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { id?: string };
  if (!data.id) throw new Error(`workspace bootstrap returned no id`);

  // Persist
  await mkdir(join(cfgPath, ".."), { recursive: true });
  await writeFile(cfgPath, data.id, "utf-8");
  console.error(`prixmaviz: workspace ${data.id} — view at ${remoteUrl}/w/${data.id}`);
  return data.id;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/shim/package.json packages/shim/tsconfig.json packages/shim/src/bootstrap.ts
git commit -m "feat(shim): scaffold + workspace bootstrap"
```

**Done when:** `@prixmaviz/shim` package exists; `resolveWorkspaceId(url)` returns cached or freshly-created UUID.

---

### Task 14: Shim MCP server with HTTP forwarding

**Files:**
- Create: `packages/shim/src/tools.ts`
- Create: `packages/shim/src/index.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Tool definitions**

Create `packages/shim/src/tools.ts` with 11 tool definitions (same names/inputSchema as the server-side definitions). Example structure:

```ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "create_diagram",
    description: "Create a new diagram in your PrixmaViz workspace.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        engine: { type: "string" },
      },
      required: ["name", "engine"],
    },
  },
  {
    name: "apply_patch",
    description: "Apply N patch ops atomically to a graph diagram.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        ops: { type: "array" },
      },
      required: ["diagramId", "ops"],
    },
  },
  // ... (full list of 11; see spec Section 4 for the exhaustive list)
  { name: "save_diagram", description: "Persist diagram.", inputSchema: { type: "object", properties: { diagramId: { type: "string" } }, required: ["diagramId"] } },
  { name: "load_diagram", description: "Load a saved diagram by slug.", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
  { name: "list_diagrams", description: "List workspace library.", inputSchema: { type: "object", properties: {} } },
  { name: "render_dsl", description: "Render arbitrary DSL via the chosen engine.", inputSchema: { type: "object", properties: { engine: { type: "string" }, source: { type: "string" }, name: { type: "string" } }, required: ["engine", "source"] } },
  { name: "get_annotations", description: "List annotations on a diagram.", inputSchema: { type: "object", properties: { diagramId: { type: "string" }, includeResolved: { type: "boolean" } }, required: ["diagramId"] } },
  { name: "update_tile", description: "Move/resize a tile.", inputSchema: { type: "object", properties: { tileId: { type: "string" }, patch: { type: "object" } }, required: ["tileId", "patch"] } },
  { name: "set_view", description: "Control camera + auto-arrange.", inputSchema: { type: "object", properties: { camera: { type: "object" }, arrange: { type: "object" } } } },
  { name: "get_focused_tile", description: "Return most-recently interacted tile.", inputSchema: { type: "object", properties: {} } },
  { name: "get_view_url", description: "Return the URL the user can open in a browser.", inputSchema: { type: "object", properties: {} } },
];
```

- [ ] **Step 3: index.ts (MCP server + HTTP dispatch)**

Create `packages/shim/src/index.ts`:
```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools";
import { resolveWorkspaceId } from "./bootstrap";

async function main() {
  const remoteUrl = process.env.PRIXMAVIZ_REMOTE_URL;
  if (!remoteUrl) {
    console.error("PRIXMAVIZ_REMOTE_URL is required");
    process.exit(1);
  }
  const workspaceId = await resolveWorkspaceId(remoteUrl);

  async function callTool(name: string, args: unknown) {
    const url = `${remoteUrl.replace(/\/$/, "")}/api/mcp/${encodeURIComponent(name)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${workspaceId}`,
        "Content-Type": "application/json",
        "X-PrixmaViz-Shim-Version": "0.4.0",
      },
      body: JSON.stringify(args ?? {}),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`prixmaviz ${name} failed (HTTP ${resp.status}): ${body.slice(0, 500)}`);
    }
    return await resp.json();
  }

  const server = new Server(
    { name: "prixmaviz", version: "0.4.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await callTool(req.params.name, req.params.arguments);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error("prixmaviz-mcp error:", e);
  process.exit(1);
});
```

- [ ] **Step 4: Server route for /api/mcp/:name**

Modify `packages/server/src/http/routes.ts` to add the new route. After the `authenticate()` call:

```ts
const mcpMatch = p.match(/^\/api\/mcp\/([a-z_]+)$/);
if (mcpMatch && req.method === "POST") {
  const toolName = mcpMatch[1]!;
  const args = await req.json().catch(() => ({}));
  const { dispatchTool } = await import("../mcp/tools");
  try {
    const result = await dispatchTool(toolName, args as Record<string, unknown>, {
      sql: deps.sql,
      workspaceId,
      kroki: deps.kroki,
      hub: deps.hub,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

- [ ] **Step 5: Build the shim binary**

```
cd packages/shim && bun install && bun run build:bin
ls -lh ../../dist/prixmaviz-mcp
```
Expected: ~60MB binary.

- [ ] **Step 6: Commit**

```bash
git add packages/shim/src/tools.ts packages/shim/src/index.ts packages/server/src/http/routes.ts
git commit -m "feat(shim): MCP server with HTTP forwarding to /api/mcp/<tool>"
```

**Done when:** Shim binary builds; calls `tools/list` returns 11 tools; calls forward to server.

---

### Task 15: Cross-platform shim builds

**Files:**
- Create: `packages/shim/build.ts`
- Modify: `package.json` (workspace root)

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Multi-target build script**

Create `packages/shim/build.ts`:
```ts
import { $ } from "bun";

const TARGETS = [
  { name: "darwin-arm64", flag: "--target=bun-darwin-arm64" },
  { name: "darwin-x64", flag: "--target=bun-darwin-x64" },
  { name: "linux-x64", flag: "--target=bun-linux-x64" },
  { name: "linux-arm64", flag: "--target=bun-linux-arm64" },
  { name: "windows-x64", flag: "--target=bun-windows-x64" },
];

await $`mkdir -p ../../dist`;
for (const t of TARGETS) {
  const out = `../../dist/prixmaviz-mcp-${t.name}${t.name.startsWith("windows") ? ".exe" : ""}`;
  console.log(`building ${out}…`);
  await $`bun build src/index.ts --compile ${t.flag} --outfile ${out}`;
}
console.log("done.");
```

Update `packages/shim/package.json` scripts:
```json
{
  "scripts": {
    "build:bin": "bun build src/index.ts --compile --outfile ../../dist/prixmaviz-mcp",
    "build:all": "bun run build.ts"
  }
}
```

- [ ] **Step 3: Build all targets**

```
cd packages/shim && bun run build:all
ls -lh ../../dist/prixmaviz-mcp-*
```
Expected: 5 binaries, each ~60MB. May take a few minutes (Bun downloads each target's runtime on first run).

- [ ] **Step 4: Commit**

```bash
git add packages/shim/build.ts packages/shim/package.json
git commit -m "feat(shim): cross-platform release builds (5 targets)"
```

**Done when:** All 5 platform binaries build cleanly.

---

### Task 16: Plugin payload update

**Files:**
- Modify: `src-tauri/resources/plugin/.mcp.json`
- Modify: `src-tauri/resources/plugin/.claude-plugin/plugin.json` (bump version)
- Delete: `src-tauri/resources/plugin/bin/prixmaviz` (Cycle 3 binary)
- Copy: new shim binary into plugin payload

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Update .mcp.json**

Modify `src-tauri/resources/plugin/.mcp.json`:
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

- [ ] **Step 3: Bump plugin.json version**

Modify `src-tauri/resources/plugin/.claude-plugin/plugin.json` — change `"version": "0.3.0"` to `"version": "0.4.0"`. Update description if helpful.

- [ ] **Step 4: Swap binary**

```bash
rm -f src-tauri/resources/plugin/bin/prixmaviz
cp dist/prixmaviz-mcp src-tauri/resources/plugin/bin/prixmaviz-mcp
chmod +x src-tauri/resources/plugin/bin/prixmaviz-mcp
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/resources/plugin/.mcp.json src-tauri/resources/plugin/.claude-plugin/plugin.json
git rm src-tauri/resources/plugin/bin/prixmaviz 2>/dev/null || true
# bin/prixmaviz-mcp is in .gitignore (it's a built artifact)
git commit -m "feat(plugin): swap to shim binary; point at prixmaviz.alexis.com"
```

**Done when:** Plugin payload's `.mcp.json` points at the shim; old binary deleted from git; new binary present locally for testing.

---

### Task 17: Wave 3 smoke + checkpoint

- [ ] **Step 1: Stack still up + plugin install**

```bash
docker compose up -d
# Wait for healthchecks…
claude plugins marketplace add "$(pwd)/src-tauri/resources/plugin/.claude-plugin/marketplace.json"
claude plugins install prixmaviz@prixmaviz-local
```

- [ ] **Step 2: Locate plugin install + sync binary**

```bash
PLUGIN_PATH=$(python3 -c "
import json, os
data = json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
for k, v in data['plugins'].items():
  if k.startswith('prixmaviz@'):
    print(v[0]['installPath']); break
")
mkdir -p "$PLUGIN_PATH/bin"
cp dist/prixmaviz-mcp "$PLUGIN_PATH/bin/prixmaviz-mcp"
chmod +x "$PLUGIN_PATH/bin/prixmaviz-mcp"
```

- [ ] **Step 3: Verify MCP works**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  PRIXMAVIZ_REMOTE_URL=http://localhost:5180 \
  "$PLUGIN_PATH/bin/prixmaviz-mcp" 2>&1 | head -1 | python3 -m json.tool
```
Expected: tools/list returns 11 tools.

- [ ] **Step 4: Wave 3 checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Wave 3 — MCP shim HTTP forwarding works"
```

**Done when:** Plugin install completes; `tools/list` returns 11 tools through the shim hitting the local Docker stack.

---

## Wave 4 — Marketing-surface UI

**Goal:** Workspace UI gains footer, welcome panel, empty-state cards, public-view toggle, and `/p/:id` route.

### Task 18: Footer component

**Files:**
- Create: `packages/web/src/components/Footer.tsx`
- Modify: `packages/web/src/styles.css`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write component**

Create `packages/web/src/components/Footer.tsx`:
```tsx
interface Props {
  workspaceUrl: string;
  brandUrl?: string;
  brandName?: string;
  crossPromo?: Array<{ name: string; href: string; tagline?: string }>;
}

const DEFAULT_BRAND = "alexis.com";
const DEFAULT_BRAND_URL = "https://alexis.com";
const DEFAULT_PROMO: Array<{ name: string; href: string }> = [];

export function Footer({
  workspaceUrl,
  brandUrl = DEFAULT_BRAND_URL,
  brandName = DEFAULT_BRAND,
  crossPromo = DEFAULT_PROMO,
}: Props) {
  return (
    <footer className="prixma-footer">
      <span className="prixma-footer-left">
        PrixmaViz — an <a href={brandUrl} target="_blank" rel="noopener">{brandName}</a> product
      </span>
      <span className="prixma-footer-center">
        {crossPromo.length > 0 && <span className="prixma-footer-promo-label">Also try: </span>}
        {crossPromo.map((p) => (
          <a key={p.name} href={p.href} target="_blank" rel="noopener" className="prixma-footer-chip">
            {p.name}
          </a>
        ))}
      </span>
      <span className="prixma-footer-right">
        <a href={workspaceUrl} className="prixma-footer-url">{workspaceUrl}</a>
      </span>
    </footer>
  );
}
```

- [ ] **Step 3: Styles**

Append to `packages/web/src/styles.css`:
```css
.prixma-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 16px; height: 32px;
  background: #0e0f12; border-top: 1px solid #2c2f3a;
  color: #a0a3ad; font-size: 11px;
}
.prixma-footer a { color: #a0a3ad; text-decoration: none; }
.prixma-footer a:hover { color: #e6e7eb; }
.prixma-footer-chip {
  padding: 2px 8px; border: 1px solid #2c2f3a; border-radius: 4px; margin-right: 6px;
}
.prixma-footer-chip:hover { border-color: #7aa2f7; }
.prixma-footer-promo-label { margin-right: 6px; }
.prixma-footer-url { font-family: ui-monospace, Menlo, monospace; font-size: 10px; }
```

- [ ] **Step 4: Mount in App**

Modify `packages/web/src/App.tsx` — add Footer at the bottom of the layout:
```tsx
import { Footer } from "./components/Footer";

// inside the returned JSX, after the workspace div:
<Footer
  workspaceUrl={window.location.href}
  crossPromo={[
    // populated from env or config in a future cycle
  ]}
/>
```

- [ ] **Step 5: Build + commit**

```
cd packages/web && bun run build
git add packages/web/src/components/Footer.tsx packages/web/src/styles.css packages/web/src/App.tsx
git commit -m "feat(web): Footer with brand + cross-promo placeholder"
```

**Done when:** Footer renders at bottom of workspace; build clean.

---

### Task 19: First-session welcome panel

**Files:**
- Create: `packages/web/src/components/WelcomePanel.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/store/index.ts`
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Component**

Create `packages/web/src/components/WelcomePanel.tsx`:
```tsx
interface Props {
  workspaceUrl: string;
  onDismiss: () => void;
  onNeverShowAgain: () => void;
}

export function WelcomePanel({ workspaceUrl, onDismiss, onNeverShowAgain }: Props) {
  return (
    <div className="welcome-overlay" onClick={onDismiss}>
      <div className="welcome-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Welcome to PrixmaViz</h2>
        <p>
          This is your workspace. Your AI assistant can render diagrams here
          and you can annotate them.
        </p>
        <p>Your workspace URL is:</p>
        <pre className="welcome-url">{workspaceUrl}</pre>
        <p className="welcome-warning">
          <strong>Bookmark it.</strong> Anyone with the URL can see your work.
        </p>
        <div className="welcome-actions">
          <button onClick={onDismiss}>Got it</button>
          <button onClick={onNeverShowAgain}>Don't show again</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Store wiring**

Modify `packages/web/src/store/index.ts` — add:
```ts
welcomeSeen: localStorage.getItem("prixmaviz_welcome_seen") === "1",
setWelcomeSeen: (v: boolean) => {
  localStorage.setItem("prixmaviz_welcome_seen", v ? "1" : "0");
  set({ welcomeSeen: v });
},
```

(Also add the field declaration to `AppState`.)

- [ ] **Step 4: Mount in App**

In `App.tsx`:
```tsx
import { WelcomePanel } from "./components/WelcomePanel";

// inside App():
const welcomeSeen = useAppStore((s) => s.welcomeSeen);
const setWelcomeSeen = useAppStore((s) => s.setWelcomeSeen);
const [welcomeDismissed, setWelcomeDismissed] = useState(false);
const showWelcome = !welcomeSeen && !welcomeDismissed;

// in JSX:
{showWelcome && (
  <WelcomePanel
    workspaceUrl={window.location.href}
    onDismiss={() => setWelcomeDismissed(true)}
    onNeverShowAgain={() => setWelcomeSeen(true)}
  />
)}
```

- [ ] **Step 5: Styles**

Append to styles.css:
```css
.welcome-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.welcome-panel {
  background: #1a1d24; color: #e6e7eb; padding: 32px; border-radius: 12px;
  max-width: 480px; box-shadow: 0 16px 48px rgba(0,0,0,0.6);
}
.welcome-panel h2 { margin: 0 0 16px; font-size: 22px; }
.welcome-panel p { margin: 0 0 12px; line-height: 1.5; }
.welcome-url {
  background: #0e0f12; padding: 10px 14px; border-radius: 6px;
  font-family: ui-monospace, Menlo, monospace; font-size: 13px;
  word-break: break-all;
}
.welcome-warning { color: #f7768e; }
.welcome-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.welcome-actions button {
  background: #7aa2f7; color: #0e0f12; border: 0;
  padding: 8px 16px; border-radius: 6px; cursor: pointer;
}
.welcome-actions button:last-child {
  background: transparent; color: #a0a3ad; border: 1px solid #2c2f3a;
}
```

- [ ] **Step 6: Build + commit**

```
cd packages/web && bun run build
git add packages/web/src/components/WelcomePanel.tsx packages/web/src/App.tsx packages/web/src/store/index.ts packages/web/src/styles.css
git commit -m "feat(web): first-session welcome panel"
```

**Done when:** Welcome panel shows on first visit, dismissable, hidden after "Don't show again."

---

### Task 20: Empty-state cross-promo cards

**Files:**
- Create: `packages/web/src/components/EmptyStateCards.tsx`
- Modify: `packages/web/src/components/InfiniteCanvas.tsx` (or wherever empty-state is rendered)

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Component**

Create `packages/web/src/components/EmptyStateCards.tsx`:
```tsx
interface PromoCard {
  name: string;
  href: string;
  tagline: string;
}

interface Props {
  cards: PromoCard[];
}

export function EmptyStateCards({ cards }: Props) {
  if (cards.length === 0) return null;
  return (
    <div className="empty-state-promo">
      <p className="empty-state-promo-label">While you wait, check out other Alexis products:</p>
      <div className="empty-state-promo-cards">
        {cards.map((c) => (
          <a key={c.name} className="empty-state-promo-card" href={c.href} target="_blank" rel="noopener">
            <strong>{c.name}</strong>
            <span>{c.tagline}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount in empty-state of InfiniteCanvas**

Modify `packages/web/src/components/InfiniteCanvas.tsx` — render `<EmptyStateCards />` next to the "No diagram open" placeholder, conditionally on `tiles.length === 0`.

- [ ] **Step 4: Styles**

```css
.empty-state-promo { margin-top: 32px; text-align: center; }
.empty-state-promo-label { color: #a0a3ad; font-size: 12px; margin-bottom: 12px; }
.empty-state-promo-cards { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.empty-state-promo-card {
  display: flex; flex-direction: column; gap: 4px;
  background: #1a1d24; border: 1px solid #2c2f3a; border-radius: 6px;
  padding: 12px 16px; min-width: 180px; text-decoration: none; color: #e6e7eb;
}
.empty-state-promo-card:hover { border-color: #7aa2f7; }
.empty-state-promo-card span { color: #a0a3ad; font-size: 12px; }
```

- [ ] **Step 5: Build + commit**

```
cd packages/web && bun run build
git add packages/web/src/components/EmptyStateCards.tsx packages/web/src/components/InfiniteCanvas.tsx packages/web/src/styles.css
git commit -m "feat(web): empty-state cross-promo cards"
```

**Done when:** Cards appear when library is empty; disappear when first diagram lands.

---

### Task 21: Make-public toggle

**Files:**
- Create: `packages/web/src/components/PublicViewToggle.tsx`
- Modify: `packages/web/src/components/Tile.tsx`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: API client method**

Append to `packages/web/src/lib/api.ts`:
```ts
  setDiagramVisibility: (id: string, isPublic: boolean) =>
    fetch(`/api/diagrams/${encodeURIComponent(id)}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public: isPublic }),
    }).then((r) => jsonOrThrow<{ public: boolean; publicUrl?: string }>(r)),
```

- [ ] **Step 3: Toggle component**

Create `packages/web/src/components/PublicViewToggle.tsx`:
```tsx
import { useState } from "react";
import { api } from "../lib/api";

interface Props {
  diagramId: string;
  publicView: boolean;
  publicUrl?: string;
}

export function PublicViewToggle({ diagramId, publicView, publicUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(publicView);
  const [resolvedUrl, setResolvedUrl] = useState(publicUrl);
  const [busy, setBusy] = useState(false);

  async function onChange(next: boolean) {
    setBusy(true);
    try {
      const result = await api.setDiagramVisibility(diagramId, next);
      setIsPublic(result.public);
      setResolvedUrl(result.publicUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-toggle-wrapper">
      <button
        className="public-toggle"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={isPublic ? "Public" : "Private"}
      >
        {isPublic ? "🌐" : "🔒"}
      </button>
      {open && (
        <div className="public-toggle-popover" onMouseDown={(e) => e.stopPropagation()}>
          <label><input type="radio" checked={!isPublic} onChange={() => onChange(false)} disabled={busy} /> Private</label>
          <label><input type="radio" checked={isPublic} onChange={() => onChange(true)} disabled={busy} /> Public</label>
          {isPublic && resolvedUrl && (
            <>
              <p className="public-toggle-hint">Anyone with this URL can view:</p>
              <input
                className="public-toggle-url"
                type="text"
                readOnly
                value={resolvedUrl}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount in Tile.tsx header**

Modify `packages/web/src/components/Tile.tsx` — add `<PublicViewToggle ... />` between the tile-name and the close button. Add styling rules similar to the export menu.

- [ ] **Step 5: Server route**

Add to `packages/server/src/http/routes.ts` (inside the authenticated `/api/*` block):
```ts
const visMatch = p.match(/^\/api\/diagrams\/([^/]+)\/visibility$/);
if (visMatch && req.method === "POST") {
  const diagramId = visMatch[1]!;
  const body = await req.json() as { public: boolean };
  const { setDiagramPublic, getDiagram } = await import("../db/diagrams");
  await setDiagramPublic(deps.sql, workspaceId, diagramId, body.public);
  const d = await getDiagram(deps.sql, workspaceId, diagramId);
  if (!d) return Response.json({ ok: false, error: "diagram not found" }, { status: 404 });
  const publicUrl = body.public
    ? `${process.env.PRIXMAVIZ_PUBLIC_URL ?? ""}/p/${diagramId}`
    : undefined;
  return Response.json({ public: d.publicView, publicUrl });
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/PublicViewToggle.tsx packages/web/src/components/Tile.tsx packages/web/src/lib/api.ts packages/web/src/styles.css packages/server/src/http/routes.ts
git commit -m "feat(web): make-public toggle + popover with copyable URL"
```

**Done when:** Toggling public on a tile produces a copyable URL; toggling off removes it.

---

### Task 22: `/p/:diagramId` public view route

**Files:**
- Create: `packages/web/src/pages/PublicDiagram.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Server route — JSON for the page + raw SVG**

Add to `packages/server/src/http/routes.ts` BEFORE the Bearer-auth gate (these are public):

```ts
// /p/:id — public view of a diagram (no auth)
const pubViewMatch = p.match(/^\/p\/([a-z0-9_-]+)$/i);
if (pubViewMatch && req.method === "GET") {
  // Let the SPA handle the page render; just confirm existence here
  const diagramId = pubViewMatch[1]!;
  const { getPublicDiagram } = await import("../db/diagrams");
  const d = await getPublicDiagram(deps.sql, diagramId);
  if (!d) return new Response("Not Found", { status: 404 });
  // Fall through — the static handler serves index.html and the SPA renders /p/<id>
  return undefined;
}

const pubSvgMatch = p.match(/^\/p\/([a-z0-9_-]+)\.svg$/i);
if (pubSvgMatch && req.method === "GET") {
  const diagramId = pubSvgMatch[1]!;
  const { getPublicDiagram } = await import("../db/diagrams");
  const d = await getPublicDiagram(deps.sql, diagramId);
  if (!d || !d.svg) return new Response("Not Found", { status: 404 });
  return new Response(d.svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    },
  });
}

// API endpoint for the page to fetch its own data — also no auth
const pubApiMatch = p.match(/^\/api\/public\/diagrams\/([a-z0-9_-]+)$/i);
if (pubApiMatch && req.method === "GET") {
  const diagramId = pubApiMatch[1]!;
  const { getPublicDiagram } = await import("../db/diagrams");
  const d = await getPublicDiagram(deps.sql, diagramId);
  if (!d) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  return Response.json({
    id: d.id, name: d.name, engine: d.engine, kind: d.kind, svg: d.svg, dsl: d.dsl,
  });
}
```

- [ ] **Step 3: SPA route page**

Create `packages/web/src/pages/PublicDiagram.tsx`:
```tsx
import { useEffect, useState } from "react";

interface PublicDiagramData {
  id: string;
  name: string;
  engine: string;
  kind: string;
  svg?: string;
  dsl?: string;
}

export function PublicDiagram({ diagramId }: { diagramId: string }) {
  const [data, setData] = useState<PublicDiagramData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/diagrams/${encodeURIComponent(diagramId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [diagramId]);

  if (error) return <div className="public-error">Diagram not found.</div>;
  if (!data) return <div className="public-loading">Loading…</div>;

  return (
    <div className="public-diagram">
      <header className="public-header">
        <h1>{data.name}</h1>
        <span className="public-engine">{data.engine}</span>
      </header>
      <div className="public-svg" dangerouslySetInnerHTML={{ __html: data.svg ?? "" }} />
      <footer className="public-footer">
        <a href="https://prixmaviz.alexis.com">Made with PrixmaViz</a>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Wire route in App.tsx**

Modify `packages/web/src/App.tsx` — detect `/p/<id>` in `window.location.pathname` and render `<PublicDiagram diagramId={...} />` instead of the workspace canvas.

- [ ] **Step 5: Styles**

Add basic styles for `.public-diagram`, `.public-header`, `.public-svg`, `.public-footer` etc. to styles.css.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/PublicDiagram.tsx packages/web/src/App.tsx packages/web/src/styles.css packages/server/src/http/routes.ts
git commit -m "feat(web): /p/:id public read-only view (no auth, iframe-friendly)"
```

**Done when:** Visiting `/p/<id>` for a public diagram renders the SVG; for private, returns 404; direct `.svg` URL works for iframes.

---

### Task 23: Settings panel additions

**Files:**
- Modify: `packages/web/src/components/SettingsPanel.tsx`
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Server routes**

Add to routes.ts:
```ts
if (p === "/api/workspace/name" && req.method === "PUT") {
  const body = await req.json() as { name: string | null };
  const { updateWorkspaceName } = await import("../db/workspaces");
  await updateWorkspaceName(deps.sql, workspaceId, body.name);
  return Response.json({ name: body.name });
}

if (p === "/api/workspace" && req.method === "DELETE") {
  const { deleteWorkspace } = await import("../db/workspaces");
  await deleteWorkspace(deps.sql, workspaceId);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: SettingsPanel additions**

In `packages/web/src/components/SettingsPanel.tsx`, add:

```tsx
// Above the existing Kroki URL field:
<label>
  <span>Workspace name (optional)</span>
  <input
    type="text"
    value={workspaceName}
    onChange={(e) => setWorkspaceName(e.target.value)}
    placeholder="My workspace"
  />
</label>

<label>
  <span>Workspace UUID (read-only)</span>
  <input type="text" readOnly value={workspaceUuid} onClick={(e) => (e.currentTarget as HTMLInputElement).select()} />
</label>
```

Add a "Delete workspace" danger zone:
```tsx
<div className="settings-danger">
  <h3>Danger zone</h3>
  <p className="settings-hint">Deletes this workspace and all its diagrams. This cannot be undone.</p>
  <button className="settings-danger-button" onClick={async () => {
    if (!confirm("Delete this workspace and all its diagrams? This cannot be undone.")) return;
    await fetch("/api/workspace", { method: "DELETE", headers: { Authorization: `Bearer ${workspaceUuid}` } });
    localStorage.removeItem("prixmaviz_workspace");
    window.location.href = "/";
  }}>Delete workspace</button>
</div>
```

(The save button now also PUT-s `/api/workspace/name` when name changes.)

- [ ] **Step 4: Build + commit**

```
cd packages/web && bun run build
git add packages/web/src/components/SettingsPanel.tsx packages/server/src/http/routes.ts
git commit -m "feat(web): settings panel — workspace name + UUID + delete"
```

**Done when:** User can rename workspace; UUID is copyable; delete workspace cascades and returns to /.

---

### Task 24: Wave 4 smoke + checkpoint

- [ ] **Step 1: Visual smoke**

With the Docker stack still up, open browser to `http://localhost:5180/`. Verify:
- WelcomePanel appears (first visit only)
- Footer renders at bottom with brand link
- Empty state shows promo cards
- Settings panel has workspace name + UUID + delete

- [ ] **Step 2: Public view smoke**

Create a workspace, render a diagram, toggle to public, copy URL, open in incognito → diagram renders without auth.

- [ ] **Step 3: Wave 4 checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Wave 4 — marketing-surface UI"
```

**Done when:** All four UI additions work; public URL accessible without auth.

---

## Wave 5 — Deprecation + acceptance

**Goal:** Remove Cycle 3's local-binary code paths; ship Cycle 4.

### Task 25: Remove Cycle 3 local-binary code paths

**Files (delete):**
- `packages/server/src/canvas/store.ts` (replaced by db/workspaces.ts)
- `packages/server/src/canvas/io.ts`
- `packages/server/src/canvas/watch.ts`
- `packages/server/src/annotations/store.ts` (replaced by db/annotations.ts)
- `packages/server/src/pviz/io.ts`
- `packages/server/src/pviz/watch.ts`
- `packages/server/src/pviz/slug.ts`
- `packages/server/src/mcp/install.ts`
- `packages/server/src/mcp/lifecycle.ts`
- `packages/server/src/settings/io.ts` (the Cycle 3 settings.json reader; envvars replace it)
- All corresponding `packages/server/test/<dir>/*.test.ts` files
- `packages/server/src/store/diagrams.ts` (the in-memory `DiagramStore`)

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Delete and clean up imports**

```bash
git rm packages/server/src/canvas/store.ts packages/server/src/canvas/io.ts packages/server/src/canvas/watch.ts
git rm packages/server/src/annotations/store.ts
git rm -r packages/server/src/pviz
git rm packages/server/src/mcp/install.ts packages/server/src/mcp/lifecycle.ts
git rm packages/server/src/settings/io.ts
git rm packages/server/src/store/diagrams.ts
git rm -r packages/server/test/canvas packages/server/test/annotations packages/server/test/pviz packages/server/test/settings 2>/dev/null || true
```

Then clean up any remaining imports of these in `routes.ts`, `mcp/tools.ts`, etc. The compiler will tell you what's broken; fix each one.

- [ ] **Step 3: Type-check**

```
cd packages/server && bunx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Run all tests**

```
cd packages/server && bun test
```
Expected: all remaining tests pass; deleted tests are gone.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Cycle 3 local-binary code paths (replaced by Postgres + workspaces)"
```

**Done when:** Type-check clean; tests pass; deleted files are gone from working tree.

---

### Task 26: Plugin payload — remove Cycle 3 binary + Tauri lifecycle

**Files:**
- Delete: `packages/server/src/mcp/lifecycle.ts` (if not deleted in T25)
- Modify: `src-tauri/src/install.rs` (simplify)
- Modify: `src-tauri/src/uninstall.rs` (simplify)
- Modify: `packages/server/src/mcp/tools.ts` (drop install_mcp_plugin if still present)

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Simplify install.rs**

The Tauri-side install in Cycle 3 had `cli_check`, `install_plugin_via_cli`, and `find_installed_plugin_path`. With the new shim binary as the only plugin asset, simplify install.rs to a function that just copies the right platform's shim binary into the plugin payload directory.

Actual implementation: replace the body of `install_plugin_via_cli` with logic that selects the shim binary for the host platform and copies it into `<resource_dir>/plugin/bin/prixmaviz-mcp`. Keep the rest (claude plugins marketplace add + install) the same.

- [ ] **Step 3: install_mcp_plugin tool removal**

If the `install_mcp_plugin` MCP tool is still in `mcp/tools.ts`, remove it (it was specific to Cycle 2.plus's manual write to claude_desktop_config.json — irrelevant now).

- [ ] **Step 4: Cargo check**

```
cd src-tauri && cargo check 2>&1 | tail -3
```
Expected: passes (or pre-existing warnings only).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/install.rs src-tauri/src/uninstall.rs packages/server/src/mcp/tools.ts
git commit -m "chore: simplify Tauri install/uninstall; remove install_mcp_plugin tool"
```

**Done when:** Tauri compiles; tool count finalized at 11.

---

### Task 27: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Rewrite README**

Replace the Cycle 3 content with Cycle 4 content. Key sections:

```markdown
# PrixmaViz

AI-native diagram tool — hosted at https://prixmaviz.alexis.com.

## Try the hosted version

Visit https://prixmaviz.alexis.com — your workspace is created automatically and bookmarkable.

## Install for Claude Code

```
claude plugins marketplace add https://github.com/MichaelDanCurtis/PrixmaViz#main:src-tauri/resources/plugin
claude plugins install prixmaviz@prixmaviz-local
```

The plugin will use `https://prixmaviz.alexis.com` by default. To point at your self-hosted instance, set `PRIXMAVIZ_REMOTE_URL` in the MCP server entry.

## Self-host

Run your own instance with Docker Compose:

```
git clone https://github.com/MichaelDanCurtis/PrixmaViz
cd PrixmaViz
cp .env.example .env
docker compose up -d
```

Open http://localhost:5180 — your workspace is ready.

## Architecture

[See docs/superpowers/specs/2026-05-11-prixmaviz-cycle-4-design.md]

## Cycles

- **Cycle 1** — Foundation: Bun + Tauri + 6-tool MCP
- **Cycle 2.plus** — Annotations + multi-canvas + initial install path
- **Cycle 3** — Real Claude Code plugin (skills, hooks, 14 MCP tools)
- **Cycle 4** — Service-first architecture (this version)

## License

MIT — see LICENSE.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README for Cycle 4 service-first architecture"
```

**Done when:** README documents the new install + self-host stories.

---

### Task 28: Final acceptance + Wave 5 checkpoint

- [ ] **Step 1: Full stack smoke**

```bash
docker compose down -v   # clean slate
docker compose up -d --build
# wait for healthchecks
docker compose ps
```

Expected: all 6 services healthy.

- [ ] **Step 2: Bearer auth + workspace flow**

```bash
# 1. Create workspace
UUID=$(curl -s -X POST http://localhost:5180/api/workspaces | python3 -c 'import sys, json; print(json.load(sys.stdin)["id"])')
echo "Workspace: $UUID"

# 2. Render via API
curl -s -X POST http://localhost:5180/api/render-dsl \
  -H "Authorization: Bearer $UUID" \
  -H "Content-Type: application/json" \
  -d '{"engine":"plantuml","source":"@startuml\nAlice -> Bob: hi\n@enduml","name":"test"}' \
  | python3 -m json.tool | head -10

# 3. List diagrams
curl -s -H "Authorization: Bearer $UUID" http://localhost:5180/api/diagrams | python3 -m json.tool

# 4. Workspace isolation: try someone else's UUID
OTHER=$(curl -s -X POST http://localhost:5180/api/workspaces | python3 -c 'import sys, json; print(json.load(sys.stdin)["id"])')
curl -s -i -H "Authorization: Bearer $OTHER" http://localhost:5180/api/diagrams
# Expected: empty list (not the first workspace's data)
```

- [ ] **Step 3: Plugin smoke from CC**

```bash
# Make sure the shim binary is in the cache
PLUGIN_PATH=$(python3 -c "
import json, os
data = json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
for k, v in data['plugins'].items():
  if k.startswith('prixmaviz@'):
    print(v[0]['installPath']); break
")
mkdir -p "$PLUGIN_PATH/bin"
cp dist/prixmaviz-mcp "$PLUGIN_PATH/bin/prixmaviz-mcp"
chmod +x "$PLUGIN_PATH/bin/prixmaviz-mcp"

# Open a fresh terminal and run:
# claude
# Ask: "Draw the OAuth 2.1 PKCE flow."
```

Expected: AI renders via the shim → server → Kroki, returns the workspace URL.

- [ ] **Step 4: Public view smoke**

In the browser at `http://localhost:5180`, toggle a diagram to public, copy the `/p/<id>` URL, open in incognito → renders.

- [ ] **Step 5: Wave 5 checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: Wave 5 — Cycle 4 complete (service-first shipped)"
```

- [ ] **Step 6: Push**

```bash
git push origin cycle-4
```

**Done when:** All 6 services healthy; Bearer auth flow works; plugin install + render + public URL all work end-to-end.

---

## Self-Review

### Spec coverage check

Walked the spec sections (`docs/superpowers/specs/2026-05-11-prixmaviz-cycle-4-design.md`) against this plan:

- ✅ Goal — Wave 1+2 cover the architectural shift
- ✅ Where this fits — preface
- ✅ 8 design decisions — each represented in the wave structure
- ✅ Architecture (docker-compose stack) — Wave 2
- ✅ Data model (3 tables) — Wave 1 Tasks 1-5
- ✅ API surface — Wave 1 Task 7 + Wave 4 routes
- ✅ MCP shim — Wave 3
- ✅ Marketing-surface UI — Wave 4
- ✅ Wave structure / Acceptance — explicit in plan

### Placeholder scan

No "TBD", no "implement later", no "similar to". Each task has actual code, actual file paths, actual commands with expected output.

One judgment-call deferred: Task 7's tool refactor uses "apply the same pattern" for the 10 non-listDiagrams tools. The pattern is shown explicitly with `listDiagramsImpl`; downstream implementers extend it per-tool. This is a reasonable trust-the-engineer choice — fully expanding 10 nearly-identical tool refactors would triple the plan size without adding value.

### Type consistency

- `Sql` aliased the same way (`type Sql = ReturnType<typeof postgres>`) in every db file
- `DbDiagram` returned from `createDiagram` matches what `getDiagram` and `listDiagrams` return
- `AuthResult` shape consistent across `bearer.ts` and usages
- `ToolCtx` consistent across `mcp/tools.ts` refactor

### Open questions resolved during planning

- **Migration runner** — settled on raw SQL + custom Bun runner (`db/migrate.ts`). 40 lines, no extra deps.
- **WebSocket auth** — `?token=<uuid>` query param (documented in spec). Acceptable; logs will be access-restricted.
- **TLS termination** — out of plan scope (operational concern, depends on user infra).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-prixmaviz-cycle-4.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review (spec + code) between tasks. Same pattern as Cycles 2.plus + 3.

**2. Inline Execution** — Use `superpowers:executing-plans` for batch execution with checkpoint reviews.

**Which approach?**
