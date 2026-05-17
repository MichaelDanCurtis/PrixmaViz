/**
 * Group E — Workspace lifecycle for MCP.
 *
 * Adds:
 *   - `create_workspace` — mint a new workspace and claim it for the caller's
 *     token (so `list_workspaces` returns it).
 *   - `list_workspaces`  — enumerate workspaces owned by the caller's token,
 *     with diagram counts. Claims the caller's primary workspace on first
 *     call so pre-migration (NULL `owner_token_hash`) rows become listable.
 *
 * Ownership model (migration 0005): `workspaces.owner_token_hash` stores
 * `sha256(callerToken)`. The caller token IS the bearer token in the auth
 * header, and under the current bearer model the token equals the caller's
 * primary `workspaceId` (see `auth/bearer.ts`). Existing pre-0005 rows have
 * NULL `owner_token_hash`; the first MCP call from a token that owns one
 * claims it.
 *
 * Spec: docs/superpowers/specs/2026-05-15-missing-mcp-tools-design.md §E
 */

import {
  createWorkspace as dbCreateWorkspace,
  setWorkspaceOwner as dbSetWorkspaceOwner,
  claimWorkspaceIfUnowned as dbClaimWorkspaceIfUnowned,
  listWorkspacesByOwner as dbListWorkspacesByOwner,
  hashOwnerToken,
} from "../../db/workspaces";
import type { ToolCtx, ToolDef } from "../tools";

// ───────────────────────────────────────────────────────────────────────────
// E1. create_workspace
// ───────────────────────────────────────────────────────────────────────────

/**
 * Create a new workspace and immediately claim it for the caller. The
 * caller's bearer token (== `ctx.workspaceId` under the current auth model)
 * is hashed and stored in `owner_token_hash` so `list_workspaces` returns
 * the new row on the next call.
 *
 * Note: the new workspace ID is NOT the same as the caller's bearer token.
 * To talk to the new workspace, the caller must use a Bearer header set to
 * the returned `workspaceId`. (Web UI deep-links via `/w/<uuid>`; agents
 * pass the UUID directly.)
 */
async function createWorkspaceImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const name = (args.name as string | undefined) ?? "Untitled workspace";

  const ws = await dbCreateWorkspace(ctx.sql, name);
  const ownerHash = hashOwnerToken(ctx.workspaceId);
  await dbSetWorkspaceOwner(ctx.sql, ws.id, ownerHash);

  return {
    workspaceId: ws.id,
    name: ws.name,
    createdAt: ws.createdAt,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// E2. list_workspaces
// ───────────────────────────────────────────────────────────────────────────

/**
 * Enumerate workspaces owned by the caller.
 *
 * Claim-on-first-call semantics: before the SELECT we run an UPDATE that
 * claims the caller's primary workspace (`ctx.workspaceId`) if and only if
 * it is currently unowned. This is what makes pre-migration anonymous rows
 * show up in `list_workspaces` once an authenticated MCP call touches them.
 *
 * The UPDATE is single-statement / idempotent (see
 * `claimWorkspaceIfUnowned`) so concurrent first-callers can't deadlock or
 * see an inconsistent state.
 */
async function listWorkspacesImpl(_args: Record<string, unknown>, ctx: ToolCtx) {
  const ownerHash = hashOwnerToken(ctx.workspaceId);

  // Best-effort claim — never errors on already-owned rows.
  await dbClaimWorkspaceIfUnowned(ctx.sql, ctx.workspaceId, ownerHash);

  const workspaces = await dbListWorkspacesByOwner(ctx.sql, ownerHash);
  return { workspaces };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const workspaceTools: ToolDef[] = [
  {
    name: "create_workspace",
    description:
      "Create a new workspace. The new workspace is claimed for the caller's token (i.e. the workspace returned in `workspaceId` appears in the caller's next `list_workspaces`). To interact with the new workspace, set the Bearer header on subsequent calls to the returned `workspaceId`.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    },
    run: createWorkspaceImpl,
  },
  {
    name: "list_workspaces",
    description:
      "List workspaces owned by the caller. The caller's primary workspace is claimed on first call (so pre-existing anonymous workspaces become listable). Each entry includes a `diagramCount` so the caller can pick a workspace without a second round-trip.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    run: listWorkspacesImpl,
  },
];

export const workspaceImpls = {
  create_workspace: createWorkspaceImpl,
  list_workspaces: listWorkspacesImpl,
};
