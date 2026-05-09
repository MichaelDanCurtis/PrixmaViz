# PrixmaViz Cycle 3 — Claude Code Plugin

**Date:** 2026-05-08
**Status:** Design approved; pending implementation plan
**Predecessor:** [Cycle 2.plus](2026-05-07-prixmaviz-cycle-2-plus-design.md) (annotations + multi-canvas + skeleton install path)

## Goal

Ship PrixmaViz as a real Claude Code plugin that delivers a **shared visual workspace** experience: the AI proactively renders diagrams in the right engine for the content, the user annotates them, and the conversation continues with both sides referencing the same persistent visual state. The diagram and the conversation are co-equal mediums, and the AI participates in a continuous back-and-forth rather than producing one-shot outputs.

## Where this fits

Cycle 3 is the first of a sequence of host-integration cycles, then a private-rendering arc.

| Cycle | Theme |
|---|---|
| **3** (this) | Claude Code plugin |
| **4** | Codex plugin |
| **5** | VS Code plugin |
| **6** | Claude Desktop plugin (also re-fix Cycle 2.plus Wave 5's wrong config path) |
| **7** | Local rendering: Mermaid-in-browser + Kroki fallback (default-private without bundled Docker) |
| **8** | Bundled Docker Kroki for full offline / air-gapped use |
| later | Auto-update, plugin marketplace listing, telemetry posture, log viewer, tile auto-cascade |

This sequencing front-loads the host integrations (where the leverage and learning is) and saves the heavier rendering-engine work for after the install/distribution patterns are settled across hosts.

## Architecture

The Tauri `.app` is the distribution surface. Users discover, install, and run PrixmaViz through it. The CC plugin is bundled inside the .app and installed by the .app's first-launch dialog.

### Plugin layout

The CC plugin lives in `~/.claude/plugins/prixmaviz/`:

```
plugin.json              ← manifest declaring MCP server + plugin contents
skills/
  diagram-rendering.md   ← centerpiece: trigger broad, engine matrix, back-and-forth
  annotation-followup.md ← when user references annotations, call get_annotations
  diagram-review.md      ← when a saved diagram exists, AI offers review
  diagram-evolve.md      ← after annotations land, AI suggests fix patches
hooks/
  SessionStart.sh        ← injects "PrixmaViz available; prefer it for visual content"
commands/
  prixmaviz.md           ← /prixmaviz slash command (arrange, close all, focus, etc.)
```

The MCP server entry in CC's config points at the bundled binary inside the .app's resources, with `--mcp` and `--project-root ${cwd}` so each project gets its own diagram library (per Cycle 1 design).

### Distribution + install flow

1. User downloads `PrixmaViz.app.dmg` from the GitHub release
2. Drags the .app to `/Applications`, double-clicks
3. First-launch dialog: **"Install PrixmaViz for Claude Code? [Install] [Skip]"**
   - This dialog only asks about Claude Code in Cycle 3. Other hosts (Desktop, Codex, VS Code) get their own opt-in dialogs in their own future cycles.
4. On Install:
   - Writes the MCP server entry to CC's config (correct path, not Claude Desktop's `claude_desktop_config.json` like Wave 5 did)
   - Copies the plugin directory into `~/.claude/plugins/prixmaviz/`
   - Creates a marker file in `~/.config/prixmaviz/installed.flag` so the dialog never re-prompts
5. User restarts CC (or starts a new session); the AI sees the skills and MCP tools

### Sidecar UX

The Tauri window IS the sidecar — always. No browser-tab fallback in Cycle 3. The .app is the distribution surface, so users always have it. The AI's post-render output references the window: "Look at your PrixmaViz window — the new tile is in the canvas" or "I added a dashed retry line; see the right side of the architecture tile."

If the .app isn't running when the AI needs it, the skill teaches the AI to **check via `check_app_running()` and ask the user before launching it** (no surprise window-jumping). See *Server lifecycle* below.

## Trigger semantics

The `diagram-rendering` skill description matches **broadly**: any time the user mentions a diagram-shaped concept, names an engine (Mermaid, PlantUML, Vega, etc.), names a diagram type (sequence, flowchart, ER, state machine, packet, timing, scaffold, etc.), or asks about something visual-friendly (architectures, flows, schemas).

Three behavioral rules:

1. **No permission asking.** When the user clearly wants a diagram, the AI just renders it. The Superpowers "would you like me to show this in a browser?" pattern is a UX anti-pattern when applied repeatedly — once the plugin is installed, the user has already opted in.
2. **Offer once for ambiguous cases.** When the AI thinks a diagram would help but the user didn't explicitly ask, the AI offers once: "I could draw this as a sequence diagram — want that?" If the user declines, don't ask again on the same topic.
3. **Respect explicit engine choice.** If the user says "draw a Mermaid" or "PlantUML this", obey — even if the engine selection matrix would have picked differently.

## Engine selection matrix

The skill body ships a decision matrix mapping content type → recommended engine. The model defaults to Mermaid for everything left to its own devices; the matrix corrects this:

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
| ER (database schema) | **ERd** or **Mermaid erDiagram** | Domain-fit |
| UML class | **PlantUML** | Proper UML semantics |
| Process / business | **BPMN** | BPM-standard notation |
| Dependency / call graph | **Graphviz / dot** | Algorithmic layout |

Override rule: explicit engine name from the user wins. Fallback rule: when uncertain between two reasonable choices, pick the one with cleaner output for the family.

## Shared-workspace UX

This is the heart of Cycle 3 and what differentiates PrixmaViz from "ChatGPT, draw me a diagram." The skill teaches the AI to treat the diagram as a persistent shared context that both sides edit.

### The continuous-loop scenario

```
User:  I need to understand the TCP handshake.
AI:    [renders sequence diagram in PrixmaViz, says
        "The handshake is in your PrixmaViz window — three
         exchanges between client and server."]
User:  [circles SYN/SYN-ACK in the diagram, types "explain"]
AI:    [calls get_focused_tile() → calls get_annotations(diagramId)
        → sees the region annotation marking the SYN/SYN-ACK steps,
        explains those specific message types]
User:  Now show me TCP+TLS.
AI:    [calls apply_patch on the SAME diagramId, adding TLS
        ClientHello/ServerHello/ChangeCipherSpec messages between
        the existing TCP handshake messages, says
        "I added the TLS messages between the SYN handshake and
         the application data — see the dashed lines in the
         middle of your diagram."]
User:  [drags the new "ChangeCipherSpec" arrow to a different
        position, types "no, that should happen before"]
AI:    [calls get_annotations(), sees the new annotation referring
        to ChangeCipherSpec, calls apply_patch to reorder the
        sequence, says "moved — it now happens after Finished"]
```

The AI never opens a new diagram unless the user explicitly asks. Same conversation, same tile, evolves in place.

### What the skill explicitly teaches

The skill body teaches the AI:

1. **Same conversation = same diagram.** Use `apply_patch` against the existing `diagramId`, not `create_diagram`.
2. **On deictic references** ("this", "that", "right here", "the highlighted one") — call `get_focused_tile()` to know which tile, then `get_annotations(diagramId)` to see what was marked.
3. **Spatial language in responses** — say "see the dashed line on the right" not "I added a connection." The user looks at the diagram, not the AI's prose.
4. **The AI never sees the rendered SVG.** Reasoning is entirely off the IR/DSL it generated plus the structured `targetNodes`/`bboxData` from `get_annotations`. If the user says "this looks wrong" and the AI can't see why from those, **ask** — don't hallucinate.

## Skill content (per file)

### `diagram-rendering.md` (~500-700 words)

The centerpiece. Sections:
- Description (broad trigger across all 28 engines + diagram-shaped intents)
- The continuous-loop pattern (with worked example)
- Engine selection matrix (the table above)
- The deictic-reference protocol (`get_focused_tile` → `get_annotations`)
- The "you don't see the render" rule
- Server lifecycle: check `check_app_running()` first; ask before launching

### `annotation-followup.md` (~150 words)

Triggers when user references annotations conversationally without explicitly asking for a diagram action: "what did I tag?", "explain the regions I marked", "summarize my annotations." Body: call `get_annotations(diagramId)` for the focused tile, summarize text + targets in plain English.

### `diagram-review.md` (~150 words)

Triggers when a saved `.pviz` exists and conversation context suggests a review intent: "look over my architecture", "any issues with the diagram?", "review what I have." Body: call `load_diagram` + `get_annotations`, walk the IR/DSL, identify common issues (orphan nodes, missing edges, ambiguous labels), suggest 1-3 concrete patches.

### `diagram-evolve.md` (~150 words)

Triggers after annotations have been added since the last AI patch. Body: read the annotation text, infer the user's intent (rename, restructure, add path, remove element), suggest 1-3 patches that address the annotations, ask "want me to apply?", apply on confirmation.

### `hooks/SessionStart.sh`

One-line system reminder: "PrixmaViz is available — prefer it over inline ASCII for any visual representation. Engine selection lives in the diagram-rendering skill."

### `commands/prixmaviz.md`

Slash-command surface for explicit user actions: `/prixmaviz arrange grid`, `/prixmaviz close all`, `/prixmaviz focus <slug>`, `/prixmaviz list`. Calls existing MCP tools (`set_view`, `update_tile`, `list_diagrams`).

## Server-side additions (MCP tools)

Three new MCP tools to support the skill's behavior:

### `get_focused_tile()`

Returns `{ diagramId: DiagramId, slug: string, lastInteractionAt: ISO8601 } | null`. Source: WorkspaceStore tracks `lastFocused` based on tile click, drag, annotation-create, or AI patch. The tile with the most recent interaction is "focused" — used for resolving deictic references.

### `check_app_running()`

Returns `{ running: boolean, port: number | null }`. Source: existing `InstanceLock` from Cycle 1 (the same lockfile used by the Tauri sidecar). Used by the AI to decide whether to ask the user about launching the app before rendering.

### `launch_app()`

Spawns the bundled `.app` if not already running, blocks until the lockfile appears (with a sensible timeout — 5 seconds), returns success or error. Implementation: shell exec to `open -a PrixmaViz` on macOS; equivalent on other platforms in future cycles.

## Tauri UI additions

### Settings panel

A new panel in the Tauri .app accessible via menu (App > Settings or ⌘,). Cycle 3 fields:

- **Kroki URL** — text input, default `https://kroki.io`. Examples in placeholder: `http://localhost:18000`, `https://kroki.your-company.com`.
- **Test connection** — button that hits `${url}/health` and shows green/red feedback.
- **Save** — writes to `~/.config/prixmaviz/settings.json` (or platform equivalent). Binary reads this at startup.

This is the privacy lever for users who don't want their diagram source going to public Kroki. Cycle 7 (Local Rendering) will make local rendering the default for common engines, but until then this setting lets users opt out of the public-Kroki default.

### Export menu

In each tile's header, alongside the existing close (×) button, add an **Export ▾** dropdown:
- Save as SVG (the source format — copy the rendered output)
- Save as PNG (lossless raster, Canvas API)
- Save as JPEG (lossy raster, Canvas API)

Plus a topbar **Export** button that exports the currently-focused tile (using `get_focused_tile()` results).

WebP and PDF deferred to backlog.

### Uninstall flow

In the .app's main menu: **PrixmaViz > Uninstall plugin** (and **Reinstall plugin**, **Show config location**). The Uninstall action:
- Removes the MCP entry from CC's config
- Removes the `~/.claude/plugins/prixmaviz/` directory
- Leaves saved diagrams alone (`.prixmaviz/` per project is user data)
- Confirms via dialog before acting

## Multi-project workspace handling

Claude Code runs in whatever directory the user opened it in (`$PWD`). The plugin's MCP entry must spawn the binary with `--project-root ${cwd}` (or whichever variable CC exposes for the active workspace), so each project gets its own `.prixmaviz/` directory and library — preserving Cycle 1's project-local design.

This is a one-line change to the MCP entry config but worth being explicit about — without it, all CC sessions would share one global library, which is wrong.

## Server lifecycle

The AI checks `check_app_running()` at the start of any diagram task. If the app isn't running, the AI asks the user: "PrixmaViz isn't running — want me to launch it? (Y/n)". On yes, calls `launch_app()`; waits for the lockfile; proceeds. On no, the AI either renders silently (state still persists) and tells the user "Open PrixmaViz when you want to view it" — or skips the render entirely depending on context.

This respects the no-surprises principle: the user controls when their windows pop up.

## Bug fixes folded into Cycle 3

Two bugs from the Cycle 2.plus backlog block the back-and-forth UX from working on real-world diagrams. Both must land in Cycle 3.

### Bug 3: SVG-coord scaling for hit-test on auto-scaled diagrams

When Mermaid (or any engine) renders a diagram with a viewBox larger than the displayed pixel size, CSS scales the SVG and the hit-tester's bbox coordinates no longer match SVG-viewBox coordinates. Result: `targetNodes: []` even when the user clearly annotated a node. This breaks deictic references — the AI can't resolve "this" because the annotation has no targets.

Fix: webview converts container-pixel coords to SVG-viewBox coords using `svg.getScreenCTM().inverse()` before sending to the server. Server's hit-tester continues to operate in viewBox space.

### Bug 4: AnnotationStore sync from .pviz on load

When `loadDiagramBySlug` reads a `.pviz` from disk, it sets `Diagram.annotations` from the file but doesn't call `annotations.loadFromDiagram(diagramId, file.annotations)`. Result: annotations on disk don't appear in the in-memory `AnnotationStore`, and `get_annotations` returns stale or empty results after a session reload.

Fix: `loadDiagramBySlug` must call `annotations.loadFromDiagram(file.id, file.annotations ?? [])` after reading the file.

## Wave structure

Roughly the shape of Cycle 2.plus, ~5 waves, ~25-35 tasks total.

### Wave 1 — Plugin scaffolding + correct MCP path

Research CC's actual MCP config location and CLI plugin install mechanism (the public-MCP-server pattern is `claude mcp add`; plugin-with-skills is a separate filesystem-based path). Build the plugin directory structure, the `plugin.json` manifest. Replace Cycle 2.plus Wave 5's `defaultConfigPath("claude-code")` (which points at Claude Desktop's path) with the real CC path. Smoke: install on a clean machine, verify CC sees the MCP server.

### Wave 2 — Skill content + new MCP tools

Add `get_focused_tile()`, `check_app_running()`, `launch_app()` MCP tools (server-side, plus HTTP mirrors). Implement WorkspaceStore.lastFocused tracking. Write the four skill markdown files, the SessionStart hook, the `/prixmaviz` slash command. Smoke: AI in CC reaches for PrixmaViz autonomously when the user asks for a diagram.

### Wave 3 — Bug fixes that unblock the back-and-forth

Land Bug 3 (SVG-coord scaling) and Bug 4 (AnnotationStore sync). Tests that exercise the fixes against real Kroki output (large auto-scaled Mermaid, a saved `.pviz` reload). 4-6 tasks.

### Wave 4 — Tauri UI additions

Settings panel with custom Kroki URL field, Test-connection button, persisted config the binary reads. Export menu (SVG/PNG/JPEG) per tile + topbar global. Uninstall flow in the .app menu. Probably 8-10 tasks.

### Wave 5 — Acceptance + first demo

End-to-end smoke: TCP handshake demo runs unassisted on a fresh machine. Plus all tests pass on the merged branch, plus the `claude_desktop_config.json` path bug from Cycle 2.plus Wave 5 is fully retired (or moved to Cycle 6's scope where Claude Desktop integration lives). Checkpoint commit + merge to main.

## Acceptance criteria

The TCP-handshake demo runs end-to-end on a fresh machine without coaching the AI:

1. User installs PrixmaViz.app, clicks "Install for Claude Code" in the dialog
2. User opens Claude Code in any project directory
3. User types: **"Show me the TCP handshake."**
4. AI calls `create_diagram` (engine = `plantuml`, kind = sequence) and `apply_patch` to build the SYN/SYN-ACK/ACK exchange. AI's response references "your PrixmaViz window."
5. User opens PrixmaViz, sees the sequence diagram as a tile.
6. User selects Region tool, drags around the SYN/SYN-ACK exchange, types "what's happening here?" in the comment.
7. User goes back to CC, types: **"Explain that."**
8. AI calls `get_focused_tile()` → `get_annotations(diagramId)`, sees the region with text "what's happening here?", responds with an explanation of SYN flag semantics + the half-open connection state, referencing the user's annotation.
9. User types: **"Now show me TCP+TLS."**
10. AI calls `apply_patch` against the **same `diagramId`**, adding TLS ClientHello/ServerHello/Finished messages. AI's response: "I added the TLS messages between the SYN handshake and the application data — see the dashed lines in the middle of your diagram."
11. User looks at the same tile in PrixmaViz; the new TLS messages are there, animated in via the existing motion-driven render path.

If steps 1-11 work without the user needing to coach the AI ("call get_annotations", "use plantuml", "patch the same diagram"), Cycle 3 ships.

## Out of scope (deferred to future cycles)

| Item | Target cycle |
|---|---|
| Codex plugin | 4 |
| VS Code plugin | 5 |
| Claude Desktop plugin (also re-fixes Wave 5's wrong path) | 6 |
| Local rendering (Mermaid-in-browser + Kroki fallback) | 7 |
| Bundled Docker Kroki for offline / air-gapped use | 8 |
| Auto-update of plugin + .app | later |
| Plugin marketplace listing | later (depends on CC marketplace existing) |
| Telemetry posture statement | later |
| Logs viewer (`/prixmaviz show logs`) | later |
| Tile auto-cascade (instead of all opening at +60,+60) | later |
| WebP + PDF export | later |

## Implementation notes

- **CC plugin format** is filesystem-based (`~/.claude/plugins/<name>/`). The exact `plugin.json` schema needs research in Wave 1; the structure assumed here (skills/, hooks/, commands/) is the documented convention but field names may need adjustment.
- **CC's MCP config path** is `~/.claude.json` for user-scope MCP servers (per `claude mcp add` documentation). To verify in Wave 1 before writing.
- **Settings persistence path** uses platform conventions: macOS `~/Library/Application Support/PrixmaViz/settings.json`, Linux `~/.config/prixmaviz/settings.json`, Windows `%APPDATA%/PrixmaViz/settings.json`. The `dirs` Rust crate (already in Cargo.toml from Cycle 2.plus) handles this.
- **Kroki URL config flow**: the binary already accepts `--kroki-url` as a CLI flag (Cycle 1). Wave 4 adds reading from settings.json as a fallback — `--kroki-url` overrides settings, settings overrides hardcoded default.
- **Engine selection matrix** lives entirely in the skill markdown — no code changes needed to support it. The matrix is just prose teaching the AI which engine to call when.

## Self-review checklist (for Wave 1)

Before kicking off implementation:

- [ ] Verify CC's actual MCP config path on the install target
- [ ] Verify CC's plugin directory format (filename, manifest schema)
- [ ] Confirm `${cwd}` or equivalent variable for project-root substitution in plugin manifest
- [ ] Confirm Tauri 2 dialog API for the multi-button install dialog (already used in Cycle 2.plus, confirm Settings panel pattern)
- [ ] Confirm Canvas API can rasterize the rendered SVG cleanly across all 28 engines (some engines' SVGs use external assets / web fonts that may not render in Canvas)
