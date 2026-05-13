# Installing PrixmaViz across Claude hosts

PrixmaViz works in any host that can run an MCP stdio server. The plugin shim is the same binary across hosts; what differs is how the host discovers it.

## Claude Code (terminal — `claude` CLI)

**Native plugin install.** This is the fullest integration: skills + hooks + slash command + MCP tools all load.

```bash
# Local-file install (during development)
claude plugins marketplace add /path/to/PrixmaViz/src-tauri/resources/plugin/.claude-plugin/marketplace.json
claude plugins install prixmaviz@prixmaviz-local

# Or from GitHub (once binaries are published with releases)
claude plugins marketplace add https://github.com/MichaelDanCurtis/PrixmaViz#main:src-tauri/resources/plugin
claude plugins install prixmaviz@prixmaviz-local
```

**Override the remote URL** to point at a self-hosted instance:

```bash
export PRIXMAVIZ_REMOTE_URL=http://localhost:5180   # or your prod URL
claude
```

The `.mcp.json` declares `PRIXMAVIZ_REMOTE_URL=${PRIXMAVIZ_REMOTE_URL:-https://prixmaviz.ailuxis.com}`, so a shell-level env var wins and the hosted URL is the fallback.

**Verify:**

```bash
claude mcp list
# Look for: plugin:prixmaviz:prixmaviz  /path/to/prixmaviz-mcp  - ✓ Connected
```

## Claude Code (IDE extensions — VS Code, JetBrains)

These wrap the same `claude` CLI under the hood, so the plugin install above applies. No separate config.

## Claude Desktop (`Claude.app`)

**Plugin system NOT available.** Claude Desktop reads MCP servers from `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). It doesn't use marketplaces, doesn't load plugin skills/hooks/slash commands.

**Manual MCP install** — add this entry under `mcpServers`:

```jsonc
{
  "mcpServers": {
    // ... existing servers
    "prixmaviz": {
      "command": "/path/to/prixmaviz-mcp",
      "env": {
        "PRIXMAVIZ_REMOTE_URL": "https://prixmaviz.ailuxis.com"
      }
    }
  }
}
```

Where `/path/to/prixmaviz-mcp` is the shim binary for your platform:

| Platform | Binary |
|---|---|
| macOS Apple Silicon | `prixmaviz-mcp-darwin-arm64` |
| macOS Intel | `prixmaviz-mcp-darwin-x64` |
| Linux x64 | `prixmaviz-mcp-linux-x64` |
| Linux ARM | `prixmaviz-mcp-linux-arm64` |
| Windows | `prixmaviz-mcp-windows-x64.exe` |

Built from source via `cd packages/shim && bun run build:all` (outputs to `dist/`).

**Restart Claude Desktop** after editing the config. Verify in **Settings → Developer → MCP Servers** that `prixmaviz` is listed.

**Caveat:** Claude Desktop sees the 11 MCP tools but **does not** receive the SessionStart context that primes the AI to use PrixmaViz for diagrams. You'll need to explicitly ask: "Use PrixmaViz to render a sequence diagram of …" — the AI then calls the tools. Once the conversation establishes the pattern, it'll keep using them.

## Codex CLI / OpenAI agents

Future cycle. The shim's stdio JSON-RPC is MCP-spec compliant, so any MCP-aware host should work, but the install surface (and especially the skills/hooks priming) differs per host.

## Self-host backend (any host above)

If you don't want to use the hosted `prixmaviz.ailuxis.com`, stand up your own:

```bash
docker compose up -d
export PRIXMAVIZ_REMOTE_URL=http://localhost:5180
```

See [docs/deploy.md](./deploy.md) for production deployment.

## Verifying end-to-end

From any host, ask the AI:

> Draw the TCP three-way handshake.

Expected flow:
1. AI calls `render_dsl` (PlantUML/Mermaid) → shim forwards to server → server hits Kroki → returns SVG
2. AI calls `get_view_url` → returns workspace URL
3. AI tells you to open the URL in a browser → you see the diagram + can annotate it
4. Subsequent edits use `apply_patch` against the same `diagramId` so the tile updates in place

If the AI doesn't auto-pick PrixmaViz (Claude Desktop), prefix with "Use PrixmaViz to draw …" until it sticks.
