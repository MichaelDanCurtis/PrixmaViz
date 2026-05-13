import { loadConfig } from "./bootstrap";
import { runMigrations } from "./db/migrate";
import { getDb } from "./db/client";
import { KrokiClient } from "./kroki/client";
import { WsHub, type WsMember } from "./ws/broadcast";
import { handleApi } from "./http/routes";
import { serveStatic } from "./static";
import { authenticate } from "./auth/bearer";
import { existsSync } from "node:fs";

interface WsData {
  id: string;
  workspaceId: string | null;
  member?: WsMember;
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.error(`prixmaviz starting — public=${config.publicUrl}`);

  await runMigrations(config.databaseUrl, config.migrationsDir);

  const sql = getDb(config.databaseUrl);
  const kroki = new KrokiClient({ baseUrl: config.krokiUrl });
  const hub = new WsHub();
  const deps = { sql, kroki, hub };

  const bundleStatus = existsSync(config.webDist) ? "found" : "missing";
  const fallbackHtml = `<!doctype html><meta charset="utf-8"><title>PrixmaViz</title><h1>PrixmaViz</h1><p>Web bundle missing at <code>${config.webDist}</code>.</p>`;

  const server = Bun.serve<WsData>({
    hostname: config.bindHost,
    port: config.bindPort,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        // Authenticate the WebSocket upgrade against the bearer token the
        // web client passes as ?token=<workspaceId>. Connections without a
        // valid token are still allowed (workspaceId = null) but receive
        // only globally-scoped broadcasts (currently none). WsHub scopes
        // every workspace-bearing broadcast by workspaceId from here on.
        const token = url.searchParams.get("token");
        let wsWorkspaceId: string | null = null;
        if (token) {
          const fakeReq = new Request(req.url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const result = await authenticate(fakeReq, sql);
          if (result.ok) wsWorkspaceId = result.workspaceId;
        }
        const ok = srv.upgrade(req, {
          data: { id: crypto.randomUUID(), workspaceId: wsWorkspaceId },
        });
        return ok ? undefined : new Response("upgrade failed", { status: 400 });
      }
      const apiResp = await handleApi(req, url, deps);
      if (apiResp) return apiResp;
      if (req.method === "GET") {
        return serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, {
          webDist: config.webDist,
          fallbackHtml,
        });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const member: WsMember = {
          send: (s: string) => ws.send(s),
          workspaceId: ws.data.workspaceId,
        };
        ws.data.member = member;
        hub.add(member);
      },
      close(ws) {
        const member = ws.data.member;
        if (member) hub.remove(member);
      },
      message() {},
    },
  });

  // Workspace TTL reaper. Runs every `reapIntervalMinutes`, deletes workspaces
  // with no activity for `workspaceTtlMinutes` UNLESS they contain a public
  // diagram. Set PRIXMAVIZ_WORKSPACE_TTL_MINUTES=0 to disable entirely.
  if (config.workspaceTtlMinutes > 0) {
    const { deleteExpiredWorkspaces } = await import("./db/workspaces");
    const intervalMs = config.reapIntervalMinutes * 60 * 1000;
    const reap = async () => {
      try {
        const ids = await deleteExpiredWorkspaces(sql, config.workspaceTtlMinutes);
        if (ids.length > 0) {
          console.error(`reaper: deleted ${ids.length} expired workspaces`);
        }
      } catch (e) {
        console.error("reaper failed:", e);
      }
    };
    setInterval(reap, intervalMs);
    // Run once on startup so a long-down server catches up immediately.
    void reap();
  }

  console.error(`prixmaviz listening on http://${config.bindHost}:${server.port} web=${config.webDist} (${bundleStatus})`);
}

main().catch((e) => {
  console.error("prixmaviz failed to start:", e);
  process.exit(1);
});
