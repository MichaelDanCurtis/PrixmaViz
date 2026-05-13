# PrixmaViz

<p align="center">
  <video src="https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.5.0/prixmaviz-hero-30s.mp4" autoplay muted loop playsinline width="100%"></video>
  <br/>
  <em><a href="https://github.com/MichaelDanCurtis/PrixmaViz/releases/download/v0.5.0/prixmaviz-hero-30s.mp4">▶ Watch the 30-second demo</a></em>
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

### Both: configuration

The plugin uses `https://prixmaviz.ailuxis.com` by default. To point at your own self-hosted instance, set `PRIXMAVIZ_REMOTE_URL` in the cached `.mcp.json` (`~/.claude/plugins/cache/.../<version>/.mcp.json` or `~/.codex/.tmp/marketplaces/prixmaviz/src-tauri/resources/plugin/.mcp.json`). To run a locally-built binary instead of the released one, set `PRIXMAVIZ_MCP_BIN` to its absolute path.

The AI will now use PrixmaViz whenever you ask for diagrams. Try:

> Show me the TCP handshake.

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

## Project structure

```
packages/
  shared/       # TypeScript types shared between server, web, and shim
  server/       # Bun HTTP+WS+MCP server, Postgres repos, hit-testers
  web/          # React webview — InfiniteCanvas, Tile, public view, settings
  shim/         # MCP stdio→HTTP forwarder (compiled to native binary)
src-tauri/      # Tauri 2 desktop wrapper (optional, for self-hosted installers)
docs/
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
