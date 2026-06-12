# Workspace TTL keep-alive — design

**Date:** 2026-06-11
**Status:** Approved (design); pending implementation plan
**Scope:** `packages/server` (auth + workspace DB layer)

## Problem

The hosted PrixmaViz server reaps workspaces (and their diagrams + annotations)
after `PRIXMAVIZ_WORKSPACE_TTL_MINUTES` of inactivity (default **60 min**). The
reaper keys off `workspaces.last_seen_at`.

The bug: `last_seen_at` is only bumped inside `getWorkspace()`
(`packages/server/src/db/workspaces.ts`), which runs when the **browser** loads
a workspace. The bearer-auth middleware
(`packages/server/src/auth/bearer.ts`) — which every authenticated MCP request
passes through — does **not** touch `last_seen_at`. It only runs a read:

```sql
SELECT id FROM workspaces WHERE id = ${token}
```

Consequence: a user actively creating diagrams through Claude/MCP, with no
browser tab polling, can be reaped at 60 min **despite being active**. The TTL
reaps "no browser activity," not "no activity." Combined with the v0.9.0 shim's
401 auto-recovery, the loss is silent — the shim mints a fresh empty workspace
and the user's diagrams are simply gone.

## Goal

Make the idle clock reflect **genuine activity**: any authenticated request
resets the TTL window. Truly idle workspaces (zero requests for the TTL period)
still get reaped — ephemerality-by-design is preserved; only the definition of
"idle" is corrected.

Non-goals (explicitly out of scope for this change):
- Changing the TTL value or the reaper cadence.
- Warning users before reaping, or surfacing "workspace expired" messaging.
- Persistent workspaces / accounts.
- Full-workspace export/import bundles.

## Approach (chosen: C — fold the touch into the auth check)

Replace the read-only existence check in `authenticate()` with an
`UPDATE … RETURNING`, so the same single round-trip both validates the
workspace exists **and** bumps `last_seen_at`:

```sql
UPDATE workspaces SET last_seen_at = now() WHERE id = ${token} RETURNING id
```

- `0 rows` → workspace does not exist → `401 "unknown workspace"` (unchanged
  semantics).
- `1 row` → authenticated, and the idle clock is reset atomically.

No extra query versus today (auth already pays for one round-trip against that
row), no new failure mode, no migration (`last_seen_at` already exists).

### Approaches considered and rejected

- **A — second query inside `authenticate()`:** keep the `SELECT`, add a
  separate `UPDATE`. Adds a round-trip and mixes a write into a read for no
  benefit over C.
- **B — separate `touchWorkspace()` step in the HTTP layer:** keeps
  `authenticate()` read-only but adds an explicit touch call at every route and
  a second round-trip. More moving parts than C.

## Changes

1. **`packages/server/src/auth/bearer.ts`** — swap the validating `SELECT id`
   for `UPDATE workspaces SET last_seen_at = now() WHERE id = ${token}
   RETURNING id`. The `rows.length === 0 → 401` branch is unchanged.

2. **`packages/server/src/db/workspaces.ts`** — remove the now-redundant
   `UPDATE … SET last_seen_at = now()` inside `getWorkspace()` so "touch = any
   authenticated request" has a single source of truth. `getWorkspace()`
   returns to a pure read.

## Unchanged / preserved invariants

- TTL default stays 60 min; reaper logic (`deleteExpiredWorkspaces`) and the
  public-diagram pinning exemption are untouched.
- Public-view diagrams continue to pin a workspace independently of activity.
- Share-link / unauthenticated viewers do **not** reset the owner's idle clock
  (they don't carry the workspace bearer token; public diagrams already pin
  separately where that's the intent).
- No schema migration.

## Data flow after the change

```
authenticated request
  → authenticate(): UPDATE workspaces SET last_seen_at = now()
                    WHERE id = token RETURNING id
      ├─ 0 rows → 401 unknown workspace
      └─ 1 row  → request proceeds; idle clock reset
reaper (every reapIntervalMinutes)
  → DELETE workspaces WHERE last_seen_at < now() - TTL
                      AND NOT EXISTS (public-view diagram)
```

The 60-min window now means **60 min with zero authenticated requests** —
genuinely idle.

## Error handling

- Existence failure → `401` (unchanged).
- DB/connection error during the `UPDATE` → propagates as a 5xx exactly as the
  previous `SELECT` would have. No new swallowed-error paths; the auth result
  remains a discriminated `AuthResult`.

## Testing

- **`authenticate()` unit tests:**
  - Known workspace → `{ ok: true, workspaceId }` **and** `last_seen_at`
    advanced (assert the row timestamp moved).
  - Unknown UUID → `401 "unknown workspace"`.
  - Missing / malformed `Authorization` header → `401` (existing cases remain
    green).
- **Reaper tests (extend `deleteExpiredWorkspaces` coverage):**
  - A workspace whose `last_seen_at` was bumped within the window survives a
    reap pass.
  - A workspace stale beyond the window is deleted.
  - A stale workspace containing a public-view diagram is **not** deleted
    (pinning still wins).
- **Regression (integration-style):** a sequence of authenticated tool calls
  spread across more than one TTL of simulated wall-clock never gets reaped,
  because each call advances `last_seen_at`.

## Rollout

Single server change, no migration, no client/shim change. Ships with the next
server deploy. Safe to deploy independently of the v0.9.0 plugin release.
