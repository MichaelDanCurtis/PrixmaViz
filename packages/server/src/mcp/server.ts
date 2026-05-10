import { join } from "node:path";
import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CliArgs } from "../args";
import { ensureDirs, resolvePaths } from "../bootstrap";
import { readSettings } from "../settings/io";
import { KrokiClient } from "../kroki/client";
import { DiagramStore } from "../store/diagrams";
import { WsHub } from "../ws/broadcast";
import { TOOLS, dispatchTool } from "./tools";
import { readLock, isLockAlive, writeLock, clearLock } from "./lockfile";
import { forwardCall } from "./forward";
import { AnnotationStore } from "../annotations/store";
import { WorkspaceStore } from "../canvas/store";
import { readWorkspace, writeWorkspace } from "../canvas/io";
import { handleApi } from "../http/routes";
import { DiagramsWatcher } from "../pviz/watch";
import { listPvizEntries } from "../pviz/io";
import { serveStatic } from "../static";
import type { ServerToClient } from "@prixmaviz/shared";

export async function runMcp(args: CliArgs): Promise<void> {
  const paths = resolvePaths(args.projectRoot);
  ensureDirs(paths);

  const settings = await readSettings(paths.settingsFile);
  const krokiBaseUrl = args.krokiUrl ?? settings.krokiUrl;

  const workspace = new WorkspaceStore();
  workspace.load(await readWorkspace(paths.workspaceFile));
  let wsTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistWorkspace = () => {
    if (wsTimer) clearTimeout(wsTimer);
    wsTimer = setTimeout(() => writeWorkspace(paths.workspaceFile, workspace.get()), 500);
  };

  const ctx = {
    paths,
    store: new DiagramStore(),
    annotations: new AnnotationStore(),
    workspace,
    schedulePersistWorkspace,
    kroki: new KrokiClient({ baseUrl: krokiBaseUrl }),
    hub: new WsHub(),
  };

  const lockPath = join(paths.stateDir, "instance.json");

  // If no live UI server, spawn one in this MCP process so the AI has a URL to give the user.
  // This decouples the AI loop from the Tauri .app — the standalone binary is its own UI server.
  const existingLock = readLock(lockPath);
  const liveExisting = existingLock && await isLockAlive(existingLock);
  if (!liveExisting) {
    const watcher = new DiagramsWatcher(paths.diagramsDir, async () => {
      const entries = await listPvizEntries(paths.diagramsDir);
      const msg: ServerToClient = { type: "library", entries };
      ctx.hub.broadcast(msg);
    });
    watcher.start();

    const webDist = process.env.PRIXMAVIZ_WEB_DIST ?? join(import.meta.dir, "../../web/dist");
    const fallbackHtml = `<!doctype html><meta charset="utf-8"><title>PrixmaViz</title><h1>PrixmaViz server up</h1><p>Web bundle missing at <code>${webDist}</code>.</p>`;

    const httpServer = Bun.serve<{ id: string }, undefined>({
      port: 0, // ephemeral
      hostname: "127.0.0.1",
      async fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          const ok = srv.upgrade(req, { data: { id: crypto.randomUUID() } });
          return ok ? undefined : new Response("upgrade failed", { status: 400 });
        }
        const apiResp = await handleApi(req, url, ctx);
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
        open(ws) { ctx.hub.add({ send: (s) => ws.send(s) }); },
        close() {},
        message() {},
      },
    });

    writeLock(lockPath, httpServer.port);
    process.on("SIGINT", () => { clearLock(lockPath); process.exit(0); });
    process.on("SIGTERM", () => { clearLock(lockPath); process.exit(0); });
    process.on("exit", () => { try { clearLock(lockPath); } catch {} });

    const bundleStatus = existsSync(webDist) ? "found" : "missing";
    console.error(`prixmaviz mcp+ui port=${httpServer.port} project=${paths.projectRoot} web=${webDist} (${bundleStatus})`);
  }

  const server = new Server(
    { name: "prixmaviz", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const lock = readLock(lockPath);
    if (lock && await isLockAlive(lock) && lock.pid !== process.pid) {
      const result = await forwardCall(lock, req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    const result = await dispatchTool(req.params.name, req.params.arguments ?? {}, ctx);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
