/**
 * Engine detection from filename extension.
 *
 * The CLI's `push` command accepts an arbitrary source file. To call the
 * server's render endpoint we have to tell it which engine the source is
 * authored in. Most users won't pass `--engine` explicitly, so we try to
 * guess from the extension first. Unknown extension + no override → fail
 * fast with a helpful hint (we don't fall back to a "default" engine
 * because every choice would be wrong for most users).
 */

import { extname } from "node:path";

/** Map from lower-case extension (with leading dot) to engine slug. */
export const EXT_MAP: Record<string, string> = {
  ".mmd": "mermaid",
  ".mermaid": "mermaid",
  ".dot": "graphviz",
  ".gv": "graphviz",
  ".bytefield": "bytefield",
  ".d2": "d2",
  ".puml": "plantuml",
  ".plantuml": "plantuml",
};

export class EngineDetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineDetectError";
  }
}

/**
 * Resolve the engine to use for a given file path, honoring an optional
 * explicit override.
 *
 * - If `override` is provided, return it unchanged. The CLI never second-
 *   guesses an explicit `--engine` — even if the extension would point at
 *   a different engine — because the user might be authoring a `.txt` of
 *   D2 source or similar.
 * - Otherwise, look up the extension in EXT_MAP.
 * - On miss, throw EngineDetectError with the hint.
 */
export function detectEngine(filePath: string, override?: string): string {
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  const ext = extname(filePath).toLowerCase();
  const engine = EXT_MAP[ext];
  if (!engine) {
    throw new EngineDetectError(
      `cannot detect engine from ${ext || "<no extension>"}; pass --engine <name>`,
    );
  }
  return engine;
}
