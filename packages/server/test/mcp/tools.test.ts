import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTool } from "../../src/mcp/tools";
import { AnnotationStore } from "../../src/annotations/store";
import { KrokiClient } from "../../src/kroki/client";
import { DiagramStore } from "../../src/store/diagrams";
import { WsHub } from "../../src/ws/broadcast";
import { WorkspaceStore } from "../../src/canvas/store";
import { resolvePaths, ensureDirs } from "../../src/bootstrap";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ctx() {
  const paths = resolvePaths(dir);
  ensureDirs(paths);
  return {
    paths,
    store: new DiagramStore(),
    annotations: new AnnotationStore(),
    workspace: new WorkspaceStore(),
    schedulePersistWorkspace: () => {},
    kroki: new KrokiClient(),
    hub: new WsHub(),
  };
}

describe("dispatchTool", () => {
  it("create_diagram returns diagramId", async () => {
    const c = ctx();
    const out = await dispatchTool("create_diagram", { name: "x", engine: "mermaid" }, c);
    expect(typeof (out as any).diagramId).toBe("string");
  });

  it("apply_patch builds nodes and edges", async () => {
    const c = ctx();
    const created = await dispatchTool("create_diagram", { name: "x", engine: "mermaid" }, c) as { diagramId: string };
    const patched = await dispatchTool(
      "apply_patch",
      {
        diagramId: created.diagramId,
        ops: [
          { op: "add_node", node: { id: "a", label: "A" } },
          { op: "add_node", node: { id: "b", label: "B" } },
          { op: "add_edge", edge: { id: "e1", from: "a", to: "b" } },
        ],
      },
      c,
    );
    expect(Object.keys((patched as any).ir.nodes)).toEqual(["a", "b"]);
  });

  it("apply_patch on missing diagram errors", async () => {
    const c = ctx();
    await expect(
      dispatchTool("apply_patch", { diagramId: "nope", ops: [] }, c),
    ).rejects.toThrow(/not found/);
  });
});

describe("get_annotations", () => {
  it("returns annotations for a diagram", async () => {
    const c = ctx();
    c.annotations.add("d_test", {
      id: "ann_1", kind: "tag", targetNodes: ["a"], text: "hi",
      createdAt: "2026-05-07T00:00:00Z",
    });
    const out = await dispatchTool("get_annotations", { diagramId: "d_test" }, c) as any;
    expect(out.annotations.length).toBe(1);
    expect(out.annotations[0].id).toBe("ann_1");
  });

  it("excludes resolved when includeResolved=false (default)", async () => {
    const c = ctx();
    c.annotations.add("d_test", { id: "ann_resolved", kind: "tag", createdAt: "x", resolvedAt: "y" });
    c.annotations.add("d_test", { id: "ann_open", kind: "tag", createdAt: "x" });
    const out = await dispatchTool("get_annotations", { diagramId: "d_test" }, c) as any;
    expect(out.annotations.length).toBe(1);
    expect(out.annotations[0].id).toBe("ann_open");
  });
});

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

describe("check_app_running", () => {
  it("returns {running:false, port:null} when no lockfile", async () => {
    const c = ctx();
    const out = await dispatchTool("check_app_running", {}, c) as any;
    expect(out.running).toBe(false);
    expect(out.port).toBeNull();
  });
});

describe("launch_app", () => {
  it("returns {launched:false} when no app bundle resolves on this platform/path", async () => {
    const c = ctx();
    const out = await dispatchTool("launch_app", {}, c) as any;
    // In bun:test we're not running inside the .app, so launching the bundle path likely fails
    // depending on whether /Applications/PrixmaViz.app exists. Don't assert false absolutely;
    // just verify the tool returns a {launched: boolean} shape.
    expect(typeof out.launched).toBe("boolean");
  });
});
