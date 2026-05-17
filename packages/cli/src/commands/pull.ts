/**
 * `prixmaviz pull <slug>` — fetch a rendered diagram from the server and
 * write it to disk in the requested format.
 *
 * Flags:
 *   --format svg|png|jpeg   default svg
 *   --out <path>            output path; default ./<slug>.<ext>
 *
 * Implementation: look the slug up via GET /api/library (since
 * export_diagram needs an internal id, not the slug), then invoke the
 * MCP tool via POST /api/mcp/export_diagram, which returns the bytes
 * base64-encoded.
 */

import { writeFile } from "node:fs/promises";
import { createHttpClient, type HttpClient } from "../http";
import { requireConfig, type ConfigPathOverrides, type CliConfig } from "../config";

export type PullFormat = "svg" | "png" | "jpeg";

export interface PullOpts {
  /** Diagram slug to look up. */
  slug: string;
  /** Export format. Default "svg". */
  format?: PullFormat;
  /** Output path. Default "./<slug>.<ext>". */
  out?: string;
  /** Override fs.writeFile (for tests). */
  writeFileFn?: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Override HttpClient builder (for tests). */
  httpFn?: (cfg: CliConfig) => HttpClient;
  /** Override config loader (for tests). */
  loadConfigFn?: () => Promise<CliConfig>;
  /** Where to write user-visible output. */
  outFn?: (msg: string) => void;
  /** Optional config-path overrides for testing. */
  pathOverrides?: ConfigPathOverrides;
}

export interface PullResult {
  /** Path the bytes were written to. */
  outPath: string;
  /** Number of bytes written — handy for tests + the user-facing log. */
  byteCount: number;
  /** Format that was actually fetched (after defaulting). */
  format: PullFormat;
}

interface LibraryListResponse {
  entries: Array<{ id: string; path: string; name: string }>;
}

interface ExportDiagramResponse {
  diagramId: string;
  format: PullFormat;
  base64: string;
  byteCount: number;
  suggestedFilename: string;
}

const SUPPORTED_FORMATS: ReadonlyArray<PullFormat> = ["svg", "png", "jpeg"];

/**
 * Resolve a slug to a diagram id via /api/library. We chose this path
 * (instead of a slug-keyed endpoint) because /api/library is already
 * shipped and shared with the web library view — one less round-trip
 * surface to maintain.
 */
async function resolveSlug(
  http: HttpClient,
  slug: string,
): Promise<string> {
  const lib = await http.getJson<LibraryListResponse>("/api/library");
  const entry = lib.entries.find((e) => stripPviz(e.path) === slug);
  if (!entry) {
    throw new Error(`no diagram with slug "${slug}" in workspace library`);
  }
  return entry.id;
}

/** Strip a trailing `.pviz` from the library row's synthesized path. */
function stripPviz(path: string): string {
  // Library entries currently look like "<slug>.pviz". Be tolerant of
  // forward slashes in case folders ever get prefixed.
  const last = path.split("/").pop() ?? path;
  return last.endsWith(".pviz") ? last.slice(0, -".pviz".length) : last;
}

/** Map "jpeg" → "jpg" so the on-disk filename matches user expectations. */
function extForFormat(format: PullFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export async function pull(opts: PullOpts): Promise<PullResult> {
  const format: PullFormat = opts.format ?? "svg";
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(
      `unsupported format "${format}" — must be one of ${SUPPORTED_FORMATS.join(", ")}`,
    );
  }

  const out = opts.outFn ?? ((msg: string) => process.stdout.write(msg));
  const writeFn =
    opts.writeFileFn ?? ((p: string, bytes: Uint8Array) => writeFile(p, bytes));

  const cfg = opts.loadConfigFn
    ? await opts.loadConfigFn()
    : await requireConfig(opts.pathOverrides);
  const http = opts.httpFn ? opts.httpFn(cfg) : createHttpClient(cfg);

  const diagramId = await resolveSlug(http, opts.slug);

  const resp = await http.postJson<ExportDiagramResponse>(
    "/api/mcp/export_diagram",
    { diagramId, format },
  );

  // Defensive: the server already validated the format, but a misrouted
  // proxy could in theory hand us a different one. Trust but verify.
  if (resp.format !== format) {
    throw new Error(
      `server returned format ${resp.format} but requested ${format}`,
    );
  }

  const bytes = Buffer.from(resp.base64, "base64");
  const outPath = opts.out ?? `./${opts.slug}.${extForFormat(format)}`;
  await writeFn(outPath, new Uint8Array(bytes));
  out(`wrote ${bytes.length} bytes to ${outPath}\n`);

  return {
    outPath,
    byteCount: bytes.length,
    format,
  };
}
