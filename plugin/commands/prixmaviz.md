---
description: "Direct workspace operations on the PrixmaViz canvas — arrange tiles, close all, focus a specific diagram, list what's open."
---

# /prixmaviz — Direct workspace control

Subcommands:

- `/prixmaviz arrange grid` — auto-arrange all open tiles in a grid
- `/prixmaviz arrange horizontal` — single row layout
- `/prixmaviz arrange vertical` — single column layout
- `/prixmaviz close all` — remove all tiles from the canvas (does not delete saved diagrams)
- `/prixmaviz focus <slug>` — bring a saved diagram to the foreground
- `/prixmaviz list` — list currently-open tiles
- `/prixmaviz library` — list saved diagrams in the current workspace

## Implementation

Parse the subcommand, then call the appropriate MCP tool. The 31 available tools are: `create_diagram`, `apply_patch`, `save_diagram`, `load_diagram`, `list_diagrams`, `render_dsl`, `get_annotations`, `update_tile`, `set_view`, `get_focused_tile`, `get_view_url`, `import_vsdx`, `analyze_vsdx`, `export_vsdx`, `export_diagram`, `delete_diagram`, `duplicate_diagram`, `search_diagrams`, `validate_dsl`, `add_annotation`, `update_annotation`, `resolve_annotation`, `list_tiles`, `focus_tile`, `take_canvas_snapshot`, `create_workspace`, `list_workspaces`, `import_diagrams`, `update_diagram_meta`, `move_diagram`, `pin_diagram`. There is no dedicated tile-delete MCP tool — closing tiles happens via the workspace state (the web UI's close button, or a direct HTTP DELETE `/api/tiles/:id`).

- `arrange grid|horizontal|vertical` → `set_view({ arrange: { style, diagrams: <all currently-open tile diagramIds> } })`
- `close all` → Tell the user this isn't an MCP-tool operation; suggest closing tiles in the workspace UI. (A future cycle may expose a workspace-mutation tool.)
- `focus <slug>` → `focus_tile({ diagramSlug: <slug>, pan: true })` (raises the tile in the z-stack and returns a `panTo` coordinate the client can center on). If the diagram isn't yet on the canvas, call `load_diagram({ slug: <slug> })` first.
- `list` → call `list_tiles()` (or `get_focused_tile()` and `list_diagrams()`) together to summarize currently-open vs saved
- `library` → call `list_diagrams()` or `search_diagrams()` and summarize entries

If the subcommand is unrecognized, list the supported subcommands and ask the user to clarify.
