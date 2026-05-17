import { rename } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools";
import { resolveWorkspaceId, workspaceConfigPath } from "./bootstrap";

export const SHIM_VERSION = "0.9.0";

/**
 * Dependencies injected into the call-tool factory. Real callers use Node
 * builtins; tests inject fakes to exercise the 401-recovery flow without
 * touching the filesystem or network.
 */
export interface CallToolDeps {
  /** HTTP fetch — defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /** Mints/loads a workspace id — defaults to `resolveWorkspaceId`. */
  resolveWorkspaceIdFn?: (remoteUrl: string) => Promise<string>;
  /** Moves the cached workspace file aside — defaults to `fs.rename`. */
  renameFn?: (oldPath: string, newPath: string) => Promise<void>;
  /** Reports the path of the cache file — defaults to `workspaceConfigPath`. */
  workspaceConfigPathFn?: () => string;
  /** stderr sink — defaults to `process.stderr.write`. */
  logFn?: (msg: string) => void;
  /** Returns the current unix timestamp (seconds) for backup filenames. */
  nowSecondsFn?: () => number;
}

/**
 * Build a `callTool` function for `remoteUrl` with an initial `workspaceId`.
 *
 * Handles HTTP 401 by bootstrapping a fresh workspace (renaming the stale
 * `workspace.txt` aside as audit trail) and retrying the original request
 * exactly once. Other errors (5xx, network, JSON parse) bubble up verbatim.
 *
 * Concurrent 401s are coalesced via a module-scoped promise mutex so two
 * in-flight calls don't race to mint two fresh workspaces.
 */
export function createCallTool(
  remoteUrl: string,
  initialWorkspaceId: string,
  deps: CallToolDeps = {}
) {
  const fetchFn = deps.fetchFn ?? fetch;
  const resolveWorkspaceIdFn = deps.resolveWorkspaceIdFn ?? resolveWorkspaceId;
  const renameFn = deps.renameFn ?? rename;
  const workspaceConfigPathFn = deps.workspaceConfigPathFn ?? workspaceConfigPath;
  const logFn = deps.logFn ?? ((msg: string) => process.stderr.write(msg));
  const nowSecondsFn = deps.nowSecondsFn ?? (() => Math.floor(Date.now() / 1000));

  let workspaceId = initialWorkspaceId;

  // Coordinates concurrent 401 recovery: multiple in-flight callTool requests
  // can hit a stale workspace at the same time. The first one to see a 401
  // owns this promise; concurrent callers await the same recovery instead of
  // each racing to mint a fresh workspace and clobber workspace.txt.
  let recoveryInProgress: Promise<void> | null = null;

  async function fetchWithAuth(name: string, args: unknown): Promise<Response> {
    const url = `${remoteUrl.replace(/\/$/, "")}/api/mcp/${encodeURIComponent(name)}`;
    return await fetchFn(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${workspaceId}`,
        "Content-Type": "application/json",
        "X-PrixmaViz-Shim-Version": SHIM_VERSION,
      },
      body: JSON.stringify(args ?? {}),
    });
  }

  async function recoverFromStaleWorkspace(): Promise<void> {
    const cfgPath = workspaceConfigPathFn();
    const backup = `${cfgPath}.bak-401-recovery-${nowSecondsFn()}`;
    try {
      await renameFn(cfgPath, backup);
    } catch {
      // Cache file may not exist (e.g. user passed PRIXMAVIZ_WORKSPACE) — fine.
    }
    const old = workspaceId;
    workspaceId = await resolveWorkspaceIdFn(remoteUrl);
    logFn(
      `prixmaviz: workspace 401 detected (was ${old.slice(0, 8)}); bootstrapped fresh workspace ${workspaceId.slice(0, 8)}\n`
    );
  }

  return async function callTool(name: string, args: unknown): Promise<unknown> {
    let resp = await fetchWithAuth(name, args);
    if (resp.status === 401) {
      // Drain the body so the connection can be released before we retry.
      await resp.text().catch(() => undefined);

      if (!recoveryInProgress) {
        recoveryInProgress = recoverFromStaleWorkspace().finally(() => {
          recoveryInProgress = null;
        });
      }
      await recoveryInProgress;

      // Retry exactly once with the (potentially new) workspaceId. If the
      // retry also fails, throw with the retry's status — we never loop.
      resp = await fetchWithAuth(name, args);
    }
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`prixmaviz ${name} failed (HTTP ${resp.status}): ${body.slice(0, 500)}`);
    }
    return await resp.json();
  };
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--print-config-path")) {
    process.stdout.write(workspaceConfigPath() + "\n");
    process.exit(0);
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stderr.write([
      "prixmaviz-mcp — MCP shim for PrixmaViz",
      "",
      "Usage: prixmaviz-mcp",
      "  (starts as stdio MCP server, expects PRIXMAVIZ_REMOTE_URL in env)",
      "",
      "Options:",
      "  --print-config-path    Print workspace token file path and exit",
      "  --version              Print shim version and exit",
      "  --help, -h             Show this help and exit",
      "",
      "Environment:",
      "  PRIXMAVIZ_REMOTE_URL   Remote PrixmaViz server URL (required)",
      "  PRIXMAVIZ_WORKSPACE    Override workspace UUID (bypasses workspace.txt cache)",
      "",
      "Workspace token paths by platform:",
      "  macOS:   ~/Library/Application Support/PrixmaViz/workspace.txt",
      "  Linux:   ~/.config/prixmaviz/workspace.txt",
      "  Windows: %APPDATA%\\PrixmaViz\\workspace.txt",
      "",
    ].join("\n"));
    process.exit(0);
  }

  if (argv.includes("--version")) {
    process.stdout.write(`${SHIM_VERSION}\n`);
    process.exit(0);
  }

  const envRemoteUrl = process.env.PRIXMAVIZ_REMOTE_URL;
  if (!envRemoteUrl) {
    console.error("PRIXMAVIZ_REMOTE_URL is required");
    process.exit(1);
    return;
  }
  const remoteUrl: string = envRemoteUrl;

  const cfgPath = workspaceConfigPath();
  process.stderr.write(`prixmaviz-mcp: workspace token at ${cfgPath}\n`);

  const workspaceId = await resolveWorkspaceId(remoteUrl);
  const callTool = createCallTool(remoteUrl, workspaceId);

  const server = new Server(
    { name: "prixmaviz", version: SHIM_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await callTool(req.params.name, req.params.arguments);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  await server.connect(new StdioServerTransport());
}

// Only auto-start when invoked as the entry point (not when imported by tests).
if (import.meta.main) {
  main().catch((e) => {
    console.error("prixmaviz-mcp error:", e);
    process.exit(1);
  });
}
