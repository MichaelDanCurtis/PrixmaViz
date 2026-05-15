import { describe, expect, it } from "bun:test";
import { renderDiagram } from "../../src/render";
import type { Diagram } from "@prixmaviz/shared";

const fakeKroki = { renderSvg: async () => "<svg/>" } as never;

describe("renderDiagram binary branch", () => {
  it("returns error if bytes missing for binary diagram", async () => {
    const d: Diagram = {
      id: "_", name: "_", engine: "vsdx", kind: "binary",
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    };
    const outcome = await renderDiagram(d, { kroki: fakeKroki });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("missing bytes");
  });

  it("returns 'not implemented' when bytes are present (stub until Task 8)", async () => {
    const d: Diagram = {
      id: "_", name: "_", engine: "vsdx", kind: "binary",
      bytes: new Uint8Array([1, 2, 3, 4]),
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    };
    const outcome = await renderDiagram(d, { kroki: fakeKroki });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("not implemented");
  });
});
