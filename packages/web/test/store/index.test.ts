import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../../src/store";

beforeEach(() => {
  useAppStore.setState({
    diagram: null,
    library: [],
    wsStatus: "idle",
    error: null,
    pending: false,
  });
});

describe("useAppStore", () => {
  it("setDiagram sets current", () => {
    useAppStore.getState().setDiagram({
      id: "d1", name: "x", engine: "mermaid", kind: "graph",
      ir: { nodes: {}, edges: {}, groups: {}, layout: { direction: "LR" } },
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    });
    expect(useAppStore.getState().diagram?.id).toBe("d1");
  });

  it("setLibrary stores entries", () => {
    useAppStore.getState().setLibrary([
      { name: "a", path: "/x/a.pviz", engine: "mermaid", kind: "graph", tags: [], createdAt: "", updatedAt: "" },
    ]);
    expect(useAppStore.getState().library.length).toBe(1);
  });

  it("setWsStatus updates", () => {
    useAppStore.getState().setWsStatus("open");
    expect(useAppStore.getState().wsStatus).toBe("open");
  });

  it("setRender updates svg + dsl on current diagram", () => {
    useAppStore.getState().setDiagram({
      id: "d1", name: "x", engine: "mermaid", kind: "graph",
      ir: { nodes: {}, edges: {}, groups: {}, layout: { direction: "LR" } },
      meta: { createdAt: "", updatedAt: "", tags: [], sourcePaths: [] },
    });
    useAppStore.getState().setRender("d1", "<svg/>", "flowchart LR");
    expect(useAppStore.getState().svg).toBe("<svg/>");
  });
});
