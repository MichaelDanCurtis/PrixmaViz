/**
 * Issue #8 / Wave 1A — share_links DB helpers.
 *
 * Five helpers wrap the share_links table introduced by migration 0010:
 *
 *   - dbCreateShareLink     — insert a new link, return token + id.
 *   - dbListShareLinks      — list owner's links for a diagram.
 *   - dbGetShareByToken     — fetch a link by token (no expiry check).
 *   - dbResolveShareToken   — fetch + check expiry; null on expired/missing.
 *   - dbRevokeShareLink     — owner-scoped DELETE, returns count.
 *
 * The HTTP layer attaches additional concerns (auth, 410-vs-404 status,
 * Referrer-Policy headers) on top of these. Keeping DB-level helpers pure
 * means the MCP tools can call them directly without re-implementing the
 * query.
 *
 * Token format: `s_` + 32 hex chars from a random UUID. Matches the
 * URL-safe character class accepted by the public-view routes
 * (`[a-z0-9_-]+`), so the same regex covers both `/p/:id` and `/s/:token`.
 * 128 bits of entropy is plenty for a shared-link surface; collisions are
 * statistically impossible. The `s_` prefix exists so a stray token
 * pasted into a chat is recognizable as a share rather than a UUID.
 *
 * Spec: docs/superpowers/specs/2026-05-16-sharing-and-embedding-design.md
 */

import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/** Permission tier on a share link. Mirrors the SQL CHECK constraint. */
export type SharePermission = "view" | "comment" | "edit";

export interface DbShareLink {
  id: string;
  diagramId: string;
  token: string;
  permission: SharePermission;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
}

interface ShareLinkRow {
  id: string;
  diagram_id: string;
  token: string;
  permission: string;
  expires_at: Date | null;
  created_at: Date;
  created_by: string;
}

function rowToShareLink(row: ShareLinkRow): DbShareLink {
  return {
    id: row.id,
    diagramId: row.diagram_id,
    token: row.token,
    permission: row.permission as SharePermission,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  };
}

/**
 * Generate a fresh share token. `s_` prefix + 32 hex chars stripped from
 * a UUID. Reads as a single URL path segment under the existing
 * `[a-z0-9_-]+` regex used by `/p/:id` and now `/s/:token`.
 */
function newShareToken(): string {
  return `s_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Insert a new share link. Returns the new row's `id` and the generated
 * `token` so the caller can echo the public URL back to the client.
 *
 * Does NOT check whether the diagram exists or belongs to `createdBy`;
 * the FK constraint on `diagram_id` will fail with `23503` if the
 * diagram is gone, and the caller is responsible for the ownership
 * check before invoking this helper.
 */
export async function dbCreateShareLink(
  sql: Sql,
  diagramId: string,
  permission: SharePermission,
  expiresAt: string | null,
  createdBy: string,
): Promise<{ id: string; token: string }> {
  const token = newShareToken();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO share_links (diagram_id, token, permission, expires_at, created_by)
    VALUES (
      ${diagramId},
      ${token},
      ${permission},
      ${expiresAt},
      ${createdBy}
    )
    RETURNING id
  `;
  return { id: rows[0]!.id, token };
}

/**
 * List the share links a workspace owns for one of its diagrams.
 *
 * Owner-scoped: a workspace can only see its OWN shares. Even if a
 * sibling workspace also shared the same diagram (which can't happen
 * today because diagrams are workspace-scoped, but a future
 * multi-workspace world would allow), this query never returns rows
 * created by anyone else.
 */
export async function dbListShareLinks(
  sql: Sql,
  diagramId: string,
  createdBy: string,
): Promise<DbShareLink[]> {
  const rows = await sql<ShareLinkRow[]>`
    SELECT id, diagram_id, token, permission, expires_at, created_at, created_by
      FROM share_links
     WHERE diagram_id = ${diagramId}
       AND created_by = ${createdBy}
     ORDER BY created_at DESC
  `;
  return rows.map(rowToShareLink);
}

/**
 * Fetch a share link by its opaque token, NO expiry check applied.
 * Used by the management API (revoke, list-by-id lookups). For public
 * GET routes, use {@link dbResolveShareToken} which adds the expiry gate.
 *
 * Returns null when the token doesn't exist.
 */
export async function dbGetShareByToken(
  sql: Sql,
  token: string,
): Promise<{ diagramId: string; permission: SharePermission; expiresAt: string | null } | null> {
  const rows = await sql<ShareLinkRow[]>`
    SELECT id, diagram_id, token, permission, expires_at, created_at, created_by
      FROM share_links
     WHERE token = ${token}
  `;
  if (rows.length === 0) return null;
  const r = rowToShareLink(rows[0]!);
  return {
    diagramId: r.diagramId,
    permission: r.permission,
    expiresAt: r.expiresAt,
  };
}

/**
 * Resolve a share token for public access: returns the diagram + permission
 * tier ONLY if the token exists AND has not expired.
 *
 * `expires_at` is checked in SQL (`now() < expires_at OR expires_at IS NULL`)
 * so a clock-skewed Node process can't accidentally serve an expired link.
 *
 * Returns null when the token is missing OR expired — the HTTP layer
 * distinguishes the two (404 vs 410) by also calling
 * {@link dbGetShareByToken} when this returns null.
 */
export async function dbResolveShareToken(
  sql: Sql,
  token: string,
): Promise<{ diagramId: string; permission: SharePermission } | null> {
  const rows = await sql<ShareLinkRow[]>`
    SELECT id, diagram_id, token, permission, expires_at, created_at, created_by
      FROM share_links
     WHERE token = ${token}
       AND (expires_at IS NULL OR expires_at > now())
  `;
  if (rows.length === 0) return null;
  const r = rowToShareLink(rows[0]!);
  return { diagramId: r.diagramId, permission: r.permission };
}

/**
 * Owner-scoped DELETE. Returns the number of rows actually deleted (0 if
 * the token doesn't exist OR belongs to a different workspace). The
 * caller distinguishes "not found" from "not yours" — but we deliberately
 * keep both at 404 for the management API so we don't leak token
 * existence to non-owners.
 */
export async function dbRevokeShareLink(
  sql: Sql,
  token: string,
  createdBy: string,
): Promise<number> {
  const rows = await sql`
    DELETE FROM share_links
     WHERE token = ${token}
       AND created_by = ${createdBy}
  `;
  return rows.count ?? 0;
}
