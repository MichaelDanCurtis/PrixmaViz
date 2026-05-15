import { describe, expect, it } from "bun:test";
import { ALL_ENGINES, ENGINE_FAMILY, inferKind } from "./engines";

describe("vsdx engine identity", () => {
  it("is in ALL_ENGINES", () => {
    expect(ALL_ENGINES).toContain("vsdx");
  });
  it("has freeform family", () => {
    expect(ENGINE_FAMILY.vsdx).toBe("freeform");
  });
  it("does not have a Kroki path (rendered via unoserver, not Kroki)", () => {
    const { KROKI_PATH } = require("./engines");
    expect(KROKI_PATH.vsdx).toBeUndefined();
  });
});

describe("inferKind for vsdx", () => {
  it("returns 'binary' for vsdx engine", () => {
    expect(inferKind("vsdx")).toBe("binary");
  });
});
