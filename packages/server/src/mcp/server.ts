import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CliArgs } from "../args";
import { ensureDirs, resolvePaths } from "../bootstrap";
import { KrokiClient } from "../kroki/client";
import { DiagramStore } from "../store/diagrams";
import { WsHub } from "../ws/broadcast";
import { TOOLS, dispatchTool } from "./tools";
import { readLock, isLockAlive } from "./lockfile";
import { forwardCall } from "./forward";
import { AnnotationStore } from "../annotations/store";
import { WorkspaceStore } from "../canvas/store";
import { readWorkspace, writeWorkspace } from "../canvas/io";

export async function runMcp(args: CliArgs): Promise<void> {
  const paths = resolvePaths(args.projectRoot);
  ensureDirs(paths);

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
    kroki: new KrokiClient({ baseUrl: args.krokiUrl }),
    hub: new WsHub(),
  };

  const server = new Server(
    { name: "prixmaviz", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const lockPath = join(paths.stateDir, "instance.json");

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const lock = readLock(lockPath);
    if (lock && await isLockAlive(lock)) {
      const result = await forwardCall(lock, req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    const result = await dispatchTool(req.params.name, req.params.arguments ?? {}, ctx);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
