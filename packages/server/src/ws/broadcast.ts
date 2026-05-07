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

  broadcast(msg: ServerToClient): void {
    const data = JSON.stringify(msg);
    for (const m of this.members) m.send(data);
  }

  size(): number {
    return this.members.size;
  }
}
