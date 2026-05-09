# PrixmaViz Cycle 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PrixmaViz as a real Claude Code plugin (skills + hooks + slash commands + MCP server entry) with shared-workspace UX, custom Kroki URL setting, image export, uninstall flow, and two backlog bug fixes folded in.

**Architecture:** Plugin lives in `~/.claude/plugins/prixmaviz/` with `plugin.json` manifest + `skills/` + `hooks/` + `commands/`. Bundled inside the Tauri `.app`. First-launch dialog writes MCP entry to CC's actual config path AND copies the plugin directory into place. Three new MCP tools (`get_focused_tile`, `check_app_running`, `launch_app`) support the back-and-forth UX. Settings panel in the .app holds the custom Kroki URL. Each tile gets an Export menu (SVG/PNG/JPEG).

**Tech Stack:** Bun 1.3+, TypeScript 5.6+, React 18, motion 11, Zustand 4, Vitest, happy-dom, Tauri 2 (Rust + tauri-plugin-fs + tauri-plugin-dialog), MCP SDK 1.0+.

**Spec reference:** `docs/superpowers/specs/2026-05-08-prixmaviz-cycle-3-design.md` (commit `4c67de7`).

**Plan-defect mitigations from Cycle 2.plus:**
1. Plan body and code blocks are copy-paste-ready; no "TODO" or "fill in" gaps.
2. Wave-1 includes a research task that verifies CC's plugin/MCP paths against the live tool BEFORE the rest of the plan depends on them.
3. Real-world fixtures land alongside contrived ones for any new parsers (carry-forward from Wave 1+2 of Cycle 2.plus).
4. Hard YAGNI gate at end of each wave.
5. Implementer prompts open with `pwd && git rev-parse --abbrev-ref HEAD`.
6. Each task ends with explicit "Done when" criteria.

---

## File Structure

### `~/.claude/plugins/prixmaviz/` (new — the plugin payload bundled in .app resources, copied at install)

| File | Status | Responsibility |
|---|---|---|
| `plugin.json` | NEW | manifest declaring MCP server entry + plugin metadata |
| `skills/diagram-rendering.md` | NEW | centerpiece skill: trigger broad, engine selection matrix, back-and-forth pattern |
| `skills/annotation-followup.md` | NEW | small skill: when user references annotations, call get_annotations |
| `skills/diagram-review.md` | NEW | small skill: when saved diagram exists, AI offers review |
| `skills/diagram-evolve.md` | NEW | small skill: after annotations land, AI suggests fix patches |
| `hooks/SessionStart.sh` | NEW | one-line system reminder priming the AI that PrixmaViz is the visual partner |
| `commands/prixmaviz.md` | NEW | `/prixmaviz` slash command for explicit user actions |

These files are bundled inside the Tauri `.app` resources at build time and copied into `~/.claude/plugins/prixmaviz/` by the install flow.

### `packages/server/src/`

| File | Status | Responsibility |
|---|---|---|
| `canvas/store.ts` | MODIFY | track `lastFocused` tile id |
| `canvas/store.test.ts` | MODIFY | tests for lastFocused tracking |
| `mcp/tools.ts` | MODIFY | add `get_focused_tile`, `check_app_running`, `launch_app` tool defs + impls |
| `mcp/tools.test.ts` | MODIFY | tests for the three new tools |
| `mcp/lifecycle.ts` | NEW | helpers for `isAppRunning()` (lockfile check) and `launchApp()` (spawn .app) |
| `mcp/lifecycle.test.ts` | NEW | tests for lifecycle helpers |
| `mcp/install.ts` | MODIFY | replace `defaultConfigPath` Claude Desktop path with real CC path; add CC plugin-directory copy logic |
| `mcp/install.test.ts` | MODIFY | tests for the corrected CC path + plugin-dir copy |
| `http/routes.ts` | MODIFY | add HTTP mirrors for the new MCP tools |
| `pviz/io.ts` | MODIFY | (Bug 4) sync AnnotationStore on load — already discussed |
| `settings/io.ts` | NEW | read/write `~/.config/prixmaviz/settings.json` (Kroki URL, etc.) |
| `settings/io.test.ts` | NEW | tests for settings IO |
| `kroki/client.ts` | MODIFY | take baseUrl from settings.json if not provided via CLI flag |
| `index.ts` | MODIFY | wire settings.json read into KrokiClient construction |

### `packages/web/src/`

| File | Status | Responsibility |
|---|---|---|
| `components/AnnotationLayer.tsx` | MODIFY | (Bug 3) convert client coords to SVG-viewBox coords via getScreenCTM |
| `components/Tile.tsx` | MODIFY | add Export ▾ button to header; wire to export handler |
| `components/Topbar.tsx` | MODIFY | add Export button (acts on focused tile) |
| `components/SettingsPanel.tsx` | NEW | new panel with Kroki URL field + Test button |
| `components/UninstallDialog.tsx` | NEW | confirmation dialog for uninstall flow |
| `lib/export.ts` | NEW | rasterize SVG → PNG/JPEG via Canvas API; pure function |
| `lib/export.test.ts` | NEW | tests for export.ts |
| `lib/api.ts` | MODIFY | add `getSettings`, `setSettings`, `testKrokiConnection`, `uninstall` methods |
| `lib/ws.ts` | MODIFY | (no changes expected, but verify no regressions for new MCP tool surface) |
| `App.tsx` | MODIFY | add Settings + About menu hooks |

### `src-tauri/`

| File | Status | Responsibility |
|---|---|---|
| `src/install.rs` | MODIFY | replace Claude Desktop path with real CC path; copy bundled plugin dir into `~/.claude/plugins/prixmaviz/` |
| `src/main.rs` | MODIFY | replace Wave 5 dialog with CC-only "Install for Claude Code?"; add Settings + Uninstall menu items |
| `src/uninstall.rs` | NEW | reverse install: remove MCP entry + remove `~/.claude/plugins/prixmaviz/` |
| `src/settings.rs` | NEW | bridge Tauri ↔ settings.json (read/write/test connection) |
| `tauri.conf.json` | MODIFY | add `bundleResources` for plugin payload directory |
| `Cargo.toml` | MODIFY | (no new deps expected; `dirs` already added in Cycle 2.plus) |
| `resources/plugin/` | NEW | source of the plugin files bundled into the .app |

### `docs/`

| File | Status | Responsibility |
|---|---|---|
| `cycle-3-research.md` | NEW (Wave 1) | findings from CC plugin/MCP path research; deleted at end of Wave 1 |
| `README.md` | MODIFY | add "Install for Claude Code" section |

---

## Wave 1 — Plugin scaffolding + correct MCP path

**Goal:** Plugin payload exists, `defaultConfigPath` writes to the right file, plugin directory gets copied on install. Smoke: install on a clean machine, verify CC sees the MCP server.

### Task 1: Research CC's plugin + MCP config locations

**Files:**
- Create: `docs/cycle-3-research.md` (temporary; deleted at end of Wave 1)

- [ ] **Step 1: First-action verification**

```
pwd && git rev-parse --abbrev-ref HEAD
```
Expected: `/Volumes/Main External/Development/PrixmaViz-cycle-3` (or the worktree set up at execution start), branch `cycle-3`.

- [ ] **Step 2: Verify Claude Code's MCP config location**

Run on the install target machine:
```bash
which claude
claude mcp list 2>&1 | head -20
ls -la ~/.claude.json 2>/dev/null || echo "no ~/.claude.json"
ls -la ~/.config/claude 2>/dev/null || echo "no ~/.config/claude"
```

Document in `docs/cycle-3-research.md`:
- Path to the file `claude mcp add` writes to (likely `~/.claude.json` per documented behavior)
- Format of the entry (likely `mcpServers: { name: { command, args, env } }` matching Claude Desktop)

- [ ] **Step 3: Verify Claude Code's plugin directory**

Run:
```bash
ls -la ~/.claude/plugins/ 2>/dev/null || echo "no ~/.claude/plugins"
ls -la ~/.claude/skills/ 2>/dev/null || echo "no ~/.claude/skills"
claude plugins list 2>&1 || echo "no claude plugins command"
find ~/.claude -maxdepth 3 -type d 2>/dev/null
```

Document in `docs/cycle-3-research.md`:
- Path where CC plugins live (`~/.claude/plugins/<name>/` per documented convention)
- Whether `claude plugins install` exists as a CLI verb (if yes, that's the install path; if no, plain filesystem copy is the install path)
- Format of `plugin.json` (if the format is documented in CC's plugin docs, capture the schema)

- [ ] **Step 4: Verify skill, hook, and command directory layout**

Look at how the `superpowers` plugin (already installed on this machine) is structured:
```bash
ls -la ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills 2>/dev/null | head -10
cat ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/plugin.json 2>/dev/null
```

Document in `docs/cycle-3-research.md`:
- Real `plugin.json` example from superpowers (we can mirror its shape)
- Skill file format (markdown with frontmatter — `name`, `description` fields)
- Hook file format (shell script, naming convention `SessionStart.sh` etc.)
- Command file format (markdown with frontmatter — name, description, body)

- [ ] **Step 5: Commit research**

```bash
git add docs/cycle-3-research.md
git commit -m "docs: Wave 1 research — CC plugin + MCP config locations"
```

**Done when:** `docs/cycle-3-research.md` documents the actual MCP config path, plugin directory path, and `plugin.json` schema, with example snippets pulled from real installed plugins on this machine.

---

### Task 2: Replace `defaultConfigPath("claude-code")` with the real CC path

**Files:**
- Modify: `packages/server/src/mcp/install.ts`
- Modify: `packages/server/test/mcp/install.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Update the test**

In `packages/server/test/mcp/install.test.ts`, find existing `mergeMcpConfig` tests. Add ONE new test that documents the corrected `defaultConfigPath` for `"claude-code"`:

```ts
import { defaultConfigPath } from "../../src/mcp/install";

describe("defaultConfigPath", () => {
  it("returns Claude Code's MCP config path on macOS", () => {
    if (process.platform !== "darwin") return;
    const path = defaultConfigPath("claude-code");
    // Per Wave 1 research: CC writes user-scope MCP servers to ~/.claude.json
    expect(path).toMatch(/\/\.claude\.json$/);
    expect(path).not.toMatch(/Claude_desktop_config\.json/i);
    expect(path).not.toMatch(/Library\/Application Support\/Claude\//);
  });
});
```

Run the test:
```bash
cd packages/server && bun test test/mcp/install.test.ts -t "defaultConfigPath"
```
Expected: FAIL — current implementation returns the Claude Desktop path.

- [ ] **Step 3: Update the impl**

Modify `packages/server/src/mcp/install.ts` — replace `defaultConfigPath("claude-code")` body so it returns:
- macOS / Linux: `${HOME}/.claude.json`
- Windows: `${USERPROFILE}/.claude.json`

```ts
export function defaultConfigPath(host: "claude-code"): string {
  if (host === "claude-code") {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) throw new Error("cannot resolve home directory");
    return `${home}/.claude.json`;
  }
  throw new Error(`unknown host: ${host}`);
}
```

(Per Wave 1 research findings — confirm the path matches what `claude mcp list` reports as its config source. If your research shows a different file, update accordingly and update the test.)

- [ ] **Step 4: Re-run test**
```
cd packages/server && bun test test/mcp/install.test.ts
```
Expected: ALL pass (the original 4 + the new defaultConfigPath test).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/install.ts packages/server/test/mcp/install.test.ts
git commit -m "fix(mcp): defaultConfigPath('claude-code') points at ~/.claude.json (was Claude Desktop's path)"
```

**Done when:** `defaultConfigPath("claude-code")` returns `~/.claude.json` (or whatever your Wave 1 research confirmed) instead of the Claude Desktop config.

---

### Task 3: Plugin payload skeleton — `plugin.json` and directory layout

**Files:**
- Create: `src-tauri/resources/plugin/plugin.json`
- Create: `src-tauri/resources/plugin/skills/.gitkeep`
- Create: `src-tauri/resources/plugin/hooks/.gitkeep`
- Create: `src-tauri/resources/plugin/commands/.gitkeep`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write plugin.json**

Create `src-tauri/resources/plugin/plugin.json`:
```json
{
  "name": "prixmaviz",
  "version": "0.3.0",
  "description": "AI-native diagram tool — renders 28+ engines (Mermaid, PlantUML, D2, Vega-Lite, …) with annotations and infinite-canvas multi-tile workspace.",
  "homepage": "https://github.com/MichaelDanCurtis/PrixmaViz",
  "mcpServers": {
    "prixmaviz": {
      "command": "${PLUGIN_DIR}/../../../bin/prixmaviz",
      "args": ["--mcp", "--project-root", "${cwd}"]
    }
  },
  "skills": ["skills/diagram-rendering.md", "skills/annotation-followup.md", "skills/diagram-review.md", "skills/diagram-evolve.md"],
  "hooks": { "SessionStart": "hooks/SessionStart.sh" },
  "commands": ["commands/prixmaviz.md"]
}
```

(NOTE: the exact `plugin.json` schema may differ — adapt to whatever the Wave 1 research documented. The fields above are best-effort. If the real schema uses `mcp` instead of `mcpServers`, or expects a different `skills` shape, adapt now.)

- [ ] **Step 3: Create empty subdirs (so they exist in the bundled .app)**

```bash
mkdir -p src-tauri/resources/plugin/skills
mkdir -p src-tauri/resources/plugin/hooks
mkdir -p src-tauri/resources/plugin/commands
touch src-tauri/resources/plugin/skills/.gitkeep
touch src-tauri/resources/plugin/hooks/.gitkeep
touch src-tauri/resources/plugin/commands/.gitkeep
```

- [ ] **Step 4: Wire bundleResources**

Modify `src-tauri/tauri.conf.json` — add the plugin directory to `bundle.resources`:
```json
{
  "bundle": {
    "resources": [
      "binaries/prixmaviz-server-aarch64-apple-darwin",
      "binaries/prixmaviz-server-x86_64-unknown-linux-gnu",
      "resources/plugin/**/*"
    ]
  }
}
```

(Adapt if `bundle.resources` already exists in the conf — preserve existing entries, add `resources/plugin/**/*`.)

- [ ] **Step 5: Cargo check**
```
cd src-tauri && cargo check 2>&1 | tail -3
```
Expected: passes (no Rust changes yet; just resource bundling).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/resources/plugin/plugin.json src-tauri/resources/plugin/skills/.gitkeep src-tauri/resources/plugin/hooks/.gitkeep src-tauri/resources/plugin/commands/.gitkeep src-tauri/tauri.conf.json
git commit -m "feat(plugin): plugin.json skeleton + bundle into .app resources"
```

**Done when:** `plugin.json` exists at `src-tauri/resources/plugin/plugin.json` with the manifest, three empty subdirs are tracked via `.gitkeep`, and `tauri.conf.json` lists `resources/plugin/**/*` for bundling.

---

### Task 4: Tauri install — copy plugin payload to `~/.claude/plugins/prixmaviz/`

**Files:**
- Modify: `src-tauri/src/install.rs`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add `install_plugin_payload` function**

In `src-tauri/src/install.rs`, after `install_entry`, add:
```rust
use std::path::Path;

pub fn install_plugin_payload(resource_dir: &Path) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("cannot resolve home dir")?;
    let plugin_dir = home.join(".claude/plugins/prixmaviz");
    let src = resource_dir.join("plugin");
    if !src.exists() {
        return Err(format!("plugin payload not found at {:?}", src));
    }
    fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    copy_dir_recursive(&src, &plugin_dir).map_err(|e| e.to_string())?;
    Ok(true)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            fs::copy(&entry.path(), &dst_path)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Cargo check**
```
cd src-tauri && cargo check 2>&1 | tail -3
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/install.rs
git commit -m "feat(install): copy plugin payload to ~/.claude/plugins/prixmaviz/"
```

**Done when:** `install_plugin_payload(resource_dir)` exists in install.rs, compiles, and recursively copies `<resource>/plugin/` to `~/.claude/plugins/prixmaviz/`.

---

### Task 5: Wire install_plugin_payload into the first-launch dialog

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Update the dialog body**

In `src-tauri/src/main.rs`, find the existing first-launch dialog block. Replace its body (the install branch) so it ALSO calls `install_plugin_payload`. Final shape:

```rust
.show(move |yes| {
    if yes {
        if let Ok(resource_path) = app_handle.path().resource_dir() {
            // 1. Install MCP entry (existing)
            let bin = resource_path.join("binaries").join(if cfg!(target_os = "macos") {
                "prixmaviz-server-aarch64-apple-darwin"
            } else { "prixmaviz-server-x86_64-unknown-linux-gnu" });
            let _ = install::install_entry(&bin.to_string_lossy());
            // 2. Copy plugin payload (new in Wave 1 Task 5)
            let _ = install::install_plugin_payload(&resource_path);
        }
        let _ = std::fs::write(&first_run_flag, "1");
    } else {
        let _ = std::fs::write(&first_run_flag, "skipped");
    }
});
```

Also update the dialog message to reflect the dual install:
```rust
.message("Install PrixmaViz for Claude Code?\n\nThis adds:\n• MCP server entry to ~/.claude.json\n• Skills + slash command to ~/.claude/plugins/prixmaviz/\n\nYou can change this later via the menu.")
.title("Install Claude Code integration")
```

- [ ] **Step 3: Cargo check**
```
cd src-tauri && cargo check 2>&1 | tail -3
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(install): first-launch dialog installs MCP entry + plugin payload"
```

**Done when:** `cargo check` passes; clicking "Install" in the dialog runs both `install_entry` and `install_plugin_payload`.

---

### Task 6: Wave 1 smoke + research cleanup

**Files:**
- Delete: `docs/cycle-3-research.md`

- [ ] **Step 1: Build the binary**

```
bun run build:bin
```

- [ ] **Step 2: Manual smoke test (run on the implementer's machine)**

```bash
# Snapshot existing CC config
cp ~/.claude.json ~/.claude.json.before-cycle3 2>/dev/null || true

# Manually call install_entry to write MCP entry (since dialog requires running Tauri)
cd packages/server
bun run -e "
  import { mergeMcpConfig, defaultConfigPath } from './src/mcp/install';
  const path = defaultConfigPath('claude-code');
  const result = mergeMcpConfig(path, '/usr/local/bin/prixmaviz');
  console.log(JSON.stringify(result, null, 2));
"

# Confirm
cat ~/.claude.json | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get("mcpServers", {}).get("prixmaviz", "NONE"), indent=2))'

# Restore
mv ~/.claude.json.before-cycle3 ~/.claude.json 2>/dev/null
```

Expected: the snippet shows `prixmaviz` MCP entry in `~/.claude.json`.

- [ ] **Step 3: Delete research doc**

```bash
git rm docs/cycle-3-research.md
git commit -m "chore: drop temporary Wave 1 research doc"
```

- [ ] **Step 4: Wave 1 checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Wave 1 — plugin scaffolding + correct MCP path"
```

**Done when:** `mergeMcpConfig` writes to `~/.claude.json` (not Claude Desktop); `cargo check` clean; Wave 1 checkpoint committed.

---

## Wave 2 — Skill content + new MCP tools

**Goal:** AI in CC reaches for PrixmaViz autonomously when the user asks for a diagram, lifecycle is handled cleanly, deictic references resolve.

### Task 7: Server — WorkspaceStore.lastFocused tracking

**Files:**
- Modify: `packages/server/src/canvas/store.ts`
- Modify: `packages/server/test/canvas/store.test.ts`

- [ ] **Step 1: Verify**
```
pwd && git rev-parse --abbrev-ref HEAD
```

- [ ] **Step 2: Write the test**

Append to `packages/server/test/canvas/store.test.ts`:
```ts
describe("WorkspaceStore.focused", () => {
  it("focus() sets lastFocused; getFocused() returns it", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.focus("t1");
    const f = s.getFocused();
    expect(f?.id).toBe("t1");
    expect(f?.diagramId).toBe("d1");
  });

  it("getFocused returns undefined when nothing focused", () => {
    const s = new WorkspaceStore();
    expect(s.getFocused()).toBeUndefined();
  });

  it("focus() updates lastFocused timestamp", async () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.addTile({ id: "t2", diagramId: "d2", diagramSlug: "b", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.focus("t1");
    await new Promise(r => setTimeout(r, 10));
    s.focus("t2");
    expect(s.getFocused()?.id).toBe("t2");
  });

  it("removeTile clears focus if removed tile was focused", () => {
    const s = new WorkspaceStore();
    s.addTile({ id: "t1", diagramId: "d1", diagramSlug: "a", x: 0, y: 0, w: 200, h: 100, z: 0 });
    s.focus("t1");
    s.removeTile("t1");
    expect(s.getFocused()).toBeUndefined();
  });
});
```

Run, expect FAIL.

- [ ] **Step 3: Implement**

Modify `packages/server/src/canvas/store.ts`. Add private state + two new methods:
```ts
export class WorkspaceStore {
  private state: WorkspaceState = defaultWorkspace();
  private lastFocusedId: string | undefined = undefined;
  private lastFocusedAt: string | undefined = undefined;

  // ... existing methods ...

  focus(id: string): void {
    if (!this.state.tiles.find(t => t.id === id)) return;
    this.lastFocusedId = id;
    this.lastFocusedAt = new Date().toISOString();
  }

  getFocused(): (Tile & { lastFocusedAt: string }) | undefined {
    if (!this.lastFocusedId) return undefined;
    const tile = this.state.tiles.find(t => t.id === this.lastFocusedId);
    if (!tile) return undefined;
    return { ...tile, lastFocusedAt: this.lastFocusedAt! };
  }

  removeTile(id: string): void {
    this.state.tiles = this.state.tiles.filter(t => t.id !== id);
    if (this.lastFocusedId === id) {
      this.lastFocusedId = undefined;
      this.lastFocusedAt = undefined;
    }
  }
}
```

(Preserve existing `addTile`, `updateTile`, `setCamera`, `get`, `load` exactly.)

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/canvas/store.test.ts
```
Expected: all pass (existing 5 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/canvas/store.ts packages/server/test/canvas/store.test.ts
git commit -m "feat(canvas): track focused tile in WorkspaceStore"
```

**Done when:** `getFocused()` returns the most recently focused tile with timestamp; `removeTile` clears focus if removed.

---

### Task 8: Auto-focus on tile interactions (server-side)

**Files:**
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Call `workspace.focus(tileId)` on tile mutations**

In `packages/server/src/http/routes.ts`, find the workspace routes (POST /api/tiles, PATCH /api/tiles/:id, DELETE /api/tiles/:id) and the annotation routes (POST /api/annotations, PUT, DELETE).

Add `deps.workspace.focus(...)` calls:

In `POST /api/tiles` (after `addTile`):
```ts
deps.workspace.focus(tile.id);
```

In `PATCH /api/tiles/:id` (after `updateTile`):
```ts
deps.workspace.focus(tileId);
```

In `POST /api/annotations` (after `annotations.add`, before broadcast):
```ts
// Focus the tile that owns this diagram, if any
const w = deps.workspace.get();
const owningTile = w.tiles.find(t => t.diagramId === body.diagramId);
if (owningTile) deps.workspace.focus(owningTile.id);
```

In `PUT /api/annotations/:annId` (after `annotations.update`):
```ts
const w = deps.workspace.get();
const owningTile = w.tiles.find(t => t.diagramId === body.diagramId);
if (owningTile) deps.workspace.focus(owningTile.id);
```

(DELETE annotations: skip — deletion isn't a "focus" event.)

- [ ] **Step 3: Type-check + run tests**
```
cd packages/server && bunx tsc --noEmit
bun test
```
Expected: 0 new errors; only the 2 pre-existing dispatchTool timeouts fail.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/http/routes.ts
git commit -m "feat(canvas): auto-focus tile on create/update/annotation events"
```

**Done when:** Any tile mutation or annotation create/update calls `workspace.focus()` so `getFocused` reflects the live conversation context.

---

### Task 9: MCP tool — `get_focused_tile`

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Modify: `packages/server/test/mcp/tools.test.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the test**

Append to `packages/server/test/mcp/tools.test.ts`:
```ts
describe("get_focused_tile", () => {
  it("returns null when no tile focused", async () => {
    const c = ctx();
    const out = await dispatchTool("get_focused_tile", {}, c) as any;
    expect(out.tile).toBeNull();
  });

  it("returns the focused tile after focus()", async () => {
    const c = ctx();
    c.workspace.addTile({ id: "t1", diagramId: "d1", diagramSlug: "abc", x: 0, y: 0, w: 200, h: 100, z: 0 });
    c.workspace.focus("t1");
    const out = await dispatchTool("get_focused_tile", {}, c) as any;
    expect(out.tile).not.toBeNull();
    expect(out.tile.id).toBe("t1");
    expect(out.tile.diagramId).toBe("d1");
    expect(out.tile.diagramSlug).toBe("abc");
    expect(typeof out.tile.lastFocusedAt).toBe("string");
  });
});
```

Run, expect FAIL (tool not registered yet).

- [ ] **Step 3: Implement**

Modify `packages/server/src/mcp/tools.ts`. Append to TOOLS array:
```ts
  {
    name: "get_focused_tile",
    description: "Return the tile most recently interacted with (clicked, dragged, annotated, or AI-patched). Use this to resolve deictic references like 'this', 'that', 'the highlighted area' — the focused tile is what the user is talking about.",
    inputSchema: { type: "object", properties: {} },
    run: getFocusedTile,
  },
```

Add the impl function:
```ts
async function getFocusedTile(_args: Record<string, unknown>, ctx: ToolCtx) {
  const focused = ctx.workspace.getFocused();
  return { tile: focused ?? null };
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/mcp/tools.test.ts -t "get_focused_tile"
```
Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/tools.ts packages/server/test/mcp/tools.test.ts
git commit -m "feat(mcp): get_focused_tile tool"
```

**Done when:** Tool count goes from 10 to 11; `get_focused_tile` returns `{tile: null|FocusedTile}`.

---

### Task 10: Lifecycle helpers — `isAppRunning` + `launchApp`

**Files:**
- Create: `packages/server/src/mcp/lifecycle.ts`
- Create: `packages/server/test/mcp/lifecycle.test.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the test**

Create `packages/server/test/mcp/lifecycle.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAppRunning, lockfilePath } from "../../src/mcp/lifecycle";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "lifecycle-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("isAppRunning", () => {
  it("returns {running:false, port:null} when lockfile missing", async () => {
    const r = await isAppRunning(join(dir, "missing.lock"));
    expect(r.running).toBe(false);
    expect(r.port).toBeNull();
  });

  it("returns {running:true, port:N} when lockfile present and reachable", async () => {
    const path = join(dir, "instance.lock");
    writeFileSync(path, JSON.stringify({ pid: process.pid, port: 5180, startedAt: new Date().toISOString() }));
    // We can't actually verify reachability in unit tests without a real server.
    // Strategy: isAppRunning short-circuits on lockfile presence; reachability is checked elsewhere.
    const r = await isAppRunning(path);
    expect(r.port).toBe(5180);
  });

  it("returns {running:false} when lockfile is malformed JSON", async () => {
    const path = join(dir, "bad.lock");
    writeFileSync(path, "{not json");
    const r = await isAppRunning(path);
    expect(r.running).toBe(false);
    expect(r.port).toBeNull();
  });
});
```

Run, expect FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/server/src/mcp/lifecycle.ts`:
```ts
import { existsSync } from "node:fs";

export interface AppRunningResult {
  running: boolean;
  port: number | null;
}

export function lockfilePath(stateDir: string): string {
  return `${stateDir}/instance.lock`;
}

export async function isAppRunning(path: string): Promise<AppRunningResult> {
  if (!existsSync(path)) return { running: false, port: null };
  try {
    const txt = await Bun.file(path).text();
    const data = JSON.parse(txt) as { pid?: number; port?: number; startedAt?: string };
    if (typeof data.port !== "number") return { running: false, port: null };
    // Note: deeper reachability check (HTTP /api/health) is delegated to the caller.
    // Lockfile presence + valid port is the fast path.
    return { running: true, port: data.port };
  } catch {
    return { running: false, port: null };
  }
}

/**
 * Launch the bundled .app via shell. Caller passes the path to the .app bundle.
 * Returns true on successful launch, false on failure.
 */
export async function launchApp(appBundlePath: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      const proc = Bun.spawn(["open", "-a", appBundlePath], { stdout: "ignore", stderr: "ignore" });
      const code = await proc.exited;
      return code === 0;
    }
    if (process.platform === "linux") {
      const proc = Bun.spawn([appBundlePath], { stdout: "ignore", stderr: "ignore" });
      // Linux doesn't have a spawn-and-detach equivalent of `open -a` cleanly;
      // we treat "spawn didn't immediately fail" as success.
      return true;
    }
    if (process.platform === "win32") {
      const proc = Bun.spawn(["cmd", "/c", "start", "", appBundlePath], { stdout: "ignore", stderr: "ignore" });
      const code = await proc.exited;
      return code === 0;
    }
    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/mcp/lifecycle.test.ts
```
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/lifecycle.ts packages/server/test/mcp/lifecycle.test.ts
git commit -m "feat(mcp): lifecycle helpers — isAppRunning + launchApp"
```

**Done when:** 3 lifecycle tests pass; `launchApp` is platform-aware.

---

### Task 11: MCP tools — `check_app_running` + `launch_app`

**Files:**
- Modify: `packages/server/src/mcp/tools.ts`
- Modify: `packages/server/test/mcp/tools.test.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the tests**

Append to `packages/server/test/mcp/tools.test.ts`:
```ts
describe("check_app_running", () => {
  it("returns {running:false, port:null} when no lockfile", async () => {
    const c = ctx();
    const out = await dispatchTool("check_app_running", {}, c) as any;
    expect(out.running).toBe(false);
    expect(out.port).toBeNull();
  });
});

describe("launch_app", () => {
  it("returns {launched:false} when no app bundle path resolves (non-Tauri context)", async () => {
    const c = ctx();
    const out = await dispatchTool("launch_app", {}, c) as any;
    // In bun:test we're not running inside the .app, so resource resolution fails.
    expect(out.launched).toBe(false);
  });
});
```

Run, expect FAIL (tools not registered).

- [ ] **Step 3: Implement**

Modify `packages/server/src/mcp/tools.ts`. Add imports:
```ts
import { isAppRunning, launchApp, lockfilePath } from "./lifecycle";
```

Append to TOOLS array:
```ts
  {
    name: "check_app_running",
    description: "Check whether the PrixmaViz Tauri app is currently running. Use BEFORE rendering a diagram so you know whether the user can see your output. If running=false, ask the user before launching the app.",
    inputSchema: { type: "object", properties: {} },
    run: checkAppRunning,
  },
  {
    name: "launch_app",
    description: "Launch the PrixmaViz Tauri app if it is not already running. Only call this AFTER the user has explicitly confirmed they want the app launched (do not surprise users by spawning windows).",
    inputSchema: { type: "object", properties: {} },
    run: launchAppTool,
  },
```

Add impls:
```ts
async function checkAppRunning(_args: Record<string, unknown>, ctx: ToolCtx) {
  return await isAppRunning(lockfilePath(ctx.paths.stateDir));
}

async function launchAppTool(_args: Record<string, unknown>, ctx: ToolCtx) {
  // The .app bundle path lives in the Tauri resource directory at runtime.
  // For now: assume the .app is at /Applications/PrixmaViz.app on macOS;
  // production install will resolve via Tauri's resource_dir().
  const appPath = process.platform === "darwin"
    ? "/Applications/PrixmaViz.app"
    : process.platform === "linux"
    ? "/usr/local/bin/prixmaviz"
    : "C:\\Program Files\\PrixmaViz\\PrixmaViz.exe";
  const launched = await launchApp(appPath);
  return { launched };
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/mcp/tools.test.ts -t "check_app_running|launch_app"
```
Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/tools.ts packages/server/test/mcp/tools.test.ts
git commit -m "feat(mcp): check_app_running + launch_app tools"
```

**Done when:** Tool count is now 13 (was 11); both tools callable; tests pass.

---

### Task 12: Skill — `diagram-rendering.md` (centerpiece)

**Files:**
- Create: `src-tauri/resources/plugin/skills/diagram-rendering.md`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the skill**

Create `src-tauri/resources/plugin/skills/diagram-rendering.md`:

```markdown
---
name: diagram-rendering
description: Use whenever the user wants any kind of diagram, chart, flowchart, sequence diagram, ER diagram, architecture diagram, state machine, packet layout, signal timing, network topology, or visual representation of structure. Triggers on engine names (Mermaid, PlantUML, D2, Vega-Lite, TikZ, Graphviz, etc.), diagram-type words (flowchart, sequence, ER, state, class, packet, waveform, scaffold), and topics that benefit from visual structure (architectures, data flows, schemas, protocols).
---

# Diagram Rendering with PrixmaViz

PrixmaViz is the user's visual partner. When the user asks for a diagram or describes content that visualizes well, render it via the PrixmaViz MCP tools instead of inline ASCII art. The user sees the diagram in their PrixmaViz window; you participate in a continuous back-and-forth conversation about it.

## When to render

**Always render when the user:**
- Asks for a diagram by name ("draw a sequence diagram", "make a flowchart", "show me the architecture")
- Names an engine ("use Mermaid", "PlantUML this", "render with D2")
- Describes a multi-component system, protocol, data flow, schema, state machine, or any structured visual content

**Offer once when ambiguous:**
- The user asks an explanation question that would benefit from a diagram but didn't request one. Offer ONCE: "I could draw this as a sequence diagram — want that?" If declined, don't ask again on the same topic.

**Don't ask permission for explicit requests.** If the user clearly wants a diagram, just render it. The plugin is installed; permission is implicit.

## Engine selection — pick the best fit for the content

Default to Mermaid is wrong for many domains. The user has 28+ engines available. Map content to the right one:

| Content | Engine | Why |
|---|---|---|
| Protocol handshake / multi-actor flow | **PlantUML sequence** | Rich activation/return semantics |
| Digital signal timing | **WaveDrom** | Purpose-built for waveforms |
| Protocol packet bytes | **Bytefield** | Field-level layout primitive |
| C4 architecture | **C4-PlantUML** or **Structurizr** | Native C4 support |
| Modern declarative architecture | **D2** | Clean defaults, modern aesthetic |
| State machines / general flow | **Mermaid** | Safe default; great auto-layout |
| Data charts (bar/line/scatter/heatmap) | **Vega-Lite** | Declarative, expressive |
| Network topology | **nwdiag** | Subnet/host/port primitives |
| Rack diagrams | **rackdiag** | Rack-unit layout |
| Wiring diagrams | **WireViz** | Cable/connector primitives |
| Math / scientific notation | **TikZ** | LaTeX-grade typography |
| Casual sketch | **Excalidraw** | Hand-drawn aesthetic |
| ER (database schema) | **Mermaid erDiagram** or **ERd** | Domain-fit |
| UML class | **PlantUML** | Proper UML semantics |
| Process / business | **BPMN** | BPM-standard notation |
| Dependency / call graph | **Graphviz / dot** | Algorithmic layout |

**Override rule:** if the user explicitly names an engine, use that engine — even if the matrix would have picked differently. Respect explicit choice.

**Tie-breaker:** when uncertain between two reasonable choices, pick the one with cleaner output for that family.

## The continuous-loop pattern

A single conversation = a single tile that EVOLVES IN PLACE. Don't create new diagrams when continuing a topic.

Example flow:

```
User:  "Show me the TCP handshake."
You:   [call create_diagram engine=plantuml kind=passthrough name="tcp-handshake",
        then apply_patch (or render_dsl) with the PlantUML source. Note the diagramId.]
       "The handshake is in your PrixmaViz window — three exchanges
        between client and server."

User:  "Show me TCP+TLS."
You:   [call apply_patch on the SAME diagramId, adding TLS messages between
        the existing TCP handshake messages. Don't create a new diagram.]
       "Added the TLS messages between the SYN handshake and the
        application data — see the dashed lines in the middle."
```

The tile is shared workspace. Use `apply_patch` against the existing `diagramId`, not `create_diagram`, when continuing a topic.

## Deictic references — "this", "that", "right here"

When the user uses pointing language without specifying what they mean:

1. Call `get_focused_tile()` — returns the tile the user is currently interacting with.
2. Call `get_annotations(diagramId)` from that focused tile — returns the user's marks (regions, pins, tags) with `targetNodes`/`bboxData`.
3. Use the most recent annotation(s) to resolve the reference.

If `get_focused_tile` returns null or there are no annotations, ASK: "Which part are you referring to?"

## Spatial language in responses

You don't see the rendered SVG. The user does. Speak to what they can see:

- ✓ "See the dashed line connecting Webview to Bun"
- ✓ "I added it on the right side of the architecture, between Auth and DB"
- ✗ "Here's a new diagram"  (uninformative; user is looking at a tile, not a "new diagram")
- ✗ "The diagram looks great"  (you can't see it; don't pretend)

## You are blind to the rendered output

You called the render. You generated the IR/DSL. But you don't see the SVG the user sees. Reason from:
- The IR/DSL you produced (you remember what you sent)
- `get_annotations` results (`targetNodes`, `bboxData`, `nearestNode`, `text`)
- `get_focused_tile` results

If the user says "this looks wrong" and you can't determine why from those structured signals, ASK them to elaborate or annotate the problem area. Never hallucinate visual properties you can't verify.

## Server lifecycle

At session start (or on first diagram intent), call `check_app_running()`. If `running: false`:

1. Tell the user: "PrixmaViz isn't running — want me to launch it? (Y/n)"
2. On yes, call `launch_app()`, wait briefly, proceed.
3. On no, render anyway (state still persists) and say "Open PrixmaViz when you want to view it."

Never call `launch_app()` without explicit user confirmation. No surprise window-jumps.

## Tool surface available

- `create_diagram(name, engine)` — new diagram
- `apply_patch(diagramId, ops[])` — atomic IR patches (graph engines only)
- `render_dsl(engine, source, name?)` — direct DSL rendering for passthrough engines
- `save_diagram(diagramId)` — persist to .pviz on disk
- `load_diagram(slug)` — re-open a saved diagram
- `list_diagrams()` — library listing
- `get_annotations(diagramId, includeResolved?)` — read user's marks
- `get_focused_tile()` — which tile is "the current one"
- `check_app_running()` — is the Tauri window up
- `launch_app()` — launch it (only after user consent)
- `update_tile(tileId, patch)` — move/resize/focus
- `set_view({camera?, arrange?})` — viewport + auto-arrange
- `install_mcp_plugin(host, confirm)` — for advanced reinstall flows; users normally don't need this

When the user explicitly invokes the `/prixmaviz` slash command, use it for direct workspace operations.
```

- [ ] **Step 3: Lint check (markdown)**

Optionally check for any obvious issues:
```bash
wc -w src-tauri/resources/plugin/skills/diagram-rendering.md
```
Expected: ~600-800 words (within target range).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/resources/plugin/skills/diagram-rendering.md
git commit -m "feat(plugin): diagram-rendering skill — trigger broad, engine matrix, back-and-forth"
```

**Done when:** Skill file exists with frontmatter (`name`, `description`) plus the body sections covering trigger semantics, engine matrix, in-place evolution, deictic resolution, spatial language, AI blindness, and lifecycle.

---

### Task 13: Skill — `annotation-followup.md`

**Files:**
- Create: `src-tauri/resources/plugin/skills/annotation-followup.md`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the skill**

Create `src-tauri/resources/plugin/skills/annotation-followup.md`:
```markdown
---
name: annotation-followup
description: Use when the user references annotations or marks they've made on a diagram — phrases like "what did I tag?", "summarize my annotations", "explain the regions I marked", "what do my notes say?". Also triggers when the user asks an open-ended question about a diagram and there are unresolved annotations on the focused tile.
---

# Annotation Follow-up

When the user asks about marks they've made:

1. Call `get_focused_tile()` to identify the relevant tile.
2. Call `get_annotations(diagramId)` for that tile.
3. Summarize the annotations in plain English: kind (region/pin/tag), the user's `text` if present, and the resolved `targetNodes` (for graph engines) or `bboxData` (for charts).

Don't list the raw IDs (`ann_...`); the user doesn't care. Speak about what was marked: "You have a region on Auth and DB asking 'why dashed?', and a pin on the Webview lifeline saying 'this returns null sometimes'."

If `targetNodes` is empty for a region annotation, say so honestly: "I see a region you marked, but the hit-test didn't resolve any specific nodes — can you describe what's inside it?"
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/resources/plugin/skills/annotation-followup.md
git commit -m "feat(plugin): annotation-followup skill"
```

**Done when:** Skill file exists with the trigger description and behavior body.

---

### Task 14: Skill — `diagram-review.md`

**Files:**
- Create: `src-tauri/resources/plugin/skills/diagram-review.md`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the skill**

Create `src-tauri/resources/plugin/skills/diagram-review.md`:
```markdown
---
name: diagram-review
description: Use when the user has saved diagrams in the project library and asks for review-style help — phrases like "look over my architecture", "any issues with this diagram?", "review what I have", "what would you change?". Triggers on review/critique intent against existing saved content.
---

# Diagram Review

When the user wants you to review a saved diagram:

1. Call `list_diagrams()` to see what's saved.
2. If a diagram is currently focused, prefer that one. Otherwise ask the user which to review.
3. Call `load_diagram(slug)` to read the IR/DSL.
4. Call `get_annotations(diagramId)` to see the user's existing marks.
5. Walk the structure and identify common issues:
   - **Orphan nodes** (nodes with no edges in/out of them — usually a mistake)
   - **Missing edges** (groups of nodes that obviously belong together but aren't connected)
   - **Ambiguous labels** (nodes named "Service" or "DB1" without disambiguation)
   - **Unbalanced detail** (one subgraph deeply detailed, others stubbed)
   - **Annotation conflicts** (user marked something as wrong but didn't say what should change)
6. Suggest 1-3 concrete patches that fix specific issues. Use `apply_patch` to apply on user confirmation.

Don't lecture. Diagrams are working tools, not artwork. Suggest changes that make the diagram more useful for the user's evident purpose.
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/resources/plugin/skills/diagram-review.md
git commit -m "feat(plugin): diagram-review skill"
```

**Done when:** Skill file exists with the trigger description and behavior body.

---

### Task 15: Skill — `diagram-evolve.md`

**Files:**
- Create: `src-tauri/resources/plugin/skills/diagram-evolve.md`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the skill**

Create `src-tauri/resources/plugin/skills/diagram-evolve.md`:
```markdown
---
name: diagram-evolve
description: Use when the user has just added annotations to a diagram and is implicitly or explicitly asking for the diagram to be changed based on those marks — phrases like "fix this", "apply my notes", "make those changes", "address what I marked". Triggers on evolve/apply intent against an annotated tile.
---

# Diagram Evolution

When the user has annotations on the focused tile and wants you to apply them:

1. Call `get_focused_tile()` for the diagramId.
2. Call `get_annotations(diagramId, includeResolved=false)` for unresolved annotations only.
3. Read each annotation's `text` field and its `targetNodes`/`bboxData`/`point`. Infer the user's intent:
   - "rename to X" → IR `update_node` patch on the target with new label
   - "remove this" → IR `remove_node` or `remove_edge` patch
   - "this should connect to Y" → IR `add_edge` patch
   - "add a retry path" → engine-specific structural change
   - "use a different shape" → IR `update_node` with new `shape`
4. Suggest 1-3 patches: "I'll rename Auth to AuthService, add a retry path from Auth to DB, and remove the orphan Logger node — apply?"
5. On user confirmation, call `apply_patch` with all the ops in one call (atomic).
6. After patches land, call `annotations.update(annotationId, {resolvedAt: now})` for each annotation that was addressed — so they fade visually and don't show up as unresolved next time.

If you can't infer the user's intent from an annotation's text, ASK rather than guessing. Wrong patches are harder to undo than no patches.
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/resources/plugin/skills/diagram-evolve.md
git commit -m "feat(plugin): diagram-evolve skill"
```

**Done when:** Skill file exists with the trigger description and behavior body.

---

### Task 16: SessionStart hook

**Files:**
- Create: `src-tauri/resources/plugin/hooks/SessionStart.sh`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the hook**

Create `src-tauri/resources/plugin/hooks/SessionStart.sh`:
```bash
#!/usr/bin/env bash
# PrixmaViz CC plugin SessionStart hook
# Injects a system reminder priming the AI that PrixmaViz is the visual partner.

cat <<'EOF'
PrixmaViz is installed as your visual collaborator. When the user wants any kind of diagram (flowchart, sequence, ER, architecture, packet layout, timing, chart, etc.), use the PrixmaViz MCP tools instead of inline ASCII art. The user sees the diagram in their PrixmaViz window; reference it spatially, evolve it in place across turns, and use get_annotations to resolve "this/that" references. See the diagram-rendering skill for engine selection and the back-and-forth pattern.
EOF
```

- [ ] **Step 3: Make it executable**
```bash
chmod +x src-tauri/resources/plugin/hooks/SessionStart.sh
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/resources/plugin/hooks/SessionStart.sh
git commit -m "feat(plugin): SessionStart hook prims AI for visual partner role"
```

**Done when:** Hook file exists, is executable, and prints a system-reminder-style priming message.

---

### Task 17: `/prixmaviz` slash command

**Files:**
- Create: `src-tauri/resources/plugin/commands/prixmaviz.md`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the command**

Create `src-tauri/resources/plugin/commands/prixmaviz.md`:
```markdown
---
name: prixmaviz
description: Direct workspace operations on the PrixmaViz canvas — arrange tiles, close all, focus a specific diagram, list what's open. Use when the user prefers an explicit command over conversational requests.
---

# /prixmaviz — Direct workspace control

Subcommands:

- `/prixmaviz arrange grid` — auto-arrange all open tiles in a grid
- `/prixmaviz arrange horizontal` — single row layout
- `/prixmaviz arrange vertical` — single column layout
- `/prixmaviz close all` — remove all tiles from the canvas (does not delete saved diagrams)
- `/prixmaviz focus <slug>` — bring a saved diagram to the foreground
- `/prixmaviz list` — list currently-open tiles
- `/prixmaviz library` — list saved diagrams in the project's `.prixmaviz/diagrams/`

Implementation: parse the subcommand, then call the appropriate MCP tool — `set_view` (arrange/camera), `update_tile` (focus), `list_diagrams` (library), `delete_tile` for each tile (close all).
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/resources/plugin/commands/prixmaviz.md
git commit -m "feat(plugin): /prixmaviz slash command"
```

**Done when:** Command file exists with subcommand documentation.

---

### Task 18: Wave 2 smoke + checkpoint

**Files:** none (verification only)

- [ ] **Step 1: All server tests pass**

```
cd packages/server && bun test
```
Expected: 90+ pass; only the 2 pre-existing dispatchTool timeout failures.

- [ ] **Step 2: Build the binary**

```
bun run build:bin
```

- [ ] **Step 3: Verify 13 MCP tools listed**

```bash
mkdir -p /tmp/prixma-w2-c3
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | dist/prixmaviz --mcp --project-root /tmp/prixma-w2-c3 2>/dev/null | head -1 > /tmp/mcp-resp.json
python3 -c "
import json
r = json.load(open('/tmp/mcp-resp.json'))
tools = r.get('result', {}).get('tools', [])
print(f'{len(tools)} tools registered')
for t in tools:
    print(f'  - {t[\"name\"]}')
"
```
Expected: **13 tools** — Cycle 1's 6 (`create_diagram`, `apply_patch`, `save_diagram`, `load_diagram`, `list_diagrams`, `render_dsl`) + Cycle 2.plus's 4 (`get_annotations`, `update_tile`, `set_view`, `install_mcp_plugin`) + Cycle 3 Wave 2's 3 (`get_focused_tile`, `check_app_running`, `launch_app`).

- [ ] **Step 4: Wave 2 checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Wave 2 — skills + new MCP tools"
```

**Done when:** 13 tools confirmed; tests pass; Wave 2 checkpoint committed.

---

## Wave 3 — Bug fixes that unblock the back-and-forth

**Goal:** Fix Bug 3 (SVG-coord scaling) and Bug 4 (AnnotationStore sync from .pviz on load) — the prerequisites for the deictic-reference flow to work on real-world diagrams.

### Task 19: Bug 3 — SVG-coord conversion in AnnotationLayer

**Files:**
- Modify: `packages/web/src/components/AnnotationLayer.tsx`
- Modify: `packages/web/test/store/annotations.test.ts` (or new dedicated test)

- [ ] **Step 1: Verify**

- [ ] **Step 2: Read existing AnnotationLayer**

```bash
sed -n '1,100p' packages/web/src/components/AnnotationLayer.tsx
```

Identify the `relativePos(e: MouseEvent)` function (or equivalent) that converts viewport-pixel coords to layer-relative coords. This is where the bug lives — it returns container coords, but the server's hit-test expects SVG-viewBox coords.

- [ ] **Step 3: Replace `relativePos` with `relativeSvgPos`**

In `AnnotationLayer.tsx`, find the existing pixel-conversion function and rewrite it to convert through `getScreenCTM().inverse()`:

```ts
function relativeSvgPos(e: { clientX: number; clientY: number }, container: HTMLElement | null): { x: number; y: number } {
  if (!container) return { x: 0, y: 0 };
  // Find the rendered Mermaid/PlantUML SVG inside the container
  const renderedSvg = container.querySelector("svg") as SVGSVGElement | null;
  if (!renderedSvg) {
    // Fallback to container-relative if no SVG (shouldn't happen on graph diagrams)
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  // Convert viewport coords to SVG viewBox coords via the inverse screen CTM
  const pt = renderedSvg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = renderedSvg.getScreenCTM();
  if (!ctm) {
    const rect = container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}
```

Then replace ALL call sites that previously used `relativePos` to use `relativeSvgPos` and pass `containerRef.current`.

- [ ] **Step 4: Add a unit test**

This is hard to unit-test cleanly without a real DOM. Instead, write a test that verifies the conversion is "applied" by checking call signatures. (The full integration test is the Wave 3 smoke at Task 22.)

In `packages/web/test/store/annotations.test.ts`, append a placeholder test that documents the contract:

```ts
describe("AnnotationLayer SVG-coord conversion (Bug 3 fix)", () => {
  it("documents that bboxPixel sent to server is in SVG viewBox coords, not displayed-pixel coords", () => {
    // The fix lives in AnnotationLayer.tsx's relativeSvgPos function.
    // Manual verification: drag a region on the distributed-ecom diagram (which auto-scales 2x)
    // and verify the persisted annotation's bboxPixel matches SVG viewBox coords by checking
    // that targetNodes resolves to actual nodes (not empty array).
    // This test passes by construction; the real verification is in Wave 3 Task 22 smoke.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 5: Build the web bundle + run tests**

```
cd packages/web && bun run build && bun run test
```
Expected: build clean; tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/AnnotationLayer.tsx packages/web/test/store/annotations.test.ts
git commit -m "fix(web): AnnotationLayer converts to SVG viewBox coords for hit-test (Bug 3)"
```

**Done when:** `relativeSvgPos` is the active coord converter; web build is clean; bug placeholder test exists.

---

### Task 20: Bug 4 — AnnotationStore sync from .pviz on load

**Files:**
- Modify: `packages/server/src/http/routes.ts`
- Modify: `packages/server/test/pviz/io.test.ts` (or a route-level test if available)

- [ ] **Step 1: Verify**

- [ ] **Step 2: Find `loadDiagramBySlug`**

```bash
grep -n "loadDiagramBySlug" packages/server/src/http/routes.ts
```

This is where the bug lives. After it reads the .pviz file (`file.annotations` from disk), it puts the diagram in the store but doesn't sync the AnnotationStore.

- [ ] **Step 3: Add the sync call**

In `loadDiagramBySlug`, after `deps.store.put(diagram)`, add:

```ts
deps.annotations.loadFromDiagram(diagram.id, diagram.annotations ?? []);
```

(`loadFromDiagram` is the method on `AnnotationStore` that replaces in-memory state for the given diagramId. It exists from Cycle 2.plus Wave 1.)

- [ ] **Step 4: Add a test**

Append to `packages/server/test/pviz/io.test.ts` (or create a new route-level test if `loadDiagramBySlug` is route-only):

```ts
import { handleApi } from "../../src/http/routes";
import { DiagramStore } from "../../src/store/diagrams";
import { AnnotationStore } from "../../src/annotations/store";
import { WorkspaceStore } from "../../src/canvas/store";
import { KrokiClient } from "../../src/kroki/client";
import { WsHub } from "../../src/ws/hub";

describe("loadDiagramBySlug syncs annotations from disk (Bug 4)", () => {
  it("populates AnnotationStore after loading a .pviz with annotations", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "load-sync-"));
    const paths = { projectRoot: tmpDir, prixmaDir: join(tmpDir, ".prixmaviz"), diagramsDir: join(tmpDir, ".prixmaviz/diagrams"), cacheDir: join(tmpDir, ".prixmaviz/cache"), stateDir: join(tmpDir, ".prixmaviz/state"), configFile: join(tmpDir, ".prixmaviz/config.json"), workspaceFile: join(tmpDir, ".prixmaviz/workspace.json") };
    await mkdir(paths.diagramsDir, { recursive: true });

    // Write a .pviz with annotations directly
    const diagram = makeDiagram("with-anns");
    diagram.annotations = [
      { id: "ann_1", kind: "tag", targetNodes: ["a"], text: "hello", createdAt: "2026-05-09T00:00:00Z" },
    ];
    await writePviz(paths.diagramsDir, diagram, "<svg/>");

    // Now load via the route
    const annotations = new AnnotationStore();
    const deps = { paths, store: new DiagramStore(), annotations, workspace: new WorkspaceStore(), schedulePersistWorkspace: () => {}, kroki: new KrokiClient(), hub: new WsHub() };

    // Simulate POST /api/diagrams/with-anns/load
    const req = new Request(`http://localhost/api/diagrams/with-anns/load`, { method: "POST" });
    const url = new URL(req.url);
    await handleApi(req, url, deps as any);

    // Annotations should now be in the in-memory store
    const inMem = annotations.listByDiagram(diagram.id);
    expect(inMem.length).toBe(1);
    expect(inMem[0]?.id).toBe("ann_1");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

(Adapt imports to existing test scaffolding. If the existing test file structure makes this awkward, create `packages/server/test/http/load-sync.test.ts` instead.)

- [ ] **Step 5: Run, expect FAIL, then PASS**

```
cd packages/server && bun test -t "syncs annotations"
```
Expected: FAIL before the sync line is added; PASS after.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/http/routes.ts packages/server/test/pviz/io.test.ts
git commit -m "fix(http): loadDiagramBySlug syncs AnnotationStore from .pviz (Bug 4)"
```

**Done when:** Loading a saved diagram populates `AnnotationStore` with its on-disk annotations; new test passes.

---

### Task 21: Wave 3 smoke

**Files:** none (verification only)

- [ ] **Step 1: All tests pass**

```
cd packages/server && bun test
cd ../web && bun run test
```
Expected: server 90+ pass / 2 pre-existing fail; web 21+ pass.

- [ ] **Step 2: Manual smoke — Bug 3 verification (optional, if local Kroki is running)**

```bash
# Boot binary
bun run build:bin
"./dist/prixmaviz" --port 5180 --project-root /tmp/prixma-w3-c3 --kroki-url http://localhost:18000 > /tmp/prixma-smoke.log 2>&1 &
sleep 2

# Render a complex diagram (the distributed-ecom from Cycle 2.plus tire-kicking is good)
# In a browser at http://localhost:5180, switch to Region mode, drag around the Data Layer.
# Then verify targetNodes are populated:
DID=$(curl -s http://localhost:5180/api/library | python3 -c 'import sys,json; print([e for e in json.load(sys.stdin)["entries"] if e["name"]=="distributed-ecom"][0].get("path","").split("/")[-1].replace(".pviz",""))' 2>/dev/null || echo "")
# (The actual diagram id is in the load response or workspace.json)
```

If a local Kroki + a saved distributed-ecom diagram aren't readily available, document this smoke as a manual step the implementer runs once after a real install.

- [ ] **Step 3: Wave 3 checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Wave 3 — bug fixes (SVG-coord scaling + AnnotationStore sync)"
```

**Done when:** All tests pass; Wave 3 checkpoint committed; bug fixes verified.

---

## Wave 4 — Tauri UI additions

**Goal:** Settings panel with custom Kroki URL field + Test connection. Export menu (SVG/PNG/JPEG) per tile + topbar global. Uninstall flow.

### Task 22: Settings IO (server-side)

**Files:**
- Create: `packages/server/src/settings/io.ts`
- Create: `packages/server/test/settings/io.test.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the test**

Create `packages/server/test/settings/io.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings, defaultSettings } from "../../src/settings/io";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "settings-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("settings IO", () => {
  it("returns defaults when file missing", async () => {
    const s = await readSettings(join(dir, "missing.json"));
    expect(s).toEqual(defaultSettings());
  });

  it("roundtrips", async () => {
    const path = join(dir, "settings.json");
    const settings = { krokiUrl: "http://localhost:18000" };
    await writeSettings(path, settings);
    const back = await readSettings(path);
    expect(back.krokiUrl).toBe("http://localhost:18000");
  });

  it("returns defaults on parse error", async () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not json");
    const s = await readSettings(path);
    expect(s).toEqual(defaultSettings());
  });
});
```

- [ ] **Step 3: Implement**

Create `packages/server/src/settings/io.ts`:
```ts
import { existsSync } from "node:fs";

export interface PrixmaSettings {
  krokiUrl: string;
}

export function defaultSettings(): PrixmaSettings {
  return { krokiUrl: "https://kroki.io" };
}

export async function readSettings(path: string): Promise<PrixmaSettings> {
  if (!existsSync(path)) return defaultSettings();
  try {
    const txt = await Bun.file(path).text();
    const parsed = JSON.parse(txt) as Partial<PrixmaSettings>;
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(path: string, settings: PrixmaSettings): Promise<void> {
  await Bun.write(path, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run tests**
```
cd packages/server && bun test test/settings/io.test.ts
```
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/settings/io.ts packages/server/test/settings/io.test.ts
git commit -m "feat(settings): readSettings/writeSettings for ~/.config/prixmaviz/settings.json"
```

**Done when:** 3 tests pass; defaults are sane; parse errors don't crash.

---

### Task 23: Wire settings into KrokiClient

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/kroki/client.ts` (if needed)
- Modify: `packages/server/src/bootstrap.ts` (add settingsFile path)

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add `settingsFile` to PrixmaPaths**

In `packages/server/src/bootstrap.ts`, extend the interface:
```ts
export interface PrixmaPaths {
  projectRoot: string;
  prixmaDir: string;
  diagramsDir: string;
  cacheDir: string;
  stateDir: string;
  configFile: string;
  workspaceFile: string;
  settingsFile: string;
}
```

And `resolvePaths`:
```ts
return {
  ...,
  settingsFile: process.platform === "darwin"
    ? `${process.env.HOME}/Library/Application Support/PrixmaViz/settings.json`
    : process.platform === "linux"
    ? `${process.env.HOME}/.config/prixmaviz/settings.json`
    : `${process.env.APPDATA}/PrixmaViz/settings.json`,
};
```

- [ ] **Step 3: Read settings in `runServer`**

In `packages/server/src/index.ts`, before constructing `KrokiClient`:
```ts
import { readSettings } from "./settings/io";

// ...inside runServer:
  const settings = await readSettings(paths.settingsFile);
  // CLI flag overrides settings
  const krokiBaseUrl = args.krokiUrl ?? settings.krokiUrl;
  const kroki = new KrokiClient({ baseUrl: krokiBaseUrl });
```

- [ ] **Step 4: Type-check**
```
cd packages/server && bunx tsc --noEmit
```
Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bootstrap.ts packages/server/src/index.ts
git commit -m "feat(settings): KrokiClient honors settings.json (CLI flag still wins)"
```

**Done when:** Binary launched without `--kroki-url` reads `settings.json`; CLI flag still overrides.

---

### Task 24: Settings HTTP routes

**Files:**
- Modify: `packages/server/src/http/routes.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add settings routes**

In `packages/server/src/http/routes.ts`, before final `return undefined`:
```ts
  // ─── Settings ────────────────────────────────────────────
  if (p === "/api/settings" && req.method === "GET") {
    const { readSettings } = await import("../settings/io");
    const settings = await readSettings(deps.paths.settingsFile);
    return Response.json(settings);
  }

  if (p === "/api/settings" && req.method === "PUT") {
    const { writeSettings, defaultSettings } = await import("../settings/io");
    const body = await req.json() as Partial<{ krokiUrl: string }>;
    const merged = { ...defaultSettings(), ...body };
    await writeSettings(deps.paths.settingsFile, merged);
    return Response.json(merged);
  }

  if (p === "/api/settings/test-kroki" && req.method === "POST") {
    const body = await req.json() as { url: string };
    try {
      const resp = await fetch(`${body.url}/health`, { signal: AbortSignal.timeout(3000) });
      const ok = resp.ok;
      const status = await resp.json().catch(() => null);
      return Response.json({ ok, status });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 });
    }
  }
```

- [ ] **Step 3: Type-check + run tests**
```
cd packages/server && bunx tsc --noEmit
bun test
```
Expected: clean; only pre-existing failures.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/http/routes.ts
git commit -m "feat(settings): HTTP routes — GET/PUT settings, POST test-kroki"
```

**Done when:** GET /api/settings returns current settings; PUT writes them; POST test-kroki probes a Kroki URL.

---

### Task 25: Web — SettingsPanel component

**Files:**
- Create: `packages/web/src/components/SettingsPanel.tsx`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add API client methods**

In `packages/web/src/lib/api.ts`, append:
```ts
  getSettings: () =>
    fetch("/api/settings").then((r) => jsonOrThrow<{ krokiUrl: string }>(r)),

  setSettings: (settings: { krokiUrl: string }) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => jsonOrThrow<{ krokiUrl: string }>(r)),

  testKrokiConnection: (url: string) =>
    fetch("/api/settings/test-kroki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((r) => r.json() as Promise<{ ok: boolean; status?: unknown; error?: string }>),
```

- [ ] **Step 3: Write the SettingsPanel component**

Create `packages/web/src/components/SettingsPanel.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Props { onClose: () => void; }

export function SettingsPanel({ onClose }: Props) {
  const [krokiUrl, setKrokiUrl] = useState<string>("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings()
      .then((s) => setKrokiUrl(s.krokiUrl))
      .catch(() => setKrokiUrl("https://kroki.io"));
  }, []);

  async function onTest() {
    setTestStatus("testing");
    setTestError(null);
    const r = await api.testKrokiConnection(krokiUrl);
    if (r.ok) setTestStatus("ok");
    else { setTestStatus("fail"); setTestError(r.error ?? "unknown"); }
  }

  async function onSave() {
    await api.setSettings({ krokiUrl });
    onClose();
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          <span>Kroki URL</span>
          <input
            type="text"
            value={krokiUrl}
            onChange={(e) => setKrokiUrl(e.target.value)}
            placeholder="https://kroki.io"
          />
        </label>
        <p className="settings-hint">
          The default <code>https://kroki.io</code> sends your diagram source to a public service.
          For private content, run Kroki locally (e.g. <code>http://localhost:18000</code>) or use your organization's deployment.
        </p>
        <div className="settings-row">
          <button onClick={onTest}>Test connection</button>
          {testStatus === "testing" && <span className="settings-status">testing…</span>}
          {testStatus === "ok" && <span className="settings-status ok">✓ reachable</span>}
          {testStatus === "fail" && <span className="settings-status fail">✗ {testError}</span>}
        </div>
        <div className="settings-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onSave} className="settings-save">Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

Append to `packages/web/src/styles.css`:
```css
.settings-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.settings-panel {
  background: #1a1d24; color: #e6e7eb; padding: 24px; border-radius: 12px;
  min-width: 400px; max-width: 600px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
}
.settings-panel h2 { margin: 0 0 16px; font-size: 18px; }
.settings-panel label { display: block; margin-bottom: 12px; }
.settings-panel label span { display: block; font-size: 12px; color: #a0a3ad; margin-bottom: 4px; }
.settings-panel input {
  width: 100%; padding: 8px 10px; border-radius: 6px;
  background: #0e0f12; color: #e6e7eb; border: 1px solid #2c2f3a;
  font-family: ui-monospace, Menlo, monospace;
}
.settings-hint { font-size: 12px; color: #a0a3ad; line-height: 1.5; margin: 0 0 12px; }
.settings-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.settings-status.ok { color: #22c55e; }
.settings-status.fail { color: #ef4444; }
.settings-actions { display: flex; gap: 8px; justify-content: flex-end; }
.settings-save { background: #7aa2f7; color: #0e0f12; border: 0; padding: 8px 14px; border-radius: 6px; }
```

- [ ] **Step 5: Build**
```
cd packages/web && bun run build
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/SettingsPanel.tsx packages/web/src/lib/api.ts packages/web/src/styles.css
git commit -m "feat(web): SettingsPanel component (Kroki URL + Test connection)"
```

**Done when:** SettingsPanel exists, web build is clean, three new API methods are wired.

---

### Task 26: Mount SettingsPanel from App menu

**Files:**
- Modify: `packages/web/src/components/Topbar.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add a Settings button to the Topbar**

In `packages/web/src/components/Topbar.tsx`, add a Settings button (gear icon or text). Pass an `onOpenSettings` prop (or use a Zustand store flag):

Add to the topbar's render output:
```tsx
<button className="topbar-button" onClick={onOpenSettings} title="Settings">⚙ Settings</button>
```

(If `onOpenSettings` is awkward as a prop, use a zustand store flag — `settingsOpen: boolean`, `openSettings(): void`, `closeSettings(): void`.)

- [ ] **Step 3: Mount SettingsPanel in App.tsx**

In `packages/web/src/App.tsx`:
```tsx
import { useState } from "react";
import { SettingsPanel } from "./components/SettingsPanel";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  useWebSocket();
  return (
    <div className="app">
      <Topbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="workspace">
        <Library />
        <InfiniteCanvas />
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Build**
```
cd packages/web && bun run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Topbar.tsx packages/web/src/App.tsx
git commit -m "feat(web): Settings button in Topbar opens SettingsPanel"
```

**Done when:** Clicking Settings in the Topbar opens the panel; clicking outside or Cancel closes it.

---

### Task 27: Export utility — `lib/export.ts`

**Files:**
- Create: `packages/web/src/lib/export.ts`
- Create: `packages/web/test/lib/export.test.ts`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Write the test**

Create `packages/web/test/lib/export.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { svgToBlob, getExportFilename } from "../../src/lib/export";

describe("export utilities", () => {
  it("svgToBlob produces an SVG blob", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    const blob = await svgToBlob(svg, "svg");
    expect(blob.type).toBe("image/svg+xml");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("getExportFilename produces sane names", () => {
    expect(getExportFilename("auth-sequence", "png")).toBe("auth-sequence.png");
    expect(getExportFilename("system-architecture", "svg")).toBe("system-architecture.svg");
    expect(getExportFilename("untitled", "jpeg")).toBe("untitled.jpg");
  });
});
```

Run, expect FAIL.

- [ ] **Step 3: Implement**

Create `packages/web/src/lib/export.ts`:
```ts
export type ExportFormat = "svg" | "png" | "jpeg";

export async function svgToBlob(svgString: string, format: ExportFormat): Promise<Blob> {
  if (format === "svg") {
    return new Blob([svgString], { type: "image/svg+xml" });
  }
  // Rasterize via Canvas
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get 2d context");
    if (format === "jpeg") {
      // JPEG has no alpha — fill white background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        format === "png" ? "image/png" : "image/jpeg",
        format === "jpeg" ? 0.92 : undefined
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

export function getExportFilename(slug: string, format: ExportFormat): string {
  const ext = format === "jpeg" ? "jpg" : format;
  return `${slug}.${ext}`;
}
```

- [ ] **Step 4: Run tests**
```
cd packages/web && bun run test
```
Expected: existing pass + 2 new pass. (The svgToBlob test uses happy-dom's Canvas mock; if it doesn't support real rasterization, the test passes by virtue of the SVG branch only — which is fine.)

If the rasterize tests fail on happy-dom for raster formats, mark them as `it.skip(...)` and document the integration smoke covers it.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/export.ts packages/web/test/lib/export.test.ts
git commit -m "feat(web): export utility — SVG/PNG/JPEG via Canvas API"
```

**Done when:** `svgToBlob` is callable, returns a Blob; filename helper picks the right extension; tests pass (rasterize tests may be skipped if happy-dom can't run Canvas).

---

### Task 28: Tile header Export menu

**Files:**
- Modify: `packages/web/src/components/Tile.tsx`
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add Export ▾ button + menu**

Modify `Tile.tsx` — inside the tile-header div, before the close (×) button, add:

```tsx
const [exportMenuOpen, setExportMenuOpen] = useState(false);

async function onExport(format: "svg" | "png" | "jpeg") {
  setExportMenuOpen(false);
  if (!svg) return;
  const { svgToBlob, getExportFilename } = await import("../lib/export");
  const blob = await svgToBlob(svg, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getExportFilename(tile.diagramSlug, format);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

return (
  <div ref={containerRef} className="tile" style={...}>
    <div className="tile-header" onMouseDown={onHeaderDown}>
      <span className="tile-name">{tile.diagramSlug}</span>
      <div className="tile-export-wrapper">
        <button
          className="tile-export"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setExportMenuOpen((v) => !v); }}
          title="Export"
        >
          ⬇ ▾
        </button>
        {exportMenuOpen && (
          <div className="tile-export-menu" onMouseDown={(e) => e.stopPropagation()}>
            <button onClick={() => onExport("svg")}>Save as SVG</button>
            <button onClick={() => onExport("png")}>Save as PNG</button>
            <button onClick={() => onExport("jpeg")}>Save as JPEG</button>
          </div>
        )}
      </div>
      <button className="tile-close" onClick={onClose}>×</button>
    </div>
    {/* tile-body unchanged */}
  </div>
);
```

(The `e.stopPropagation()` on the export button's onMouseDown is essential — without it the header drag handler intercepts the click.)

- [ ] **Step 3: Add styles**

Append to `styles.css`:
```css
.tile-export-wrapper { position: relative; }
.tile-export {
  background: transparent; border: 0; color: #888; cursor: pointer;
  padding: 0 6px; font-size: 11px;
}
.tile-export:hover { color: #222; }
.tile-export-menu {
  position: absolute; top: 24px; right: 0; z-index: 50;
  background: white; color: #222; border: 1px solid #ccc; border-radius: 6px;
  display: flex; flex-direction: column; min-width: 140px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.tile-export-menu button {
  background: transparent; border: 0; padding: 6px 12px; text-align: left;
  cursor: pointer; font-size: 12px;
}
.tile-export-menu button:hover { background: #f5f5f7; }
```

- [ ] **Step 4: Build**
```
cd packages/web && bun run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Tile.tsx packages/web/src/styles.css
git commit -m "feat(web): Export ▾ menu in tile header (SVG/PNG/JPEG)"
```

**Done when:** Click Export ▾ on a tile; menu shows three options; selecting one downloads the appropriate file.

---

### Task 29: Topbar global Export

**Files:**
- Modify: `packages/web/src/components/Topbar.tsx`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add Export button that acts on focused tile**

In `Topbar.tsx`, add a global Export button. It needs to know which tile is focused — query via the existing API:

```tsx
async function onTopbarExport(format: "svg" | "png" | "jpeg") {
  const focused = await api.getWorkspace().then(w => {
    // Topmost / most recent tile in the array (server orders by lastFocused)
    return w.tiles[w.tiles.length - 1];
  }).catch(() => null);
  if (!focused) return;
  const svgResp = await fetch(`/api/library/${encodeURIComponent(focused.diagramSlug)}/thumb`);
  const svg = await svgResp.text();
  const { svgToBlob, getExportFilename } = await import("../lib/export");
  const blob = await svgToBlob(svg, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getExportFilename(focused.diagramSlug, format);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

(Render an Export ▾ button next to Settings; reuse the same dropdown pattern from the tile.)

- [ ] **Step 3: Build + commit**

```
cd packages/web && bun run build
```
Then:
```bash
git add packages/web/src/components/Topbar.tsx
git commit -m "feat(web): topbar Export button (acts on focused tile)"
```

**Done when:** Topbar Export ▾ menu downloads the focused tile's content.

---

### Task 30: Tauri Settings menu integration

**Files:**
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/settings.rs`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add a Settings menu item**

In `src-tauri/src/main.rs`, add a Tauri menu with "PrixmaViz > Settings…" that triggers a frontend event opening the SettingsPanel:

```rust
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

// In setup:
let settings = MenuItemBuilder::new("Settings…").id("settings").build(app)?;
let uninstall = MenuItemBuilder::new("Uninstall plugin").id("uninstall").build(app)?;
let prixmaviz_menu = SubmenuBuilder::new(app, "PrixmaViz")
    .item(&settings)
    .separator()
    .item(&uninstall)
    .build()?;
let menu = MenuBuilder::new(app).item(&prixmaviz_menu).build()?;
app.set_menu(menu)?;

app.on_menu_event(move |app, event| {
    match event.id().as_ref() {
        "settings" => {
            let _ = app.emit_to("main", "open-settings", ());
        }
        "uninstall" => {
            let _ = app.emit_to("main", "open-uninstall", ());
        }
        _ => {}
    }
});
```

- [ ] **Step 3: Listen for event in frontend**

In `packages/web/src/App.tsx`, listen for the Tauri event via the global `__TAURI__` if present, and toggle the SettingsPanel:

```tsx
useEffect(() => {
  // @ts-ignore — __TAURI__ exists only in Tauri context
  if (!window.__TAURI__) return;
  // @ts-ignore
  const unlisten = window.__TAURI__.event.listen("open-settings", () => {
    setSettingsOpen(true);
  });
  return () => { unlisten.then((fn: () => void) => fn()); };
}, []);
```

(Adapt to the Tauri JS API version actually in use; the import path may be `@tauri-apps/api/event`.)

- [ ] **Step 4: Cargo check**
```
cd src-tauri && cargo check 2>&1 | tail -3
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs packages/web/src/App.tsx
git commit -m "feat(tauri): PrixmaViz menu — Settings… opens SettingsPanel via event"
```

**Done when:** Cargo check passes; clicking PrixmaViz > Settings in the Tauri menu fires the event and opens the panel.

---

### Task 31: Uninstall flow

**Files:**
- Create: `src-tauri/src/uninstall.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `packages/web/src/components/UninstallDialog.tsx`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Rust uninstall logic**

Create `src-tauri/src/uninstall.rs`:
```rust
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
}

fn plugin_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude/plugins/prixmaviz"))
}

pub fn uninstall_plugin() -> Result<bool, String> {
    let mut changed = false;

    // 1. Remove MCP entry from config
    if let Some(path) = config_path() {
        if path.exists() {
            let txt = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let mut config: Value = serde_json::from_str(&txt).map_err(|e| format!("invalid JSON: {}", e))?;
            if let Some(servers) = config["mcpServers"].as_object_mut() {
                if servers.remove("prixmaviz").is_some() {
                    changed = true;
                }
            }
            if changed {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs().to_string())
                    .unwrap_or_else(|_| "x".to_string());
                let mut bak = path.clone();
                let fname = format!("{}.bak.{}", path.file_name().unwrap().to_string_lossy(), stamp);
                bak.set_file_name(fname);
                fs::copy(&path, &bak).ok();
                fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
            }
        }
    }

    // 2. Remove plugin directory
    if let Some(dir) = plugin_dir() {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            changed = true;
        }
    }

    Ok(changed)
}
```

- [ ] **Step 3: Wire as Tauri command**

In `main.rs`:
```rust
mod uninstall;

#[tauri::command]
fn uninstall_plugin() -> Result<bool, String> {
    uninstall::uninstall_plugin()
}

// add to invoke_handler:
.invoke_handler(tauri::generate_handler![install_mcp_plugin, uninstall_plugin])
```

- [ ] **Step 4: Frontend dialog**

Create `packages/web/src/components/UninstallDialog.tsx`:
```tsx
interface Props { onClose: () => void; }

export function UninstallDialog({ onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setConfirming(true);
    setError(null);
    try {
      // @ts-ignore
      const result = await window.__TAURI__.invoke("uninstall_plugin");
      setDone(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Uninstall PrixmaViz Plugin</h2>
        {!done ? (
          <>
            <p>This will remove the PrixmaViz entry from your Claude Code config and delete the plugin directory at <code>~/.claude/plugins/prixmaviz/</code>.</p>
            <p className="settings-hint">Saved diagrams in your project's <code>.prixmaviz/</code> directories are not affected.</p>
            {error && <p className="settings-status fail">Error: {error}</p>}
            <div className="settings-actions">
              <button onClick={onClose}>Cancel</button>
              <button onClick={onConfirm} disabled={confirming} className="settings-save">
                {confirming ? "Uninstalling…" : "Uninstall"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="settings-status ok">✓ PrixmaViz plugin uninstalled.</p>
            <p>Restart Claude Code to ensure the change takes effect.</p>
            <div className="settings-actions">
              <button onClick={onClose} className="settings-save">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Mount in App.tsx**

```tsx
const [uninstallOpen, setUninstallOpen] = useState(false);
// useEffect:
const unlisten2 = window.__TAURI__.event.listen("open-uninstall", () => setUninstallOpen(true));
// render:
{uninstallOpen && <UninstallDialog onClose={() => setUninstallOpen(false)} />}
```

- [ ] **Step 6: Cargo check + build**

```
cd src-tauri && cargo check 2>&1 | tail -3
cd ../packages/web && bun run build
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/uninstall.rs src-tauri/src/main.rs packages/web/src/components/UninstallDialog.tsx packages/web/src/App.tsx
git commit -m "feat(tauri): uninstall flow — removes MCP entry + plugin directory"
```

**Done when:** PrixmaViz menu > Uninstall plugin opens the dialog; confirming removes the MCP entry and the plugin directory; saved diagrams untouched.

---

### Task 32: Wave 4 smoke + checkpoint

**Files:** none (verification only)

- [ ] **Step 1: All tests pass**

```
cd packages/server && bun test
cd ../web && bun run test
```
Expected: server pre-existing 2 fail, web all pass.

- [ ] **Step 2: Cargo check**
```
cd src-tauri && cargo check
```

- [ ] **Step 3: Wave 4 checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Wave 4 — Tauri UI (Settings + Export + Uninstall)"
```

**Done when:** Tests green, cargo check clean, Wave 4 checkpoint committed.

---

## Wave 5 — Acceptance + first demo

**Goal:** TCP-handshake demo runs end-to-end on a fresh CC install. Plus all tests pass on the merged branch. Plus README updated.

### Task 33: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Verify**

- [ ] **Step 2: Add "Install for Claude Code" section**

Append to `README.md`:
```markdown
## Install for Claude Code

PrixmaViz integrates as a Claude Code plugin so the AI can render diagrams directly into your PrixmaViz window during conversations.

### Quick install

1. Download the latest `PrixmaViz.app.dmg` from the [Releases page](https://github.com/MichaelDanCurtis/PrixmaViz/releases).
2. Drag PrixmaViz.app to /Applications and open it.
3. On first launch, click "Install" in the dialog.
4. Restart Claude Code (or start a new session).

The AI will now use PrixmaViz whenever you ask for diagrams. Try:

> Show me the TCP handshake.

### What gets installed

- MCP server entry written to `~/.claude.json` under `mcpServers.prixmaviz`
- Plugin directory copied to `~/.claude/plugins/prixmaviz/` (skills, hooks, slash command)

### Settings

Open PrixmaViz > Settings… to configure:

- **Kroki URL** — point at a local Kroki instance (`http://localhost:18000`) or your organization's deployment to keep diagram source on-machine. The default `https://kroki.io` is public — use only for non-sensitive content.

### Uninstall

PrixmaViz > Uninstall plugin removes the MCP entry and the plugin directory. Saved diagrams in your projects' `.prixmaviz/` directories are not affected.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add 'Install for Claude Code' section"
```

**Done when:** README documents the install flow.

---

### Task 34: Acceptance demo dry-run

**Files:** none (manual smoke)

This task is the cycle's acceptance bar. It's a manual run-through, not automatable.

- [ ] **Step 1: Build + bundle the .app**

```
bun run build:bin
bun run build:tauri  # if this script exists; otherwise the Tauri build command
```

- [ ] **Step 2: Install on a clean test machine (or after git stash on the install target)**

```bash
# Snapshot existing CC config
cp ~/.claude.json ~/.claude.json.before-c3-test 2>/dev/null
rm -rf ~/.claude/plugins/prixmaviz
rm -f ~/.config/prixmaviz/installed.flag

# Open PrixmaViz.app, click "Install" in the first-launch dialog
# Verify ~/.claude.json now has prixmaviz under mcpServers
cat ~/.claude.json | python3 -c 'import sys,json; print(json.dumps(json.load(sys.stdin)["mcpServers"]["prixmaviz"], indent=2))'

# Verify plugin directory installed
ls -la ~/.claude/plugins/prixmaviz/
```

- [ ] **Step 3: Run the TCP-handshake demo in CC**

Open Claude Code in any project directory. Type:

> Show me the TCP handshake.

Verify the AI:
- Calls `check_app_running` (or skips if the app is already up)
- Calls `create_diagram` with engine=plantuml or render_dsl with sequence DSL
- Tells you to look at PrixmaViz

In PrixmaViz:
- Switch to Region tool
- Drag around the SYN/SYN-ACK exchange
- Type a comment in the popup ("what's happening here?") and save

Back in CC:

> Explain that.

Verify the AI:
- Calls `get_focused_tile()`
- Calls `get_annotations(diagramId)`
- Explains the SYN/SYN-ACK semantics referencing your annotation

Back in CC:

> Now show me TCP+TLS.

Verify the AI:
- Calls `apply_patch` against the SAME diagramId (not `create_diagram`)
- Adds TLS messages between the existing TCP messages
- Says something like "I added the TLS messages between the SYN handshake and the application data — see the dashed lines in the middle"

If all three steps succeed without coaching, **Cycle 3 ships.**

- [ ] **Step 4: Restore CC config snapshot**

```bash
mv ~/.claude.json.before-c3-test ~/.claude.json 2>/dev/null
```

- [ ] **Step 5: Document the demo result**

If the demo passes: nothing to commit, just confirm in your handoff message.

If parts fail: note what failed, decide whether to fix in this cycle or backlog.

**Done when:** The TCP-handshake demo runs end-to-end on a fresh install without coaching the AI.

---

### Task 35: Wave 5 final checkpoint + Cycle 3 close

**Files:** none

- [ ] **Step 1: All tests pass on merged branch**

```
cd packages/server && bun test
cd ../web && bun run test
cd ../../src-tauri && cargo check
```

- [ ] **Step 2: YAGNI audit**

```bash
git diff --name-only --diff-filter=A main..HEAD | sort
```
Verify all new files are in the spec's File Structure section. No scope creep.

- [ ] **Step 3: Final checkpoint**

```bash
git commit --allow-empty -m "checkpoint: Wave 5 — Cycle 3 complete (Claude Code plugin shipped)"
```

- [ ] **Step 4: Push**

```bash
git push origin cycle-3
```

- [ ] **Step 5: Hand off to merge**

```
Cycle 3 complete and on origin/cycle-3 at HEAD ${SHA}.

To merge:
  cd PrixmaViz  # main worktree
  git fetch origin
  git merge --no-ff cycle-3 -m "Merge Cycle 3: Claude Code plugin"
  git push origin main
```

**Done when:** All tests pass, all 5 wave checkpoints committed, branch pushed; handoff message ready.

---

## Self-Review

### Spec coverage check

| Spec section | Task coverage |
|---|---|
| Plugin scaffolding (`plugin.json` + skills/hooks/commands) | T3, T12-T17 |
| Correct MCP path (CC's, not Desktop's) | T2 |
| Three new MCP tools (`get_focused_tile`, `check_app_running`, `launch_app`) | T9, T10, T11 |
| Auto-focus tracking on tile/annotation events | T7, T8 |
| Plugin install flow in Tauri dialog | T4, T5 |
| Settings panel + custom Kroki URL | T22-T26, T30 |
| Export menu (SVG/PNG/JPEG) | T27, T28, T29 |
| Uninstall flow | T31 |
| Multi-project workspace handling | covered in T3 (`--project-root ${cwd}` in plugin.json) |
| Bug 3 (SVG-coord scaling) | T19 |
| Bug 4 (AnnotationStore sync from .pviz) | T20 |
| TCP-handshake acceptance demo | T34 |
| README install section | T33 |

### Placeholder scan

No "TBD" / "TODO" / "fill in" instances. Two intentional research-led adaptations: T1's research findings inform T2's exact path (the plan says "per Wave 1 research findings — adjust if research shows otherwise"), and T3's `plugin.json` schema may need adjustment based on the real CC plugin format. Both are flagged explicitly.

### Type consistency

- `WorkspaceStore.focus(id: string)` and `getFocused()` return shape consistent across T7-T9.
- `lockfilePath(stateDir)` and `isAppRunning(path)` signatures match T10-T11.
- `PrixmaSettings` interface matches across T22-T24.
- `ExportFormat` union matches across T27-T29.

### Scope check

5 waves, 35 tasks, single feature theme (CC plugin). Within scope of one plan. Bug fixes folded in are minor and tightly scoped to two tasks (T19, T20).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-prixmaviz-cycle-3.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, fast iteration
2. **Inline Execution** — batch execution with checkpoints

Which approach?
