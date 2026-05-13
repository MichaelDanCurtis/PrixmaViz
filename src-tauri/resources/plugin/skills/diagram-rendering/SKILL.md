---
name: diagram-rendering
description: Use whenever the user wants any kind of diagram, chart, flowchart, sequence diagram, ER diagram, architecture diagram, state machine, packet layout, signal timing, network topology, or visual representation of structure. Triggers on engine names (Mermaid, PlantUML, D2, Vega-Lite, TikZ, Graphviz, etc.), diagram-type words (flowchart, sequence, ER, state, class, packet, waveform, scaffold), and topics that benefit from visual structure (architectures, data flows, schemas, protocols).
---

# Diagram Rendering with PrixmaViz

PrixmaViz is the user's visual partner. When the user asks for a diagram or describes content that visualizes well, render it via the PrixmaViz MCP tools instead of inline ASCII art. The diagram appears in a **browser tab** at the workspace URL — the hosted service (`https://prixmaviz.alexis.com`) or a self-hosted server, whichever the user has configured.

You participate in a continuous back-and-forth conversation about the diagram. **Always tell the user where to view what you rendered** — the URL from `get_view_url()` is the reliable answer.

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
       "The handshake is rendered in your PrixmaViz workspace — three
        exchanges between client and server."

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

## After every render: tell the user where to look

Call `get_view_url()` after you call `create_diagram`, `apply_patch`, or `render_dsl`. Include the URL in your response:

> "Rendered your sequence diagram — view at <workspace URL>.
>  Open that URL in a browser tab to see it."

`get_view_url()` returns the URL based on the `PRIXMAVIZ_PUBLIC_URL` env var configured at server startup — the hosted service URL, or whatever the user configured for their self-hosted instance. The user keeps that tab open; subsequent renders update it live via WebSocket — no new tabs.

Example:

```
You:   [render the diagram]
       [call get_view_url() → returns { url: "https://prixmaviz.alexis.com/" }]
       "TCP handshake rendered — view at https://prixmaviz.alexis.com/.
        Open that URL in a browser tab to see it."
```

## Tool surface available

- `create_diagram(name, engine)` — new diagram
- `apply_patch(diagramId, ops[])` — atomic IR patches (graph engines only)
- `render_dsl(engine, source, name?)` — direct DSL rendering for passthrough engines
- `save_diagram(diagramId)` — persist to .pviz on disk
- `load_diagram(slug)` — re-open a saved diagram
- `list_diagrams()` — library listing
- `get_annotations(diagramId, includeResolved?)` — read user's marks
- `get_focused_tile()` — which tile is "the current one"
- `get_view_url()` — **call after every render**; returns the workspace URL where the diagram is viewable
- `update_tile(tileId, patch)` — move/resize/focus
- `set_view({camera?, arrange?})` — viewport + auto-arrange

When the user explicitly invokes the `/prixmaviz` slash command, use it for direct workspace operations.
