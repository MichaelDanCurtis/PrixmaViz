# PrixmaViz

AI-native diagram tool. 28+ rendering engines (Mermaid, PlantUML, D2, Vega-Lite, TikZ, Graphviz, WaveDrom, Bytefield, …) wrapped behind an MCP server, with annotations and an infinite-canvas multi-tile workspace. Built to be a real visual collaborator for AI agents — the diagram and the conversation are co-equal mediums.

## Architecture

- **Bun + TypeScript** server: HTTP + WebSocket + 13-tool MCP, renders via Kroki, persists to `.pviz` per-project
- **React + Zustand** webview: infinite canvas with tiles, annotation overlay, region/pin/tag tools
- **Tauri 2** desktop wrapper: ships the binary as a sidecar, hosts the webview
- **Kroki** for rendering (configurable — default `https://kroki.io`, can point at local Docker for privacy)

## Install for Claude Code

PrixmaViz integrates as a Claude Code plugin so the AI can render diagrams directly into your PrixmaViz window during conversations.

### Quick install

1. Download the latest `PrixmaViz.app.dmg` from the [Releases page](https://github.com/MichaelDanCurtis/PrixmaViz/releases).
2. Drag PrixmaViz.app to /Applications and open it.
3. On first launch, click **Install** in the dialog.
4. Restart Claude Code (or start a new session).

The AI will now use PrixmaViz whenever you ask for diagrams. Try:

> Show me the TCP handshake.

### What gets installed

- A local marketplace `prixmaviz-local` registered with Claude Code via `claude plugins marketplace add`
- The plugin itself installed via `claude plugins install prixmaviz@prixmaviz-local`
- Plugin payload at `~/.claude/plugins/cache/prixmaviz-local/prixmaviz/<version>/` containing:
  - `.claude-plugin/plugin.json` — manifest
  - `.mcp.json` — MCP server entry (auto-discovered by CC)
  - `skills/` — diagram-rendering, annotation-followup, diagram-review, diagram-evolve
  - `hooks/` — SessionStart hook priming the AI for visual collaboration
  - `commands/` — `/prixmaviz` slash command
  - `bin/prixmaviz` — the bundled MCP server binary

### Settings

Open **PrixmaViz > Settings…** in the menu bar to configure:

- **Kroki URL** — point at a local Kroki instance (`http://localhost:18000`) or your organization's deployment to keep diagram source on-machine. The default `https://kroki.io` is public — use only for non-sensitive content.

### Uninstall

**PrixmaViz > Uninstall plugin** removes the plugin from Claude Code via `claude plugins uninstall` and cleans up the plugin cache directory. Saved diagrams in your projects' `.prixmaviz/` directories are not affected.

## Build from source

```bash
# Install dependencies
bun install

# Build the standalone binary (for CLI use or sidecar)
bun run build:bin

# Build the Tauri .app bundle
bun run build:tauri
```

## Usage as a standalone MCP server

If you don't want the GUI, you can use just the binary:

```bash
# Manual MCP registration (writes to ~/.claude.json)
claude mcp add prixmaviz /path/to/dist/prixmaviz --mcp --project-root "$PWD"
```

This skips the plugin install but loses the skills, hooks, and slash command. The AI sees the 13 MCP tools but doesn't get the priming context that makes diagram rendering automatic.

## Project structure

```
packages/
  shared/       # TypeScript types shared between server and web (no runtime)
  server/       # Bun HTTP+WS+MCP server, IR, renderers, hit-testers, persistence
  web/          # React webview — InfiniteCanvas, Tile, AnnotationLayer, etc.
src-tauri/      # Rust + Tauri 2 desktop wrapper, install/uninstall logic
docs/
  superpowers/
    specs/      # Cycle design specs (one per cycle)
    plans/      # Cycle implementation plans (one per cycle)
```

## Cycle history

- **Cycle 1** — Foundation: Bun server + Tauri shell + 6-tool MCP + Mermaid IR + .pviz persistence + library UI
- **Cycle 2.plus** — Annotations + multi-canvas + initial install path (10 MCP tools)
- **Cycle 3** — Real Claude Code plugin: skills, hooks, slash command, 13 MCP tools, custom Kroki URL, image export, uninstall

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design + implementation history.

## License

Code: MIT (see LICENSE).
PrixmaViz uses Kroki (MIT) for rendering and bundles no third-party engine binaries directly.
