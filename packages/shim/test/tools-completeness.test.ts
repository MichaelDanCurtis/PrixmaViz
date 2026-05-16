import { describe, expect, it } from "bun:test";
import { TOOLS } from "../src/tools";

/**
 * Wave-3 / Issue #5 surface contract: the shim's `tools/list` response must
 * advertise every MCP tool the server now dispatches. If a tool ships
 * server-side but is missing from this list, Claude can't see it.
 *
 * The expected list below is the FULL surface as of v0.7.0:
 *   - 15 pre-Issue-5 tools (cycle 1-4 base + vsdx round-trip + export_diagram)
 *   - 13 new Issue #5 tools (Groups A–F)
 * Total: 28.
 *
 * (The plugin doc previously reported "14 tools" because the vsdx round-trip
 * PR bumped the surface to 15 without updating the doc string. v0.7.0
 * realigns the doc with reality.)
 *
 * When you add a new MCP tool to the server, you MUST also:
 *   1. Add its descriptor to packages/shim/src/tools.ts
 *   2. Append its name here.
 */
const EXPECTED_TOOLS: readonly string[] = [
  // Pre-Issue-5 surface (15)
  "create_diagram",
  "apply_patch",
  "save_diagram",
  "load_diagram",
  "list_diagrams",
  "render_dsl",
  "get_annotations",
  "update_tile",
  "set_view",
  "get_focused_tile",
  "get_view_url",
  "import_vsdx",
  "analyze_vsdx",
  "export_vsdx",
  "export_diagram",
  // Group A — CRUD completeness
  "delete_diagram",
  "duplicate_diagram",
  // Group B — Discoverability
  "search_diagrams",
  "validate_dsl",
  // Group C — Annotation writes
  "add_annotation",
  "update_annotation",
  "resolve_annotation",
  // Group D — Canvas state
  "list_tiles",
  "focus_tile",
  "take_canvas_snapshot",
  // Group E — Workspace lifecycle
  "create_workspace",
  "list_workspaces",
  // Group F — Bulk
  "import_diagrams",
] as const;

describe("TOOLS descriptor surface", () => {
  it("advertises every expected tool name (v0.7.0 contract)", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const missing = EXPECTED_TOOLS.filter((n) => !names.has(n));
    expect(missing).toEqual([]);
  });

  it("has no extra tool names beyond the expected surface", () => {
    const expected = new Set<string>(EXPECTED_TOOLS);
    const extra = TOOLS.map((t) => t.name).filter((n) => !expected.has(n));
    expect(extra).toEqual([]);
  });

  it("uses unique tool names (no duplicate descriptors)", () => {
    const names = TOOLS.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("every descriptor has a non-empty description and an inputSchema object", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.description).toBe("string");
      expect((tool.description ?? "").length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe("object");
      expect(tool.inputSchema).not.toBeNull();
      // inputSchema must declare `type: "object"` for MCP clients
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
    }
  });

  it("the descriptor count matches the documented count (used by plugin doc)", () => {
    // If this fails, update plugin/commands/prixmaviz.md's "N tools" string
    // to match the new total.
    expect(TOOLS.length).toBe(EXPECTED_TOOLS.length);
  });
});
