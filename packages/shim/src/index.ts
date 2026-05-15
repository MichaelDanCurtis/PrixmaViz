import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools";
import { resolveWorkspaceId } from "./bootstrap";

async function main() {
  const envRemoteUrl = process.env.PRIXMAVIZ_REMOTE_URL;
  if (!envRemoteUrl) {
    console.error("PRIXMAVIZ_REMOTE_URL is required");
    process.exit(1);
    return;
  }
  const remoteUrl: string = envRemoteUrl;
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
