/**
 * Issue #8 / Wave 1A — share-link MCP tools.
 *
 * Three thin wrappers around the Wave 1A DB helpers, with workspace
 * ownership checks and WS broadcasts attached:
 *
 *   - `create_share_link` — { diagramId, permission, expiresAt? } → { token, url }
 *   - `list_share_links` — { diagramId } → { links: [...] }
 *   - `revoke_share_link` — { token } → { ok }
 *
 * Each mutating tool fires the canonical `library:share-*` WS broadcast
 * so cross-tab clients (the per-diagram share modal, the library list)
 * refresh without polling.
 *
 * Ownership model:
 *   - `create_share_link` / `list_share_links` require the caller to own
 *     the diagram (workspaceId-scoped lookup).
 *   - `revoke_share_link` is owner-scoped via `dbRevokeShareLink`'s
 *     `created_by` filter; we deliberately return a "not found" error
 *     when the caller is not the owner so we don't leak token existence.
 *
 * Spec: docs/superpowers/specs/2026-05-16-sharing-and-embedding-design.md
 */

import type { ServerToClient } from "@prixmaviz/shared";
import {
  dbCreateShareLink,
  dbListShareLinks,
  dbRevokeShareLink,
  type SharePermission,
} from "../../db/share-links";
import { getDiagram as dbGetDiagram } from "../../db/diagrams";
import type { ToolCtx, ToolDef } from "../tools";

const SHARE_PERMISSIONS: ReadonlyArray<SharePermission> = ["view", "comment", "edit"];

/**
 * Build the share-route URL helper. Lives here so MCP responses include
 * the same URL format the HTTP routes produce.
 */
function shareUrlFor(token: string): string {
  const base = (process.env.PRIXMAVIZ_PUBLIC_URL ?? "").replace(/\/$/, "");
  return `${base}/s/${token}`;
}

// ───────────────────────────────────────────────────────────────────────────
// create_share_link
// ───────────────────────────────────────────────────────────────────────────

async function createShareLinkImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;
  const permission = args.permission as string;
  const expiresAtRaw = args.expiresAt as string | undefined;

  if (!SHARE_PERMISSIONS.includes(permission as SharePermission)) {
    throw new Error(`permission must be one of: ${SHARE_PERMISSIONS.join(", ")}`);
  }
  let expiresAt: string | null = null;
  if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
    if (typeof expiresAtRaw !== "string") {
      throw new Error("expiresAt must be an ISO-8601 string");
    }
    const t = Date.parse(expiresAtRaw);
    if (Number.isNaN(t)) {
      throw new Error("expiresAt is not a valid ISO-8601 timestamp");
    }
    expiresAt = new Date(t).toISOString();
  }

  // Ownership check FIRST — the Wave 1A DB helper does NOT verify
  // workspace scope on its own; we'd otherwise let an MCP caller create
  // a share for a foreign workspace's diagram.
  const existing = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!existing) throw new Error("diagram not found");

  const { token } = await dbCreateShareLink(
    ctx.sql,
    diagramId,
    permission as SharePermission,
    expiresAt,
    ctx.workspaceId,
  );

  const msg: ServerToClient = {
    type: "library:share-created",
    diagramId,
    token,
    permission: permission as "view" | "comment" | "edit",
  };
  ctx.hub.broadcast(ctx.workspaceId, msg);

  return { token, url: shareUrlFor(token) };
}

// ───────────────────────────────────────────────────────────────────────────
// list_share_links
// ───────────────────────────────────────────────────────────────────────────

async function listShareLinksImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const diagramId = args.diagramId as string;

  // Ownership check — even though `dbListShareLinks` is already keyed by
  // `created_by = ctx.workspaceId`, we want the caller-facing error to
  // be the same regardless of "diagram missing" vs "diagram not owned".
  const existing = await dbGetDiagram(ctx.sql, ctx.workspaceId, diagramId);
  if (!existing) throw new Error("diagram not found");

  const links = await dbListShareLinks(ctx.sql, diagramId, ctx.workspaceId);
  return {
    links: links.map((l) => ({
      id: l.id,
      token: l.token,
      permission: l.permission,
      expiresAt: l.expiresAt,
      createdAt: l.createdAt,
      url: shareUrlFor(l.token),
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// revoke_share_link
// ───────────────────────────────────────────────────────────────────────────

async function revokeShareLinkImpl(args: Record<string, unknown>, ctx: ToolCtx) {
  const token = args.token as string;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("token is required");
  }

  // `dbRevokeShareLink` is owner-scoped (created_by filter), so a
  // foreign-workspace revoke attempt naturally returns 0.
  const n = await dbRevokeShareLink(ctx.sql, token, ctx.workspaceId);
  if (n === 0) {
    // Deliberately uniform error — "share not found" covers both
    // "never existed" and "exists but not yours" so we don't leak
    // token existence to non-owners.
    throw new Error("share not found");
  }

  const msg: ServerToClient = { type: "library:share-revoked", token };
  ctx.hub.broadcast(ctx.workspaceId, msg);

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions
// ───────────────────────────────────────────────────────────────────────────

export const shareTools: ToolDef[] = [
  {
    name: "create_share_link",
    description:
      "Create a public share link for a diagram with a permission tier. `permission` is one of `view`, `comment`, `edit`. Optional `expiresAt` (ISO-8601) auto-revokes the link after the timestamp. Returns the opaque `token` and the full shareable `url`. Broadcasts `library:share-created` over WS.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        permission: { type: "string", enum: ["view", "comment", "edit"] },
        expiresAt: { type: "string" },
      },
      required: ["diagramId", "permission"],
    },
    run: createShareLinkImpl,
  },
  {
    name: "list_share_links",
    description:
      "List all share links the caller's workspace owns for a diagram. Each link includes its token, permission tier, expiry, and a ready-to-paste URL. Workspace-scoped — never returns another workspace's links.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
      },
      required: ["diagramId"],
    },
    run: listShareLinksImpl,
  },
  {
    name: "revoke_share_link",
    description:
      "Revoke (delete) a share link by its opaque token. Caller must own the link (diagram-creator workspace). Broadcasts `library:share-revoked` over WS. Returns `{ ok: true }` on success; throws `share not found` for missing OR non-owned tokens (no existence leak).",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string" },
      },
      required: ["token"],
    },
    run: revokeShareLinkImpl,
  },
];

export const shareImpls = {
  create_share_link: createShareLinkImpl,
  list_share_links: listShareLinksImpl,
  revoke_share_link: revokeShareLinkImpl,
};
