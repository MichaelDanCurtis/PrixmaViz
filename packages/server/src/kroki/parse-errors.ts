import type { DiagramEngine } from "@prixmaviz/shared";

/**
 * A single structured parser/render error returned by `parseEngineError`.
 * `line` and `column` are 1-based when the engine reports them; absent
 * when the engine's error text does not pin a location.
 */
export interface EngineParseError {
  line?: number;
  column?: number;
  message: string;
}

/**
 * Convert an engine's raw error string (typically the response body from a
 * Kroki 400) into one or more structured `{ line?, column?, message }`
 * records. The `validate_dsl` MCP tool (Wave 2) consumes this so agents can
 * jump straight to the offending line instead of regex-scraping in the
 * model.
 *
 * Each per-engine branch tries a small number of well-known patterns. The
 * fallback for unknown engines (or engines whose error text doesn't match
 * any known shape) is a single `{ message: rawBody }` so the caller still
 * gets something actionable.
 *
 * The function is intentionally pure (no I/O, no logging) and string-only
 * so it can be unit-tested with fixtures.
 */
export function parseEngineError(
  engine: DiagramEngine | string,
  rawBody: string,
): EngineParseError[] {
  const body = (rawBody ?? "").trim();
  if (!body) return [{ message: "(empty error body)" }];

  switch (engine) {
    case "mermaid":
      return parseMermaid(body);
    case "graphviz":
    case "dot":
      return parseGraphviz(body);
    case "plantuml":
    case "c4plantuml":
      return parsePlantUml(body);
    case "d2":
      return parseD2(body);
    default:
      return [{ message: body }];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Per-engine parsers
//
// Each parser tries known patterns in order. When nothing matches, it falls
// back to the bare body so the caller still gets the engine's raw message.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Mermaid (kroki returns the upstream mermaid stderr). Examples:
 *   "Parse error on line 5: ... Expecting ..."
 *   "Lexical error on line 3. Unrecognized text. ..."
 *   "Error: Parse error on line 2:\n  ..."
 */
function parseMermaid(body: string): EngineParseError[] {
  const onLine = /(?:Parse|Lexical)\s+error\s+on\s+line\s+(\d+)(?::|\.)?\s*([\s\S]*)/i.exec(body);
  if (onLine) {
    const line = Number(onLine[1]);
    const rest = (onLine[2] ?? "").trim();
    return [{ line, message: rest || "parse error" }];
  }
  // Some mermaid errors carry `line N:M` or `at line N column M`.
  const lc = /\bline\s+(\d+)(?:\s*[:,]\s*column\s+|\s*:\s*)(\d+)\b/i.exec(body);
  if (lc) {
    return [{ line: Number(lc[1]), column: Number(lc[2]), message: body }];
  }
  const justLine = /\bline\s+(\d+)\b/i.exec(body);
  if (justLine) {
    return [{ line: Number(justLine[1]), message: body }];
  }
  return [{ message: body }];
}

/**
 * Graphviz / DOT. Kroki surfaces stderr from the `dot` binary. Examples:
 *   "Error: <stdin>: syntax error in line 3 near 'a'"
 *   "syntax error in line 7"
 *   "Warning: <stdin>: scanner error: ... at line 4"
 */
function parseGraphviz(body: string): EngineParseError[] {
  const out: EngineParseError[] = [];
  // Many graphviz error texts include multiple "syntax error in line N" lines.
  const re = /(?:syntax|scanner|parse|lex)\s+error[^]*?\bline\s+(\d+)\b[^\n]*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({ line: Number(m[1]), message: m[0].trim() });
  }
  if (out.length > 0) return out;

  // Fallback: any "line N" mention.
  const justLine = /\bline\s+(\d+)\b/i.exec(body);
  if (justLine) {
    return [{ line: Number(justLine[1]), message: body }];
  }
  return [{ message: body }];
}

/**
 * PlantUML. Kroki returns errors that typically look like:
 *   "Syntax Error?  on line 4"
 *   "ERROR\n12\nSome problem here"
 *   "Some sort of bug detected at line 3, column 7"
 */
function parsePlantUml(body: string): EngineParseError[] {
  // PlantUML's "ERROR\n<line>\n<message>" framing.
  const errFramed = /^ERROR\s*\n\s*(\d+)\s*\n([\s\S]+)$/i.exec(body);
  if (errFramed) {
    return [{ line: Number(errFramed[1]), message: errFramed[2]!.trim() }];
  }
  // "at line N, column M" or "on line N column M".
  const lc = /\b(?:at|on)\s+line\s+(\d+)(?:\s*,\s*column\s+|\s+column\s+|:)(\d+)\b/i.exec(body);
  if (lc) {
    return [{ line: Number(lc[1]), column: Number(lc[2]), message: body }];
  }
  // Plain "line N".
  const onLine = /\b(?:at|on)\s+line\s+(\d+)\b/i.exec(body);
  if (onLine) {
    return [{ line: Number(onLine[1]), message: body }];
  }
  return [{ message: body }];
}

/**
 * D2. Returns rich JSON-ish errors via Kroki, but the raw body usually has
 * `err: foo.d2:LINE:COL: message` lines. We pull each occurrence into its
 * own structured entry so agents can see multi-error responses.
 */
function parseD2(body: string): EngineParseError[] {
  const out: EngineParseError[] = [];
  // `path:line:col: message` — the canonical d2 CLI format. Match per-line
  // with the `m` flag so each line in a multi-error body produces its own
  // entry. Allow an optional `err:` / `error:` / `warning:` prefix that
  // d2 sometimes emits.
  const re = /^(?:\s*(?:err|error|warning)\s*:\s*)?[^\s:][^\n:]*?:\s*(\d+):(\d+):\s*([^\n]+)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({
      line: Number(m[1]),
      column: Number(m[2]),
      message: m[3]!.trim(),
    });
  }
  if (out.length > 0) return out;

  // Sometimes d2 says "near line N" without a column.
  const near = /near\s+line\s+(\d+)/i.exec(body);
  if (near) {
    return [{ line: Number(near[1]), message: body }];
  }
  return [{ message: body }];
}
