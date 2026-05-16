# @prixmaviz/shim

The `prixmaviz-mcp` stdio MCP shim. Bridges an MCP client (Claude Code, Cursor,
etc.) to a remote PrixmaViz server over HTTP.

## Usage

```bash
PRIXMAVIZ_REMOTE_URL=http://localhost:5180 prixmaviz-mcp
```

The shim expects `PRIXMAVIZ_REMOTE_URL` in its environment. It then either
reads a cached workspace UUID from disk or mints a new one against the
remote server, and persists it for subsequent runs.

## CLI flags

| Flag                  | Behavior                                          |
| --------------------- | ------------------------------------------------- |
| `--print-config-path` | Print the workspace token file path and exit.    |
| `--version`           | Print the shim version and exit.                  |
| `--help`, `-h`        | Show usage help (incl. token paths) and exit.     |

`--print-config-path` is the recommended way to locate the token file for
manual recovery — e.g. when the remote workspace has been purged and the
shim is returning 401s.

## Workspace token paths

The shim caches the workspace UUID in `workspace.txt` under a
platform-specific config directory:

| Platform | Path                                                         |
| -------- | ------------------------------------------------------------ |
| macOS    | `~/Library/Application Support/PrixmaViz/workspace.txt`      |
| Linux    | `~/.config/prixmaviz/workspace.txt`                          |
| Windows  | `%APPDATA%\PrixmaViz\workspace.txt` (Roaming, mixed-case)    |

Note that on Windows the binary lives under `%LOCALAPPDATA%\prixmaviz\bin\`
(Local, lowercase) while the token is in Roaming AppData with mixed-case —
two different AppData roots with different capitalisation. Run
`prixmaviz-mcp --print-config-path` to discover the exact token path on any
platform.

## Environment

| Variable               | Required | Purpose                                          |
| ---------------------- | -------- | ------------------------------------------------ |
| `PRIXMAVIZ_REMOTE_URL` | yes      | Remote PrixmaViz server URL.                     |
| `PRIXMAVIZ_WORKSPACE`  | no       | Override workspace UUID; bypasses cached file.   |

## Startup logging

On every startup the shim writes a single line to stderr identifying the
token path:

```
prixmaviz-mcp: workspace token at /Users/<user>/Library/Application Support/PrixmaViz/workspace.txt
```

This goes to stderr to keep stdout clean for JSON-RPC frames over MCP stdio.
