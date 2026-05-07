import { describe, expect, it } from "vitest";
import { extractMermaidNodeId, extractMermaidEdgeId } from "../../src/lib/mermaid-ids";

describe("extractMermaidNodeId", () => {
  it("extracts node id from typical mermaid svg id", () => {
    expect(extractMermaidNodeId("flowchart-Auth-3")).toBe("Auth");
  });

  it("returns null for non-matching id", () => {
    expect(extractMermaidNodeId("not-a-flowchart-id")).toBe(null);
  });

  it("handles ids with dashes in them", () => {
    expect(extractMermaidNodeId("flowchart-foo-bar-12")).toBe("foo-bar");
  });
});

describe("extractMermaidEdgeId", () => {
  it("extracts L-from-to-N", () => {
    expect(extractMermaidEdgeId("L-Auth-DB-0")).toEqual({ from: "Auth", to: "DB" });
  });

  it("returns null on bad pattern", () => {
    expect(extractMermaidEdgeId("nope")).toBe(null);
  });
});
