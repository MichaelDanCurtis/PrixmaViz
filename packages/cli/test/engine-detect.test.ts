import { describe, it, expect } from "bun:test";
import { detectEngine, EXT_MAP, EngineDetectError } from "../src/engine-detect";

describe("engine-detect", () => {
  describe("extension table", () => {
    it("maps every defined extension to the expected engine", () => {
      // Locked-down list — if you add a new extension, please add it to
      // both this test and the README's engine table.
      expect(EXT_MAP).toEqual({
        ".mmd": "mermaid",
        ".mermaid": "mermaid",
        ".dot": "graphviz",
        ".gv": "graphviz",
        ".bytefield": "bytefield",
        ".d2": "d2",
        ".puml": "plantuml",
        ".plantuml": "plantuml",
      });
    });

    for (const [ext, expected] of Object.entries({
      ".mmd": "mermaid",
      ".mermaid": "mermaid",
      ".dot": "graphviz",
      ".gv": "graphviz",
      ".bytefield": "bytefield",
      ".d2": "d2",
      ".puml": "plantuml",
      ".plantuml": "plantuml",
    })) {
      it(`detects ${ext} → ${expected}`, () => {
        expect(detectEngine(`/tmp/example${ext}`)).toBe(expected);
      });
    }

    it("is case-insensitive on the extension", () => {
      // Authors sometimes commit DIAGRAM.MMD or graph.DOT — we honor.
      expect(detectEngine("/tmp/DIAGRAM.MMD")).toBe("mermaid");
      expect(detectEngine("/tmp/Graph.Dot")).toBe("graphviz");
    });
  });

  describe("override flag", () => {
    it("uses the override even when the extension would match", () => {
      // User authored a .mmd file as PlantUML-flavored DSL by mistake →
      // explicit --engine wins. We never second-guess the user.
      expect(detectEngine("/tmp/file.mmd", "plantuml")).toBe("plantuml");
    });

    it("uses the override for an extension we don't otherwise know", () => {
      expect(detectEngine("/tmp/file.unknown", "d2")).toBe("d2");
    });

    it("trims whitespace from the override", () => {
      expect(detectEngine("/tmp/file.unknown", "  d2  ")).toBe("d2");
    });

    it("ignores an empty override", () => {
      // empty string should NOT count as "explicit" — we fall through to
      // detection (and if that fails, throw the helpful hint).
      expect(() => detectEngine("/tmp/file.unknown", "  ")).toThrow(EngineDetectError);
    });
  });

  describe("error path", () => {
    it("throws with a helpful hint when extension is unknown + no override", () => {
      expect(() => detectEngine("/tmp/foo.xyz")).toThrow(
        /cannot detect engine from \.xyz; pass --engine <name>/,
      );
    });

    it("error mentions <no extension> when the file has none", () => {
      expect(() => detectEngine("/tmp/Makefile")).toThrow(/<no extension>/);
    });
  });
});
