import type { ServerToClient } from "@prixmaviz/shared";

export interface WsMember {
  send(data: string): void;
  workspaceId: string | null;
}

export class WsHub {
  private members = new Set<WsMember>();

  add(m: WsMember): void {
    this.members.add(m);
  }

  remove(m: WsMember): void {
    this.members.delete(m);
  }

  /**
   * Send `msg` to every connection authenticated for `workspaceId`.
   *
   * Pass `null` to broadcast to every connected client regardless of
   * workspace (legacy / system-wide events only — prefer the scoped form).
   * Connections that arrived without a valid bearer token have
   * `workspaceId === null` and therefore receive only `null`-scoped
   * broadcasts (currently none).
   */
  broadcast(workspaceId: string | null, msg: ServerToClient): void {
    const data = JSON.stringify(msg);
    for (const m of this.members) {
      if (workspaceId === null || m.workspaceId === workspaceId) {
        try { m.send(data); } catch { /* client likely disconnected */ }
      }
    }
  }

  size(): number {
    return this.members.size;
  }
}
