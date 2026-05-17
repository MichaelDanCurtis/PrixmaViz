# PrixmaViz

<p align="center">
  <a href="https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.5.0/prixmaviz-hero-30s.mp4">
    <img src="docs/marketing/prixmaviz-hero.gif" alt="PrixmaViz hero demo — Claude renders an OAuth 2.1 PKCE sequence diagram, you draw a region on it, the AI explains what you pointed at" width="100%" />
  </a>
  <br/>
  <em><a href="https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.5.0/prixmaviz-hero-30s.mp4">▶ Watch the 30-second demo in HD</a></em>
</p>

AI-native diagram tool. 28+ rendering engines (Mermaid, PlantUML, D2, Vega-Lite, TikZ, Graphviz, WaveDrom, Bytefield, …) wrapped behind an MCP server, with annotations, infinite-canvas multi-tile workspace, and a marketing-surface workspace UI. Cycle 4 ships as a hosted service with optional self-host.

## Try the hosted version

Visit **https://prixmaviz.ailuxis.com** — your workspace is created automatically and the URL is bookmarkable. Lose the URL, lose the workspace, so save it somewhere.

## Install

Supported platforms: macOS (Apple Silicon + Intel), Linux (x64 + arm64), Windows (x64). The plugin install itself is tiny (~3 KB launcher script). On your first diagram render, the launcher downloads the matching pre-built shim binary (~60–115 MB depending on platform) from this repo's GitHub Releases and caches it at `~/.cache/prixmaviz/bin/` (POSIX) or `%LOCALAPPDATA%\prixmaviz\bin\` (Windows). Subsequent calls hit the cache — zero network.

### Claude Code

```bash
claude plugins marketplace add MichaelDanCurtis/PrixmaViz
claude plugins install prixmaviz@prixmaviz
```

### Codex CLI

```bash
codex plugin marketplace add MichaelDanCurtis/PrixmaViz
```

Then enable the plugin in `~/.codex/config.toml`:

```toml
[plugins."prixmaviz@prixmaviz"]
enabled = true
```

Restart Codex. Your next prompt that mentions diagrams will route through PrixmaViz.

### VS Code (any MCP-capable extension)

PrixmaViz is a standard stdio MCP server, so any VS Code extension that supports MCP servers can use it — no PrixmaViz-specific extension is needed. The configuration shape is the same for every host; just paste the snippet below into your extension's MCP config and update the absolute path to wherever the shim binary lives on your machine (after a first CC/Codex install it's cached at `~/.cache/prixmaviz/bin/prixmaviz-mcp-0.5.0-<platform>` on POSIX or `%LOCALAPPDATA%\prixmaviz\bin\` on Windows; on a fresh machine, download the matching `prixmaviz-mcp-<platform>` from the [v0.5.0 release](https://github.com/MichaelDanCurtis/PrixmaViz/releases/tag/v0.5.0)).

Universal snippet:

```json
{
  "mcpServers": {
    "prixmaviz": {
      "command": "/absolute/path/to/prixmaviz-mcp",
      "env": {
        "PRIXMAVIZ_REMOTE_URL": "https://prixmaviz.ailuxis.com"
      }
    }
  }
}
```

Where to put it:

- **GitHub Copilot Chat** (VS Code, recent versions with MCP support) → workspace `.vscode/mcp.json` or user `settings.json` under the MCP servers key. See [the Copilot Chat MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers) for the exact path.
- **Cline** → command palette → `Cline: Open MCP Settings` (writes to `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` on macOS).
- **Continue** → edit `~/.continue/config.json` and add the `mcpServers` block under `experimental` (or top-level — depends on Continue version; see [their MCP docs](https://docs.continue.dev/customize/deep-dives/mcp)).
- **Roo Code**, **Cursor** (the IDE), and other MCP-aware tools → each has its own settings UI, but the JSON shape above is what they all expect.

Once configured, restart the extension. Asking the AI for a diagram should now route through PrixmaViz the same way Claude Code and Codex do.

### Both: configuration

The plugin uses `https://prixmaviz.ailuxis.com` by default. To point at your own self-hosted instance, set `PRIXMAVIZ_REMOTE_URL` in the cached `.mcp.json` (`~/.claude/plugins/cache/.../<version>/.mcp.json` or `~/.codex/.tmp/marketplaces/prixmaviz/plugin/.mcp.json`). To run a locally-built binary instead of the released one, set `PRIXMAVIZ_MCP_BIN` to its absolute path.

The AI will now use PrixmaViz whenever you ask for diagrams. Try:

> Show me the TCP handshake.

## CLI

`@prixmaviz/cli` is the scriptable companion to the MCP plugin — push DSL files to your workspace, pull rendered diagrams to disk, list the library, and round-trip whole workspaces as `.pviz` bundles. Useful for CI pipelines, doc-site builds, and shell-driven workflows where you don't want an AI in the loop.

```sh
npm install -g @prixmaviz/cli

prixmaviz login                          # one-time: server URL + workspace token
prixmaviz push docs/diagram.mmd          # render + save (engine auto-detected from extension)
prixmaviz pull service-topology          # download the rendered SVG
prixmaviz list --tag infra               # browse the library
prixmaviz export-workspace --out ./bak   # snapshot the whole workspace to a .pviz bundle
```

Standalone binaries (no Node required) are also published to each `cli-v*` GitHub Release for darwin-arm64, darwin-x64, linux-arm64, linux-x64, and windows-x64.

See [`packages/cli/README.md`](packages/cli/README.md) for the full command reference, config-file paths, and engine auto-detection table.

## Self-host with Docker

```bash
git clone https://github.com/MichaelDanCurtis/PrixmaViz
cd PrixmaViz
cp .env.example .env
docker compose up -d
```

Open `http://localhost:5180` — your workspace is ready. All 6 containers (server, postgres, kroki orchestrator, mermaid, bpmn, excalidraw sidecars) come up automatically. PlantUML is built into the orchestrator.

For production, set:
- `PRIXMAVIZ_PUBLIC_URL` — the canonical URL diagrams share (e.g., `https://prixmaviz.yourcorp.com`)
- `DATABASE_URL` — your external Postgres (omit to use the bundled one)
- TLS terminator in front (nginx, Caddy, Cloudflare, etc.)

### Workspace lifecycle

Anonymous workspaces expire after **1 hour of inactivity**. Activity means any authenticated `/api/*` request — keeping a browser tab open with the workspace loaded is sufficient.

**Pin a workspace indefinitely** by toggling at least one diagram to public (🌐 icon on the tile header). Workspaces with any public diagram are exempt from TTL.

To change the policy, set in your `.env`:
- `PRIXMAVIZ_WORKSPACE_TTL_MINUTES=60` — how long before idle workspaces expire (set 0 to disable)
- `PRIXMAVIZ_REAP_INTERVAL_MINUTES=5` — how often the reaper runs

## Architecture

- **Bun + TypeScript** server: HTTP + WebSocket + 11-tool MCP dispatch, Postgres persistence, Bearer-token workspace auth
- **React + Zustand** web client: infinite canvas with tiles, annotation overlay, public-view toggle, settings panel
- **`@prixmaviz/shim`** binary: thin MCP stdio→HTTP forwarder distributed via the CC plugin (5 platform builds: darwin-arm64/x64, linux-arm64/x64, windows-x64)
- **Postgres 16**: 3 tables (workspaces, diagrams, annotations) with workspace-scoped queries
- **Kroki** for rendering (configurable via `KROKI_URL`)

See `docs/superpowers/specs/2026-05-11-prixmaviz-cycle-4-design.md` for the design rationale.

## Visio (`.vsdx`) support

PrixmaViz natively renders, imports, and exports Microsoft Visio diagrams:

- **Drag-drop** a `.vsdx` onto the canvas to render it (server-side via the `prixmaviz-vsdx` sidecar, which runs `unoserver`/LibreOffice).
- **AI translation** — ask Claude/GPT/etc. "convert this Visio diagram to Mermaid" and the AI calls `analyze_vsdx` to get structured shape data, then generates DSL with `create_diagram`. No server-side LLM is used.
- **Export** any graph diagram as `.vsdx` via the tile menu. Mermaid/D2/Graphviz emit Visio-editable shapes from a ~35-shape stencil. Other engines produce an image-embed `.vsdx`.

Self-host requires the `prixmaviz-vsdx` sidecar from `docker-compose.yaml`. Default upload cap is 5MB (`VSDX_MAX_BYTES`).

## Project structure

```
packages/
  shared/       # TypeScript types shared between server, web, and shim
  server/       # Bun HTTP+WS+MCP server, Postgres repos, hit-testers
  web/          # React webview — InfiniteCanvas, Tile, public view, settings
  shim/         # MCP stdio→HTTP forwarder (compiled to native binary)
plugin/         # Claude Code + Codex CLI plugin (.claude-plugin/, .mcp.json, bin/)
docs/
  marketing/    # Hero video (HyperFrames source) + GIF/poster
  superpowers/
    specs/      # Cycle design specs
    plans/      # Cycle implementation plans
```

## Cycle history

- **Cycle 1** — Foundation: Bun server + Tauri shell + 6-tool MCP + Mermaid IR + .pviz persistence
- **Cycle 2.plus** — Annotations + multi-canvas + initial install path (10 MCP tools)
- **Cycle 3** — Real Claude Code plugin: skills, hooks, slash command, 14 MCP tools
- **Cycle 4** — Service-first architecture: docker-compose stack, Postgres multi-tenant, thin shim binary, marketing-surface UI

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design + implementation history.

## License

MIT — see LICENSE.

PrixmaViz uses Kroki (MIT) for rendering.
