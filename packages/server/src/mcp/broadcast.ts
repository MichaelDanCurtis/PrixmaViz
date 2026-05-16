import type postgres from "postgres";
import type { WsHub } from "../ws/broadcast";
import { getWorkspace as dbGetWorkspace } from "../db/workspaces";

type Sql = ReturnType<typeof postgres>;

/**
 * The minimum context required to emit a workspace broadcast. Both the MCP
 * `ToolCtx` and the HTTP route deps satisfy this shape, so the helper can
 * be called from either layer without dragging in the entire context type.
 */
export interface BroadcastCtx {
  sql: Sql;
  hub: WsHub;
}

/**
 * Read the workspace's current camera + tiles, then emit the canonical
 * `{ type: "workspace", camera, tiles }` event to every WS client
 * authenticated for that workspace.
 *
 * Use this anywhere a tool or HTTP route mutates the workspace (tile move,
 * camera change, focus change, bulk arrange) so the web client gets a
 * single consistent refresh instead of multiple ad-hoc partial events.
 *
 * If the workspace no longer exists (concurrent deletion), the helper is a
 * no-op — there is nothing to broadcast and no remaining subscriber would
 * still be authenticated for it.
 */
export async function broadcastWorkspaceUpdate(
  ctx: BroadcastCtx,
  workspaceId: string,
): Promise<void> {
  const ws = await dbGetWorkspace(ctx.sql, workspaceId);
  if (!ws) return;
  ctx.hub.broadcast(workspaceId, {
    type: "workspace",
    camera: ws.camera,
    tiles: ws.tiles,
  });
}
