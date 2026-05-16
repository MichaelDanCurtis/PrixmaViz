import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "create_diagram",
    description: "Create a new diagram in your PrixmaViz workspace and render it. `engine` is one of: actdiag, blockdiag, bpmn, bytefield, c4plantuml, d2, dbml, diagramsnet, ditaa, erd, excalidraw, graphviz, mermaid, nomnoml, nwdiag, packetdiag, pikchr, plantuml, rackdiag, seqdiag, structurizr, svgbob, symbolator, tikz, umlet, vega, vegalite, vsdx, wavedrom, wireviz. `kind` is `graph` (uses IR + apply_patch) or `passthrough` (uses initialDsl + render_dsl).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        engine: { type: "string" },
        kind: { type: "string", enum: ["graph", "passthrough"] },
        initialDsl: { type: "string" },
      },
      required: ["name", "engine"],
    },
  },
  {
    name: "apply_patch",
    description: "Apply N patch operations atomically to a graph diagram.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        ops: { type: "array" },
      },
      required: ["diagramId", "ops"],
    },
  },
  {
    name: "save_diagram",
    description: "Persist a diagram with optional name/tags update.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["diagramId"],
    },
  },
  {
    name: "load_diagram",
    description: "Load a saved diagram by slug into the workspace. Slug is the kebab-case identifier returned by list_diagrams in each entry's `slug` field.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "list_diagrams",
    description: "List diagrams in the current workspace, optionally filtered.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        search: { type: "string" },
      },
    },
  },
  {
    name: "render_dsl",
    description: "Render arbitrary diagram DSL via the chosen engine. Pass `engine` (e.g. mermaid, plantuml, d2, graphviz, vegalite, wavedrom, bytefield, structurizr, ditaa, pikchr, svgbob, tikz) and `dsl` (the textual diagram source). Optionally `name` to persist as a saved diagram.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string" },
        dsl: { type: "string" },
        name: { type: "string" },
      },
      required: ["engine", "dsl"],
    },
  },
  {
    name: "get_annotations",
    description: "List annotations on a diagram, optionally including resolved.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        includeResolved: { type: "boolean" },
      },
      required: ["diagramId"],
    },
  },
  {
    name: "update_tile",
    description: "Move, resize, or focus a tile in the workspace canvas.",
    inputSchema: {
      type: "object",
      properties: {
        tileId: { type: "string" },
        patch: { type: "object" },
      },
      required: ["tileId", "patch"],
    },
  },
  {
    name: "set_view",
    description: "Control the canvas camera and auto-arrange selected tiles.",
    inputSchema: {
      type: "object",
      properties: {
        camera: { type: "object" },
        arrange: { type: "object" },
      },
    },
  },
  {
    name: "get_focused_tile",
    description: "Return the most-recently interacted tile, or null if none.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_view_url",
    description:
      "Return the URL where the user can view diagrams in their browser. ALWAYS call this after rendering and include the URL in your response.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "import_vsdx",
    description:
      "Import a Microsoft Visio (.vsdx) file into the workspace. Pass the file bytes as base64. Server renders natively. Use when the user asks to bring an existing .vsdx into PrixmaViz.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        base64Source: { type: "string", description: "Base64-encoded .vsdx file bytes" },
      },
      required: ["name", "base64Source"],
    },
  },
  {
    name: "analyze_vsdx",
    description:
      "Parse a previously-imported vsdx diagram into structured JSON (shapes, connectors, labels, layout). Use as input when translating a Visio diagram to Mermaid/D2/BPMN — host-side AI does the language translation.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
      },
      required: ["diagramId"],
    },
  },
  {
    name: "export_vsdx",
    description:
      "Export a diagram as a Microsoft Visio (.vsdx) file. Returns base64-encoded bytes. For graph diagrams (Mermaid/D2/Graphviz), produces a Visio-editable file with real shapes. For other engines, produces an image-embed vsdx. ALWAYS call this after building a graph diagram when the user asks for Visio/vsdx output — then save the bytes to a local .vsdx file path the user can open.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
      },
      required: ["diagramId"],
    },
  },
  {
    name: "export_diagram",
    description:
      "Export an existing diagram as SVG/PNG/JPEG bytes (base64-encoded). Use this when an AI agent needs to save a rendered diagram to disk — e.g. embedding in markdown specs or committing alongside docs. For .vsdx output, use export_vsdx instead.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        format: { type: "string", enum: ["svg", "png", "jpeg"] },
      },
      required: ["diagramId", "format"],
    },
  },
];
