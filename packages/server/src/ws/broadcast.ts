import type { ServerToClient } from "@prixmaviz/shared";

export interface WsMember {
  send(data: string): void;
}

export class WsHub {
  private members = new Set<WsMember>();

  add(m: WsMember): void {
    this.members.add(m);
  }

  remove(m: WsMember): void {
    this.members.delete(m);
  }

  // TODO(cycle-4 follow-up): WsHub.broadcast currently fans out to every connected
  // client regardless of workspace. In a multi-tenant deployment this leaks rendered
  // SVG / IR / annotations / tile changes across workspaces. Either (a) shard the
  // hub by workspaceId, or (b) add workspaceId to every ServerToClient message and
  // have the client filter. Tracked as a Wave 1.5 follow-up.
  broadcast(msg: ServerToClient): void {
    const data = JSON.stringify(msg);
    for (const m of this.members) m.send(data);
  }

  size(): number {
    return this.members.size;
  }
}
