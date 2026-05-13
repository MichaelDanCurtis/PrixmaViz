import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  {
    name: "create_diagram",
    description: "Create a new diagram in your PrixmaViz workspace and render it.",
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
    description: "Load a saved diagram by slug into the workspace.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
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
    description: "Render arbitrary DSL via the chosen engine. Saves if name provided.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string" },
        source: { type: "string" },
        name: { type: "string" },
      },
      required: ["engine", "source"],
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
];
