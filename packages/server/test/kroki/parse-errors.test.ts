import { describe, expect, it } from "bun:test";
import { parseEngineError } from "../../src/kroki/parse-errors";

describe("parseEngineError — mermaid", () => {
  it("pulls a numeric line out of a 'Parse error on line N' body", () => {
    const body =
      "Parse error on line 5:\n...->Server: Bad token\n^^^\nExpecting END";
    const errors = parseEngineError("mermaid", body);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(5);
    expect(errors[0]?.message).toMatch(/Bad token|Expecting END/);
  });

  it("handles lexical errors on a line", () => {
    const body = "Lexical error on line 3. Unrecognized text. ...";
    const errors = parseEngineError("mermaid", body);
    expect(errors[0]?.line).toBe(3);
  });

  it("extracts line+column when present", () => {
    const body = "Some failure at line 7:42 — semi-arbitrary text";
    const errors = parseEngineError("mermaid", body);
    expect(errors[0]?.line).toBe(7);
    expect(errors[0]?.column).toBe(42);
  });

  it("falls back to a single bare message when no line info is present", () => {
    const body = "Cryptic mermaid failure, no line";
    const errors = parseEngineError("mermaid", body);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBeUndefined();
    expect(errors[0]?.message).toBe(body);
  });
});

describe("parseEngineError — graphviz", () => {
  it("extracts a line from a stdin syntax error", () => {
    const body =
      "Error: <stdin>: syntax error in line 3 near 'a'\n more noise here";
    const errors = parseEngineError("graphviz", body);
    expect(errors[0]?.line).toBe(3);
    expect(errors[0]?.message).toMatch(/syntax error/);
  });

  it("returns multiple entries when graphviz reports multiple errors", () => {
    const body =
      "syntax error in line 3 near 'a'\nlex error in line 7 near 'b'";
    const errors = parseEngineError("graphviz", body);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.line)).toEqual([3, 7]);
  });

  it("falls back to bare message when no line info", () => {
    const errors = parseEngineError("graphviz", "Some other graphviz weirdness");
    expect(errors[0]?.line).toBeUndefined();
    expect(errors[0]?.message).toBe("Some other graphviz weirdness");
  });
});

describe("parseEngineError — plantuml", () => {
  it("parses the ERROR\\n<line>\\n<msg> framing", () => {
    const body = "ERROR\n12\nSome problem here at the boundary";
    const errors = parseEngineError("plantuml", body);
    expect(errors[0]?.line).toBe(12);
    expect(errors[0]?.message).toBe("Some problem here at the boundary");
  });

  it("parses 'at line N column M' (English) form", () => {
    const body = "Syntax bug detected at line 3, column 7. Could not parse.";
    const errors = parseEngineError("plantuml", body);
    expect(errors[0]?.line).toBe(3);
    expect(errors[0]?.column).toBe(7);
  });

  it("parses bare 'on line N' form", () => {
    const errors = parseEngineError("plantuml", "Syntax Error?  on line 4");
    expect(errors[0]?.line).toBe(4);
  });
});

describe("parseEngineError — d2", () => {
  it("extracts path:line:col messages, one entry per error", () => {
    const body =
      "err: index.d2:5:12: missing semicolon\nerr: index.d2:9:1: unknown shape 'banana'";
    const errors = parseEngineError("d2", body);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.line).toBe(5);
    expect(errors[0]?.column).toBe(12);
    expect(errors[0]?.message).toBe("missing semicolon");
    expect(errors[1]?.line).toBe(9);
    expect(errors[1]?.column).toBe(1);
    expect(errors[1]?.message).toBe("unknown shape 'banana'");
  });

  it("falls back to 'near line N' if no path:line:col available", () => {
    const errors = parseEngineError("d2", "ambiguous edge near line 14");
    expect(errors[0]?.line).toBe(14);
  });
});

describe("parseEngineError — fallback", () => {
  it("returns rawBody for unknown engines", () => {
    const errors = parseEngineError("excalidraw", "something exploded");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBeUndefined();
    expect(errors[0]?.column).toBeUndefined();
    expect(errors[0]?.message).toBe("something exploded");
  });

  it("returns a sentinel message on empty input", () => {
    const errors = parseEngineError("mermaid", "");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("empty");
  });
});
