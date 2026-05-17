# @prixmaviz/cli

Command-line interface for [PrixmaViz](https://github.com/michaeldancurtis/prixmaviz). Push DSL source files to a workspace, pull rendered diagrams to disk, list the library, and round-trip whole workspaces as `.pviz` bundles.

## Install

Download a pre-built binary for your platform from the latest GitHub Release (`prixmaviz-darwin-arm64`, `prixmaviz-linux-x64`, etc.) and put it on your `PATH`.

Or build from source:

```sh
bun install
bun --filter @prixmaviz/cli build
# dist/cli.js is now a Node-compatible entrypoint
```

## Configure

```sh
prixmaviz login
# Server URL (e.g. https://prixmaviz.example.com): https://my-server
# Workspace token (UUID): 11111111-2222-3333-4444-555555555555
# Saved PrixmaViz CLI config to /Users/you/Library/Application Support/PrixmaViz/cli-config.json
```

The workspace token is the same UUID the MCP shim caches as `workspace.txt` — anyone with it has full read/write to your workspace.

Config locations:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/PrixmaViz/cli-config.json` |
| Linux | `$XDG_CONFIG_HOME/prixmaviz/config.json` (default: `~/.config/prixmaviz/config.json`) |
| Windows | `%APPDATA%\PrixmaViz\cli-config.json` |

The file is written with mode `0600` on Unix.

## Commands

### `prixmaviz push <file>`

Render a DSL source file on the server and persist it as a diagram.

```sh
prixmaviz push diagram.mmd
prixmaviz push graph.dot --engine graphviz --name "Service topology" --tags infra,prod
```

Engine is detected from the file extension (`.mmd`, `.dot`, `.d2`, `.puml`, `.bytefield`, etc.). Use `--engine` to override.

Prints the resulting slug on success.

### `prixmaviz pull <slug>`

Download a rendered diagram by slug.

```sh
prixmaviz pull service-topology                       # → ./service-topology.svg
prixmaviz pull service-topology --format png          # → ./service-topology.png
prixmaviz pull service-topology --format jpeg --out img/topo.jpg
```

### `prixmaviz list`

Print the workspace library as a table.

```sh
prixmaviz list
prixmaviz list --engine mermaid
prixmaviz list --tag infra
```

### `prixmaviz export-workspace --out <dir>`

Download the current workspace as a `.pviz` bundle.

```sh
prixmaviz export-workspace --out ./backups
# wrote 12345 bytes to ./backups/My Workspace.pviz
```

### `prixmaviz import-workspace <bundle.pviz>`

Upload a `.pviz` bundle. This **always creates a brand-new workspace** owned by the caller — it never modifies an existing one.

```sh
prixmaviz import-workspace ./backup.pviz
# 99999999-8888-7777-6666-555555555555
```

## License

Same as the rest of the repository.
