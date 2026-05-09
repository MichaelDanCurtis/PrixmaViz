# Cycle 3 Research: CC Plugin + MCP Config Locations

> **Status:** Wave 1 research document. Deleted at end of Wave 1 after T2-T6 consume it.
> **Machine:** michaelcurtis @ Darwin 25.4.0
> **Date:** 2026-05-09

---

## 1. Claude Code binary location

```
/Users/michaelcurtis/.nvm/versions/node/v24.8.0/bin/claude
```

Installed via npm/nvm. `which claude` returns this path. All `claude` invocations below resolve here.

---

## 2. MCP Config Path

### The file CC writes to

```
/Users/michaelcurtis/.claude.json
```

**Confirmed:** `~/.claude.json` exists (`-rw-------`, 131 KB). `~/.config/claude` does NOT exist on this machine.

`claude mcp add <name> <command> [args]` writes into the `mcpServers` key inside `~/.claude.json`.

### Format of a `mcpServers` entry

`~/.claude.json` is a large JSON file with many CC state keys. The `mcpServers` object is one top-level key. There are currently 7 registered servers. Three representative entries showing all variants:

```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"],
      "env": {},
      "type": "stdio"
    },
    "rube": {
      "type": "http",
      "url": "https://rube.app/mcp"
    },
    "ccs-websearch": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/michaelcurtis/.ccs/mcp/ccs-websearch-server.cjs"],
      "env": {}
    }
  }
}
```

**Schema for a stdio entry:**
- `command` (string, required) — executable name or path
- `args` (string[], optional) — arguments
- `env` (object, optional) — environment variables to set
- `type` (`"stdio"` | `"http"`, optional) — defaults to stdio if absent

**Schema for an HTTP entry:**
- `type`: `"http"`
- `url` (string) — the HTTP/SSE endpoint URL

### How `claude mcp add` works (CLI verb exists)

```
claude mcp add <name> <command> [args...]
claude mcp add --transport http <name> <url>
```

This is the supported way to register MCP servers with Claude Code. It patches `mcpServers` in `~/.claude.json`.

### What Cycle 2.plus got wrong

`src-tauri/src/install.rs` and `scripts/install.sh` both wrote to:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```
That is the **Claude Desktop** config path, not Claude Code. CC reads `~/.claude.json` instead.

---

## 3. Plugin Directory

### Root directory

```
/Users/michaelcurtis/.claude/plugins/
```

Contents:
```
~/.claude/plugins/
  blocklist.json           — blocked plugin names
  cache/                   — extracted plugin content, keyed by marketplace/name/version
  config.json              — {"format": 2} or similar
  data/                    — plugin data (skills symlinks, etc.)
  install-counts-cache.json
  installed_plugins.json   — registry of what's installed (see §3.2)
  known_marketplaces.json  — list of registered marketplaces
  marketplaces/            — marketplace configs
  repos/                   — (empty on this machine)
```

### Cache layout

```
~/.claude/plugins/cache/<marketplace-name>/<plugin-name>/<version>/
```

Examples from this machine:
```
~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/
~/.claude/plugins/cache/claude-plugins-official/imessage/0.1.0/
~/.claude/plugins/cache/claude-plugins-official/context7/unknown/
~/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown/
~/.claude/plugins/cache/voltagent-subagents/voltagent-core-dev/1.0.0/
```

`version` = semver string or `"unknown"` (when version is not declared in plugin.json).

### installed_plugins.json format (excerpt)

```json
{
  "version": 2,
  "plugins": {
    "imessage@claude-plugins-official": [
      {
        "scope": "user",
        "installPath": "/Users/michaelcurtis/.claude/plugins/cache/claude-plugins-official/imessage/0.1.0",
        "version": "0.1.0",
        "installedAt": "2026-01-09T15:53:36.916Z",
        "lastUpdated": "2026-03-27T07:11:01.087Z",
        "gitCommitSha": "113b335d11aee7f33e81a9d9139649c5be657329"
      }
    ]
  }
}
```

Key: `<plugin-name>@<marketplace-name>`.

### CLI verbs for plugin management

`claude plugins` (or `claude plugin`) subcommands available:
```
install|i  <plugin>           Install from marketplace (plugin@marketplace for specific)
uninstall|remove <plugin>     Remove
list                          List installed
enable <plugin>               Enable a disabled plugin
disable <plugin>              Disable
update <plugin>               Update to latest
marketplace                   Manage marketplaces
validate <path>               Validate a plugin or marketplace manifest
```

**`claude plugins install` DOES EXIST.** The CLI verb is `claude plugins install <name>@<marketplace>`.

For PrixmaViz, we either:
1. Publish to a marketplace and let users run `claude plugins install prixmaviz@<marketplace>`, OR
2. Ship a `marketplace.json` that users register locally with `claude plugins marketplace add`, then install from it, OR
3. Copy directly into `~/.claude/plugins/cache/<marketplace>/<name>/<version>/` and patch `installed_plugins.json` manually (filesystem approach, no CLI registration required for loading — but the plugin won't appear in `claude plugins list` without the registry entry)

The safest install path for Cycle 3 is: ship a local marketplace file + register it via `claude plugins marketplace add <path>`, then `claude plugins install prixmaviz`.

---

## 4. Plugin Manifest Format (`plugin.json`)

### Location within a plugin

```
<plugin-root>/.claude-plugin/plugin.json
```

NOT at `<plugin-root>/plugin.json`. The `.claude-plugin/` subdirectory is the CC-specific metadata directory.

### Full example — superpowers plugin

Path: `/Users/michaelcurtis/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/.claude-plugin/plugin.json`

```json
{
  "name": "superpowers",
  "description": "Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques",
  "version": "5.0.7",
  "author": {
    "name": "Jesse Vincent",
    "email": "jesse@fsck.com"
  },
  "homepage": "https://github.com/obra/superpowers",
  "repository": "https://github.com/obra/superpowers",
  "license": "MIT",
  "keywords": [
    "skills",
    "tdd",
    "debugging",
    "collaboration",
    "best-practices",
    "workflows"
  ]
}
```

### Minimal example — context7 plugin

Path: `/Users/michaelcurtis/.claude/plugins/cache/claude-plugins-official/context7/unknown/.claude-plugin/plugin.json`

```json
{
  "name": "context7",
  "description": "Upstash Context7 MCP server for up-to-date documentation lookup.",
  "author": {
    "name": "Upstash"
  }
}
```

### Field annotations

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | YES | Must match the plugin directory name |
| `description` | string | YES | Shown in `claude plugins list` |
| `version` | string | NO | SemVer. If absent, CC uses `"unknown"` as version dir name |
| `author` | object | NO | `{ name, email }` |
| `homepage` | string | NO | URL |
| `repository` | string | NO | URL |
| `license` | string | NO | SPDX identifier |
| `keywords` | string[] | NO | Searchable tags |

### Optional: `.claude-plugin/marketplace.json`

Superpowers also ships `.claude-plugin/marketplace.json`. This is used when distributing a plugin as its own marketplace (self-contained):

```json
{
  "name": "superpowers-dev",
  "description": "Development marketplace for Superpowers core skills library",
  "owner": { "name": "Jesse Vincent", "email": "jesse@fsck.com" },
  "plugins": [
    {
      "name": "superpowers",
      "description": "...",
      "version": "5.0.7",
      "source": "./"
    }
  ]
}
```

---

## 5. MCP Servers in a Plugin (`.mcp.json`)

A plugin that ships an MCP server declares it in `.mcp.json` at the **plugin root** (not inside `.claude-plugin/`):

Path: `/Users/michaelcurtis/.claude/plugins/cache/claude-plugins-official/imessage/0.1.0/.mcp.json`

```json
{
  "mcpServers": {
    "imessage": {
      "command": "bun",
      "args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "--shell=bun", "--silent", "start"]
    }
  }
}
```

**`${CLAUDE_PLUGIN_ROOT}`** is an env var CC sets to the plugin's install path when running plugin hooks/commands. This is how a plugin refers to its own directory without hardcoding the path.

This is **the key finding for Cycle 3.** Instead of patching `~/.claude.json` directly, PrixmaViz should ship `.mcp.json` inside the plugin. CC reads it and merges the MCP server entry automatically when the plugin is installed.

---

## 6. Skill File Format

### Directory layout

Each skill lives in a directory under `skills/` in the plugin root:

```
<plugin-root>/skills/
  <skill-name>/
    SKILL.md        — main skill definition (required)
    *.md            — auxiliary reference docs (optional)
    scripts/        — optional helper scripts
```

### `SKILL.md` format

YAML frontmatter + markdown body. Minimal required frontmatter:

```markdown
---
name: <skill-name>
description: "<trigger description — when Claude should use this skill>"
---

# Skill Title

Body content: instructions, workflow, checklists, etc.
```

**Real example** — from `brainstorming/SKILL.md` (first 4 lines):

```markdown
---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---
```

**Frontmatter fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `name` | YES | Must match the directory name |
| `description` | YES | The trigger description CC uses to decide when to activate this skill |

The body is free-form Markdown. CC injects the entire `SKILL.md` content as context when the skill is activated.

**From `writing-plans/SKILL.md`:**
```markdown
---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---
```

Skills are loaded from `~/.claude/skills/<skill-name>/SKILL.md` (for user-level installs) or from `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill-name>/SKILL.md` (for plugin-installed skills). After plugin installation, CC creates symlinks in `~/.claude/skills/` pointing into the plugin cache.

---

## 7. Hook File Format

### Plugin-level hooks

Hooks are declared in `hooks/hooks.json` at the plugin root:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
            "async": false
          }
        ]
      }
    ]
  }
}
```

**Hook event names (from CC docs and observed):** `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`.

**Hook entry fields:**
- `matcher` — regex matched against the tool name or event context
- `hooks[].type` — `"command"`
- `hooks[].command` — shell command string; `${CLAUDE_PLUGIN_ROOT}` is expanded
- `hooks[].async` — `false` means blocking (CC waits for completion)

### Hook script format

Hook scripts are plain shell scripts (bash). Naming convention: extensionless file name matching the hook (e.g., `session-start`, NOT `session-start.sh`). The `run-hook.cmd` wrapper provides cross-platform support (Unix + Windows).

**Hook script output format** — the script must print JSON to stdout. For `SessionStart`:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<string injected into Claude's context>"
  }
}
```

(Cursor uses `additional_context` flat key; SDK standard uses `additionalContext` flat key; CC uses the nested `hookSpecificOutput` form.)

### User-level hooks (settings.json)

User hooks live in `~/.claude/settings.json` (not in any plugin). The format is the same `hooks` JSON structure. User hooks live alongside plugin hooks; both are applied.

---

## 8. Command File Format

Commands live in `commands/` at the plugin root and are exposed as `/plugin-name:command-name` slash commands:

```
<plugin-root>/commands/
  <command-name>.md
```

### Format

YAML frontmatter + markdown body:

```markdown
---
description: "Short description of what this command does"
---

Body: instructions CC follows when the user invokes /plugin:command.
```

**Real example** — `commands/brainstorm.md`:

```markdown
---
description: "Deprecated - use the superpowers:brainstorming skill instead"
---

Tell your human partner that this command is deprecated and will be removed in the next major release.
They should ask you to use the "superpowers brainstorming" skill instead.
```

**Richer example** — `~/.claude/commands/sc/help.md` (frontmatter):

```markdown
---
name: help
description: "List all available /sc commands and their functionality"
category: utility
complexity: low
mcp-servers: []
personas: []
---
```

CC reads the `description` field for the slash-command list. Additional frontmatter fields (e.g., `name`, `category`, `mcp-servers`) are used by more complex plugins but are not required.

---

## 9. Directory layout summary for a PrixmaViz plugin

Based on the above, the minimal viable plugin structure for PrixmaViz:

```
prixmaviz-plugin/
  .claude-plugin/
    plugin.json              — manifest (name, description, version)
    marketplace.json         — (optional) for self-hosted marketplace installs
  .mcp.json                  — MCP server declaration (uses ${CLAUDE_PLUGIN_ROOT})
  skills/
    prixmaviz-viz/
      SKILL.md               — skill for using the viz tools
  hooks/
    hooks.json               — (optional) SessionStart hook
    session-start            — (optional) hook shell script
  commands/
    visualize.md             — (optional) /prixmaviz:visualize slash command
```

---

## 10. Recommendations for T2/T3

### T2: Fix MCP config path in install code

**What to fix:** `src-tauri/src/install.rs` line 7 and `scripts/install.sh` line 25.

**Current (wrong):**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Options for CC:**

**Option A — Write directly to `~/.claude.json`** (manual JSON patch):
- Path: `$HOME/.claude.json`
- Add to the `mcpServers` object: `{ "prixmaviz": { "command": "<binary>", "args": [...], "type": "stdio" } }`
- Rust: use `serde_json`, read file, mutate `mcpServers` key, write back.
- Risk: `~/.claude.json` is a large state file. Concurrent writes could corrupt it.

**Option B — Shell out to `claude mcp add`** (recommended):
```bash
claude mcp add prixmaviz /path/to/prixmaviz-mcp-server
```
- CC handles the write safely.
- Requires `claude` binary to be on PATH.
- Idempotent: if the entry already exists, CC returns an error; catch it and treat as success.

**Option C — Ship as a plugin with `.mcp.json`** (cleanest long-term):
- The `install_mcp_plugin` MCP tool in the existing codebase was built for this.
- CC reads `.mcp.json` when the plugin is installed and registers the MCP server automatically.
- No manual JSON patching needed.
- Path: `.mcp.json` at plugin root with `${CLAUDE_PLUGIN_ROOT}` for the binary path.

### T3: Build the plugin scaffold

1. Create `.claude-plugin/plugin.json` with the minimal fields: `name`, `description`, `version`.
2. Create `.mcp.json` with the prixmaviz MCP server entry using `${CLAUDE_PLUGIN_ROOT}` to reference the bundled binary.
3. Create `skills/prixmaviz-viz/SKILL.md` with `name` + `description` frontmatter.
4. If a session start hook is needed: create `hooks/hooks.json` + `hooks/session-start` bash script.

### Key path facts for T2/T3 (copy-pasteable)

| Item | Path |
|------|------|
| CC binary | `/Users/michaelcurtis/.nvm/versions/node/v24.8.0/bin/claude` |
| CC MCP config | `/Users/michaelcurtis/.claude.json` — key `mcpServers` |
| Plugin cache root | `/Users/michaelcurtis/.claude/plugins/cache/` |
| Plugin manifest | `<plugin-root>/.claude-plugin/plugin.json` |
| Plugin MCP declaration | `<plugin-root>/.mcp.json` |
| Skills dir (user) | `/Users/michaelcurtis/.claude/skills/` |
| Skills dir (plugin) | `<plugin-root>/skills/<skill-name>/SKILL.md` |
| Hooks dir (user) | `/Users/michaelcurtis/.claude/hooks/` |
| Hook declaration (plugin) | `<plugin-root>/hooks/hooks.json` |
| Commands dir (user) | `/Users/michaelcurtis/.claude/commands/` |
| Command files (plugin) | `<plugin-root>/commands/<name>.md` |
| CC plugin env var | `CLAUDE_PLUGIN_ROOT` = install path of the plugin |

---

## Appendix: `claude plugins install` flow

To install a plugin from a local directory (not a public marketplace):

```bash
# 1. Register a local marketplace (one-time)
claude plugins marketplace add /path/to/marketplace.json

# 2. Install the plugin
claude plugins install prixmaviz@<marketplace-name>
```

Or if a git repo URL is registered as a marketplace, CC clones it and reads `.claude-plugin/marketplace.json`.

The `installed_plugins.json` registry is updated automatically by `claude plugins install`.
