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
    description: "Load a saved diagram into the workspace by `slug` or `diagramId`. Slug is the kebab-case identifier returned by list_diagrams in each entry's `slug` field. Pass `includeSvg: true` to include the rendered SVG in the response (default omits it to keep transcripts lean). Exactly one of `slug` or `diagramId` is required.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        diagramId: { type: "string" },
        includeSvg: { type: "boolean" },
      },
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
  // ─── Group A — CRUD completeness (Issue #5) ───────────────────────────────
  {
    name: "delete_diagram",
    description:
      "Delete a diagram from the workspace. Cascade-deletes annotations and removes tiles from the canvas. Pass `cascade: false` to refuse deletion when orphans exist. Exactly one of `slug` or `diagramId` is required.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        diagramId: { type: "string" },
        cascade: { type: "boolean" },
      },
    },
  },
  {
    name: "duplicate_diagram",
    description:
      "Clone a diagram under a new name. The clone receives a fresh render (engine versions may have drifted since the source was last rendered) and merges the source's tags with any new tags you supply. Pass `preserveAnnotations: true` to copy annotation rows; default false. Exactly one of `sourceSlug` or `sourceDiagramId` is required.",
    inputSchema: {
      type: "object",
      properties: {
        sourceSlug: { type: "string" },
        sourceDiagramId: { type: "string" },
        newName: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        preserveAnnotations: { type: "boolean" },
      },
      required: ["newName"],
    },
  },
  // ─── Group B — Discoverability (Issue #5) ─────────────────────────────────
  {
    name: "search_diagrams",
    description:
      "Full-text search across diagrams in the current workspace. Searches `name`, `dsl`, and annotation bodies; filters by `engines`, `tags` (AND), and `updatedSince`. Sort by `relevance` (default), `updated`, `created`, or `name`. Returns up to `limit` (default 20, max 100) results with optional `snippet` and relevance `score` when a `query` is provided.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        engines: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        updatedSince: { type: "string" },
        sort: { type: "string", enum: ["updated", "created", "name", "relevance"] },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "validate_dsl",
    description:
      "Validate that a (engine, source) pair renders cleanly through Kroki without persisting or caching the render. Returns `{ ok: true }` on success or `{ ok: false, errors: [{ line?, column?, message }] }` on parse/render failure. Use this from agents to pre-check DSL before calling `render_dsl` or `create_diagram`.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string" },
        source: { type: "string" },
      },
      required: ["engine", "source"],
    },
  },
  // ─── Group C — Annotation writes (Issue #5) ───────────────────────────────
  {
    name: "add_annotation",
    description:
      "Create a new annotation on a diagram. Provide one of `targetNodes` (node-scoped) or `bboxData` (region-scoped); omit both for a diagram-wide annotation. `targetNodes` and `bboxData` are mutually exclusive.",
    inputSchema: {
      type: "object",
      properties: {
        diagramId: { type: "string" },
        body: { type: "string" },
        author: { type: "string" },
        targetNodes: { type: "array", items: { type: "string" } },
        bboxData: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
        },
      },
      required: ["diagramId", "body"],
    },
  },
  {
    name: "update_annotation",
    description:
      "Update an annotation's body text. If the annotation is already resolved, returns `{ ok: false, code: 'annotation_resolved' }` unless `force: true` is supplied.",
    inputSchema: {
      type: "object",
      properties: {
        annotationId: { type: "string" },
        body: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["annotationId", "body"],
    },
  },
  {
    name: "resolve_annotation",
    description:
      "Mark an annotation resolved with an optional resolution note. Idempotent — resolving an already-resolved annotation just refreshes the timestamp and resolution text. Resolved annotations are excluded from `get_annotations` unless `includeResolved: true` is passed.",
    inputSchema: {
      type: "object",
      properties: {
        annotationId: { type: "string" },
        resolution: { type: "string" },
      },
      required: ["annotationId"],
    },
  },
  // ─── Group D — Canvas state introspection + manipulation (Issue #5) ───────
  {
    name: "list_tiles",
    description:
      "List every tile in the current workspace with geometry (x, y, w, h, z) and a `focused: true` flag for the tile currently focused. Returns `{ tiles: [] }` for an empty workspace. Same focus semantics as get_focused_tile.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "focus_tile",
    description:
      "Raise a tile to the top of the canvas z-stack and optionally pan the camera to it. Specify the tile by either `tileId` (direct lookup) or `diagramSlug` (first matching tile). Pass `pan: true` to also receive a `panTo: { x, y }` world-space coordinate the client should center its viewport on. Exactly one of `tileId` or `diagramSlug` is required.",
    inputSchema: {
      type: "object",
      properties: {
        tileId: { type: "string" },
        diagramSlug: { type: "string" },
        pan: { type: "boolean" },
      },
    },
  },
  {
    name: "take_canvas_snapshot",
    description:
      "Compose every tile in the workspace into a single SVG (or PNG, or JPEG) and return the bytes base64-encoded. `format` defaults to 'svg'. `padding` (default 40) is the outer margin around the bbox of all tiles. `background` (default 'transparent') is a CSS color or 'transparent' for no rect. `includeAnnotations` is accepted but NOT YET IMPLEMENTED in the MVP — passing true returns a warning and the snapshot without annotations.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["svg", "png", "jpeg"] },
        includeAnnotations: { type: "boolean" },
        padding: { type: "number" },
        background: { type: "string" },
      },
    },
  },
  // ─── Group E — Workspace lifecycle (Issue #5) ─────────────────────────────
  {
    name: "create_workspace",
    description:
      "Create a new workspace. The new workspace is claimed for the caller's token (i.e. the workspace returned in `workspaceId` appears in the caller's next `list_workspaces`). To interact with the new workspace, set the Bearer header on subsequent calls to the returned `workspaceId`.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    },
  },
  {
    name: "list_workspaces",
    description:
      "List workspaces owned by the caller. The caller's primary workspace is claimed on first call (so pre-existing anonymous workspaces become listable). Each entry includes a `diagramCount` so the caller can pick a workspace without a second round-trip.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ─── Group F — Bulk operations (Issue #5) ─────────────────────────────────
  {
    name: "import_diagrams",
    description:
      "Bulk-create N diagrams in one call. Each item is created and rendered independently; failures on individual items don't abort the batch unless `stopOnError: true` is passed. Slug collisions inside the batch are resolved by appending a random suffix. Emits exactly one workspace broadcast at the end, regardless of batch size.",
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array" },
        stopOnError: { type: "boolean" },
      },
      required: ["items"],
    },
  },
];
