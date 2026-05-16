import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { Workspace, Camera, Tile } from "@prixmaviz/shared";

type Sql = ReturnType<typeof postgres>;

// porsager/postgres' JSONValue type intentionally rejects plain `object` and
// types without an index signature; in practice JSON.stringify accepts them.
// Cast through `unknown` keeps the call sites readable without `any`.
type JSONLike = Parameters<Sql["json"]>[0];

/**
 * Hash a bearer-token / workspace-id into the canonical owner-token hash used
 * by the `workspaces.owner_token_hash` column (added by migration 0005).
 *
 * Standard hex-encoded SHA-256. Kept here next to the only callers — the
 * workspace ownership helpers + the Group E MCP tools — so there's a single
 * source of truth for what "owner hash" means.
 */
export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
  return rowToWorkspace(rows[0]!);
}

export async function getWorkspace(sql: Sql, id: string): Promise<Workspace | null> {
  const rows = await sql`SELECT * FROM workspaces WHERE id = ${id}`;
  if (rows.length === 0) return null;
  // Update last_seen_at on every fetch
  await sql`UPDATE workspaces SET last_seen_at = now() WHERE id = ${id}`;
  return rowToWorkspace(rows[0]!);
}

export async function updateWorkspaceCamera(sql: Sql, id: string, camera: Camera): Promise<void> {
  await sql`
    UPDATE workspaces
    SET camera = ${sql.json(camera as unknown as JSONLike)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateWorkspaceTiles(sql: Sql, id: string, tiles: Tile[]): Promise<void> {
  await sql`
    UPDATE workspaces
    SET tiles = ${sql.json(tiles as unknown as JSONLike)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function updateWorkspaceName(sql: Sql, id: string, name: string | null): Promise<void> {
  await sql`UPDATE workspaces SET name = ${name}, updated_at = now() WHERE id = ${id}`;
}

export async function updateWorkspaceSettings(sql: Sql, id: string, settings: Record<string, unknown>): Promise<void> {
  await sql`
    UPDATE workspaces
    SET settings = ${sql.json(settings as unknown as JSONLike)}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function deleteWorkspace(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM workspaces WHERE id = ${id}`;
}

/**
 * Delete workspaces whose `last_seen_at` is older than `ttlMinutes` ago,
 * EXCEPT workspaces that contain at least one public-view diagram (those are
 * indefinitely "pinned" — toggling a diagram public is the user's signal to
 * keep the workspace).
 *
 * Returns the IDs of deleted workspaces (caller can log).
 */
export async function deleteExpiredWorkspaces(sql: Sql, ttlMinutes: number): Promise<string[]> {
  const rows = await sql`
    DELETE FROM workspaces w
    WHERE w.last_seen_at < now() - make_interval(mins => ${ttlMinutes})
      AND NOT EXISTS (
        SELECT 1 FROM diagrams d WHERE d.workspace_id = w.id AND d.public_view = true
      )
    RETURNING id
  `;
  return rows.map((r) => r.id as string);
}

/**
 * Unconditionally set the `owner_token_hash` on a workspace. Used by
 * `create_workspace` to immediately claim a freshly-minted workspace for
 * the caller's token.
 */
export async function setWorkspaceOwner(
  sql: Sql,
  workspaceId: string,
  ownerHash: string,
): Promise<void> {
  await sql`
    UPDATE workspaces
    SET owner_token_hash = ${ownerHash}
    WHERE id = ${workspaceId}
  `;
}

/**
 * Claim a workspace for an owner-token IFF it is currently unowned.
 * Single-statement / idempotent — re-running on an already-claimed row
 * is a no-op, so two concurrent first-callers from the same token simply
 * race to the same final state with no error.
 *
 * Returns `true` when the claim took effect (row updated), `false` if
 * the workspace was already owned (by anyone — same hash or a different
 * one). Callers don't currently inspect the return; it's surfaced for
 * tests + future audit logging.
 */
export async function claimWorkspaceIfUnowned(
  sql: Sql,
  workspaceId: string,
  ownerHash: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE workspaces
    SET owner_token_hash = ${ownerHash}
    WHERE id = ${workspaceId} AND owner_token_hash IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Row shape returned by `listWorkspacesByOwner`. Includes a precomputed
 * `diagramCount` (sub-select on diagrams) so the MCP tool can return it
 * without a second round-trip.
 */
export interface WorkspaceSummary {
  id: string;
  name: string | null;
  diagramCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Enumerate workspaces owned by the given token hash, newest first.
 *
 * `owner_token_hash` is the SHA-256 hex of the caller's bearer token (see
 * `hashOwnerToken`). Workspaces with NULL `owner_token_hash` are excluded
 * — they are anonymous pre-migration rows that have never been claimed,
 * and the spec calls for claim-on-first-call to handle them BEFORE we
 * reach this query (see the MCP `list_workspaces` impl).
 */
export async function listWorkspacesByOwner(
  sql: Sql,
  ownerHash: string,
): Promise<WorkspaceSummary[]> {
  const rows = await sql`
    SELECT
      w.id,
      w.name,
      w.created_at,
      w.updated_at,
      (SELECT COUNT(*) FROM diagrams d WHERE d.workspace_id = w.id)::int AS diagram_count
    FROM workspaces w
    WHERE w.owner_token_hash = ${ownerHash}
    ORDER BY w.updated_at DESC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    diagramCount: row.diagram_count as number,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  }));
}
