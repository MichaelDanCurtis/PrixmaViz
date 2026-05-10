import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./args";
import { ensureDirs, resolvePaths } from "./bootstrap";
import { readSettings } from "./settings/io";
import { writeLock, clearLock } from "./mcp/lockfile";
import { handleApi } from "./http/routes";
import { KrokiClient } from "./kroki/client";
import { DiagramStore } from "./store/diagrams";
import { AnnotationStore } from "./annotations/store";
import { WorkspaceStore } from "./canvas/store";
import { readWorkspace, writeWorkspace } from "./canvas/io";
import { DiagramsWatcher } from "./pviz/watch";
import { listPvizEntries } from "./pviz/io";
import { serveStatic } from "./static";
import { WsHub } from "./ws/broadcast";
import type { ServerToClient } from "@prixmaviz/shared";

const args = parseArgs(process.argv.slice(2));

if (args.mcpMode) {
  await import("./mcp/server").then((m) => m.runMcp(args));
} else {
  await runServer();
}

async function runServer(): Promise<void> {
  const paths = resolvePaths(args.projectRoot);
  ensureDirs(paths);

  const settings = await readSettings(paths.settingsFile);
  const krokiBaseUrl = args.krokiUrl ?? settings.krokiUrl;
  const kroki = new KrokiClient({ baseUrl: krokiBaseUrl });
  const store = new DiagramStore();
  const annotations = new AnnotationStore();
  const hub = new WsHub();

  const workspace = new WorkspaceStore();
  workspace.load(await readWorkspace(paths.workspaceFile));

  let wsPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistWorkspace = () => {
    if (wsPersistTimer) clearTimeout(wsPersistTimer);
    wsPersistTimer = setTimeout(() => writeWorkspace(paths.workspaceFile, workspace.get()), 500);
  };

  const watcher = new DiagramsWatcher(paths.diagramsDir, async () => {
    const entries = await listPvizEntries(paths.diagramsDir);
    const msg: ServerToClient = { type: "library", entries };
    hub.broadcast(msg);
  });
  watcher.start();

  const webDist = process.env.PRIXMAVIZ_WEB_DIST ?? join(import.meta.dir, "../../web/dist");
  const fallbackHtml = `<!doctype html><meta charset="utf-8"><title>PrixmaViz</title><h1>PrixmaViz server up</h1><p>Web bundle missing at <code>${webDist}</code>.</p>`;

  const server = Bun.serve<{ id: string }, undefined>({
    port: args.port,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const ok = srv.upgrade(req, { data: { id: crypto.randomUUID() } });
        return ok ? undefined : new Response("upgrade failed", { status: 400 });
      }

      const apiResp = await handleApi(req, url, { paths, store, annotations, workspace, schedulePersistWorkspace, kroki, hub });
      if (apiResp) return apiResp;

      if (req.method === "GET") {
        return serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, {
          webDist,
          fallbackHtml,
        });
      }

      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        hub.add({ send: (s) => ws.send(s) });
      },
      close(ws) {
        // simple impl: per-socket member ref tracking deferred to v2
      },
      message() {
        // open/patch via WS deferred to v2; HTTP suffices in v1
      },
    },
  });

  const lockPath = join(paths.stateDir, "instance.json");
  writeLock(lockPath, server.port);
  process.on("SIGINT", () => { clearLock(lockPath); process.exit(0); });
  process.on("SIGTERM", () => { clearLock(lockPath); process.exit(0); });

  const bundleStatus = existsSync(webDist) ? "found" : "missing";
  const mode = `port=${server.port} project=${paths.projectRoot}`;
  console.log(JSON.stringify({ ready: true, port: server.port }));
  console.error(`prixmaviz server ${mode} web=${webDist} (${bundleStatus})`);
}
