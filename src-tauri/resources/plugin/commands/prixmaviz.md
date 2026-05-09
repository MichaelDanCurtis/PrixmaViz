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
- `/prixmaviz library` — list saved diagrams in the project's `.prixmaviz/diagrams/`

## Implementation

Parse the subcommand, then call the appropriate MCP tool:

- `arrange grid|horizontal|vertical` → `set_view({ arrange: { style, diagrams: <all currently-open tile diagramIds> } })`
- `close all` → `list_diagrams` (or read workspace.tiles), then `delete_tile` for each tile
- `focus <slug>` → `load_diagram(slug)`, then `update_tile(<found-tile-id>, { focused: true })`
- `list` → fetch `/api/workspace`, summarize tiles
- `library` → call `list_diagrams()` and summarize entries

If the subcommand is unrecognized, list the supported subcommands and ask the user to clarify.
