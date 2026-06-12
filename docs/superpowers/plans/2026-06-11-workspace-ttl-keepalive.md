# Workspace TTL Keep-Alive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make any authenticated request reset a workspace's idle TTL clock, so active Claude/MCP sessions stop getting silently reaped at 60 minutes.

**Architecture:** Fold the `last_seen_at` touch into the bearer-auth existence check (`UPDATE … RETURNING id` replaces the validating `SELECT`), then remove the now-redundant touch inside `getWorkspace()`. Every authenticated route and the WebSocket upgrade already pass through `authenticate()`, so this single touch covers all activity. No schema migration, no client change.

**Tech Stack:** Bun, `bun:test`, porsager/postgres, TypeScript. Server package: `packages/server`.

**Spec:** `docs/superpowers/specs/2026-06-11-workspace-ttl-keepalive-design.md`

**Test precondition:** DB-backed tests need the test Postgres running at `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:55432/prixmaviz_test`). Start it before running tests if it isn't already up. All commands below run from `packages/server`.

---

### Task 1: `authenticate()` touches `last_seen_at` on every successful auth

**Files:**
- Modify: `packages/server/src/auth/bearer.ts:17-19`
- Test: `packages/server/test/auth/bearer.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("authenticate (Bearer)", …)` block in `packages/server/test/auth/bearer.test.ts` (the file already imports `createWorkspace`, `authenticate`, `setupTestDb` and defines `const db = setupTestDb()`):

```ts
  it("advances last_seen_at on successful auth", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    // Backdate so any touch is unambiguously detectable.
    await sql`UPDATE workspaces SET last_seen_at = now() - interval '2 hours' WHERE id = ${ws.id}`;
    const before = (await sql`SELECT last_seen_at FROM workspaces WHERE id = ${ws.id}`)[0]!.last_seen_at as Date;

    const req = new Request("http://x/api/anything", { headers: { Authorization: `Bearer ${ws.id}` } });
    const result = await authenticate(req, sql);
    expect(result.ok).toBe(true);

    const after = (await sql`SELECT last_seen_at FROM workspaces WHERE id = ${ws.id}`)[0]!.last_seen_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/auth/bearer.test.ts -t "advances last_seen_at"`
Expected: FAIL — `after` equals `before` (current `authenticate()` only does a `SELECT`, so the timestamp never moves).

- [ ] **Step 3: Write minimal implementation**

In `packages/server/src/auth/bearer.ts`, replace the validating `SELECT` (currently lines 17-19):

```ts
  const rows = await sql`SELECT id FROM workspaces WHERE id = ${token}`;
  if (rows.length === 0) return { ok: false, status: 401, message: "unknown workspace" };
  return { ok: true, workspaceId: token };
```

with an `UPDATE … RETURNING` that validates existence and bumps the clock in one round-trip:

```ts
  const rows = await sql`
    UPDATE workspaces SET last_seen_at = now() WHERE id = ${token} RETURNING id
  `;
  if (rows.length === 0) return { ok: false, status: 401, message: "unknown workspace" };
  return { ok: true, workspaceId: token };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/auth/bearer.test.ts`
Expected: PASS — the new test plus all four existing tests (valid token, missing header, unknown token, malformed header) are green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/bearer.ts packages/server/test/auth/bearer.test.ts
git commit -m "fix(server/auth): bump last_seen_at on every authenticated request

Fold the TTL keep-alive touch into authenticate()'s existence check via
UPDATE ... RETURNING. Active MCP sessions whose requests never hit
getWorkspace() no longer get reaped at the idle TTL."
```

---

### Task 2: `getWorkspace()` becomes a pure read (remove redundant touch)

**Files:**
- Modify: `packages/server/src/db/workspaces.ts:50-56`
- Test: `packages/server/test/db/workspaces.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("workspaces repo", …)` block in `packages/server/test/db/workspaces.test.ts` (the file already imports `createWorkspace`, `getWorkspace`, `deleteExpiredWorkspaces`, `setupTestDb` and defines `const db = setupTestDb()`):

```ts
  it("getWorkspace does not advance last_seen_at (pure read)", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    await sql`UPDATE workspaces SET last_seen_at = now() - interval '2 hours' WHERE id = ${ws.id}`;
    const before = (await sql`SELECT last_seen_at FROM workspaces WHERE id = ${ws.id}`)[0]!.last_seen_at as Date;

    await getWorkspace(sql, ws.id);

    const after = (await sql`SELECT last_seen_at FROM workspaces WHERE id = ${ws.id}`)[0]!.last_seen_at as Date;
    expect(after.getTime()).toBe(before.getTime());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/db/workspaces.test.ts -t "pure read"`
Expected: FAIL — `getWorkspace()` currently runs `UPDATE workspaces SET last_seen_at = now()` on every fetch, so `after` is newer than `before`.

- [ ] **Step 3: Write minimal implementation**

In `packages/server/src/db/workspaces.ts`, change `getWorkspace()` from:

```ts
export async function getWorkspace(sql: Sql, id: string): Promise<Workspace | null> {
  const rows = await sql`SELECT * FROM workspaces WHERE id = ${id}`;
  if (rows.length === 0) return null;
  // Update last_seen_at on every fetch
  await sql`UPDATE workspaces SET last_seen_at = now() WHERE id = ${id}`;
  return rowToWorkspace(rows[0]!);
}
```

to:

```ts
export async function getWorkspace(sql: Sql, id: string): Promise<Workspace | null> {
  const rows = await sql`SELECT * FROM workspaces WHERE id = ${id}`;
  if (rows.length === 0) return null;
  // Idle-clock keep-alive lives in authenticate() now (single source of
  // truth: any authenticated request touches last_seen_at). This is a pure read.
  return rowToWorkspace(rows[0]!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/db/workspaces.test.ts`
Expected: PASS — the new pure-read test plus all existing `workspaces repo` tests (create, get-or-null, camera, tiles, cascade delete, reaper past-TTL, reaper public-diagram exemption) are green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/workspaces.ts packages/server/test/db/workspaces.test.ts
git commit -m "refactor(server/db): getWorkspace is a pure read

The last_seen_at touch moved to authenticate() in the prior commit; every
getWorkspace caller already passes through auth, so the in-fetch touch is
redundant. Removing it keeps a single source of truth for the idle clock."
```

---

### Task 3: Reaper regression — an authenticated request rescues a stale workspace

**Files:**
- Test: `packages/server/test/auth/bearer.test.ts`

This proves the end-to-end fix: a workspace that is otherwise past TTL is spared by the reaper after one authenticated request.

- [ ] **Step 1: Add `deleteExpiredWorkspaces` to the test imports**

At the top of `packages/server/test/auth/bearer.test.ts`, change the workspaces import:

```ts
import { createWorkspace } from "../../src/db/workspaces";
```

to:

```ts
import { createWorkspace, deleteExpiredWorkspaces } from "../../src/db/workspaces";
```

- [ ] **Step 2: Write the test**

Add this test inside the `describe("authenticate (Bearer)", …)` block:

```ts
  it("an authenticated request rescues a workspace that is otherwise past TTL", async () => {
    const sql = db.sql();
    const ws = await createWorkspace(sql);
    // Long-idle: the reaper would delete this on its next pass.
    await sql`UPDATE workspaces SET last_seen_at = now() - interval '2 hours' WHERE id = ${ws.id}`;

    // The user makes a single authenticated request.
    const req = new Request("http://x/api/anything", { headers: { Authorization: `Bearer ${ws.id}` } });
    expect((await authenticate(req, sql)).ok).toBe(true);

    // Reaper (60-min TTL) must now spare it.
    const deleted = await deleteExpiredWorkspaces(sql, 60);
    expect(deleted).not.toContain(ws.id);
  });
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/auth/bearer.test.ts -t "rescues"`
Expected: PASS — authenticate() advanced `last_seen_at` to now, so `deleteExpiredWorkspaces(60)` excludes it.

(This is a green-on-arrival regression test guarding the integration: it relies on Task 1's change. If Task 1 were reverted, this test would fail, which is the point.)

- [ ] **Step 4: Run the full server test suite**

Run: `bun test`
Expected: PASS — all server tests green, no regressions from the auth/getWorkspace changes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/test/auth/bearer.test.ts
git commit -m "test(server): authenticated request rescues a past-TTL workspace

End-to-end regression for the TTL keep-alive fix: a single authenticated
request advances last_seen_at enough that the reaper spares the workspace."
```

---

## Done criteria

- `authenticate()` bumps `last_seen_at` via `UPDATE … RETURNING`; existence semantics (`401 "unknown workspace"`) unchanged.
- `getWorkspace()` is a pure read.
- New tests: auth advances the clock; getWorkspace does not; an authed request rescues a past-TTL workspace. Existing reaper tests (stale deleted, public-diagram pinned) still pass.
- `bun test` green in `packages/server`.
- No migration, no shim/client change. Ready to ship with the next server deploy.
