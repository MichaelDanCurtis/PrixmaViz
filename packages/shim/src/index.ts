import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools";
import { resolveWorkspaceId, workspaceConfigPath } from "./bootstrap";

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
    process.stdout.write("0.6.0\n");
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

  async function callTool(name: string, args: unknown) {
    const url = `${remoteUrl.replace(/\/$/, "")}/api/mcp/${encodeURIComponent(name)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${workspaceId}`,
        "Content-Type": "application/json",
        "X-PrixmaViz-Shim-Version": "0.6.0",
      },
      body: JSON.stringify(args ?? {}),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`prixmaviz ${name} failed (HTTP ${resp.status}): ${body.slice(0, 500)}`);
    }
    return await resp.json();
  }

  const server = new Server(
    { name: "prixmaviz", version: "0.6.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await callTool(req.params.name, req.params.arguments);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error("prixmaviz-mcp error:", e);
  process.exit(1);
});
