import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTool } from "../../src/mcp/tools";
import { KrokiClient } from "../../src/kroki/client";
import { DiagramStore } from "../../src/store/diagrams";
import { WsHub } from "../../src/ws/broadcast";
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
