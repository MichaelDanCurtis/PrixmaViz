import { describe, expect, it } from "bun:test";
import { renderDiagram } from "../../src/render";
import type { Diagram } from "@prixmaviz/shared";
import { setVsdxRendererForTests, VsdxRenderer } from "../../src/renderers/vsdx-render";

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

  it("renders SVG via VsdxRenderer when bytes present", async () => {
    setVsdxRendererForTests(
      new VsdxRenderer({
        baseUrl: "http://stub",
        fetchImpl: async () => new Response("<svg id='ok'/>", { status: 200 }),
      })
    );
    try {
      const d: Diagram = {
        id: "_", name: "_", engine: "vsdx", kind: "binary",
        bytes: new Uint8Array([1, 2, 3, 4]),
        meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
      };
      const outcome = await renderDiagram(d, { kroki: fakeKroki });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.result.svg).toContain("id='ok'");
    } finally {
      setVsdxRendererForTests(undefined);
    }
  });

  it("rejects binary diagrams with non-vsdx engines", async () => {
    const d: Diagram = {
      id: "_", name: "_", engine: "mermaid", kind: "binary",
      bytes: new Uint8Array([1, 2, 3]),
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    };
    const outcome = await renderDiagram(d, { kroki: fakeKroki });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("unsupported binary engine");
  });
});
