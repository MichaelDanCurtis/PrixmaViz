import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../../src/store";
import type { Annotation } from "@prixmaviz/shared";

beforeEach(() => {
  useAppStore.setState({
    diagram: null,
    library: [],
    wsStatus: "idle",
    error: null,
    pending: false,
    annotations: {},
    mode: "select",
  });
});

const mkAnn = (id: string): Annotation => ({
  id, kind: "tag", createdAt: "2026-05-07T00:00:00Z",
});

describe("annotation state", () => {
  it("setAnnotations stores list per diagram", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1"), mkAnn("a2")]);
    expect(useAppStore.getState().annotations["d1"]?.length).toBe(2);
  });

  it("addAnnotation appends", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1")]);
    useAppStore.getState().addAnnotation("d1", mkAnn("a2"));
    expect(useAppStore.getState().annotations["d1"]?.length).toBe(2);
  });

  it("updateAnnotation merges", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1")]);
    useAppStore.getState().updateAnnotation("d1", { ...mkAnn("a1"), text: "hello" });
    expect(useAppStore.getState().annotations["d1"]?.[0]?.text).toBe("hello");
  });

  it("deleteAnnotation removes", () => {
    useAppStore.getState().setAnnotations("d1", [mkAnn("a1"), mkAnn("a2")]);
    useAppStore.getState().deleteAnnotation("d1", "a1");
    expect(useAppStore.getState().annotations["d1"]?.length).toBe(1);
    expect(useAppStore.getState().annotations["d1"]?.[0]?.id).toBe("a2");
  });

  it("setMode switches", () => {
    useAppStore.getState().setMode("region");
    expect(useAppStore.getState().mode).toBe("region");
  });
});
