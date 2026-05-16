/**
 * `prixmaviz push <file>` — upload a DSL source file to the server, render
 * it, and persist it as a diagram. Prints the resulting slug.
 *
 * Flags:
 *   --engine <name>   override extension-based detection
 *   --name <name>     diagram name (default: basename without extension)
 *   --tags a,b        comma-separated tag list
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { detectEngine } from "../engine-detect";
import { createHttpClient, type HttpClient } from "../http";
import { requireConfig, type ConfigPathOverrides } from "../config";

export interface PushOpts {
  /** Source file path. */
  file: string;
  /** Engine override (`--engine`). */
  engine?: string;
  /** Diagram name (`--name`); defaults to filename sans extension. */
  name?: string;
  /** Comma-separated tags (`--tags`). */
  tags?: string;
  /** Override fs.readFile (for tests). */
  readFileFn?: (path: string) => Promise<string>;
  /** Override HttpClient builder (for tests). */
  httpFn?: (cfg: import("../config").CliConfig) => HttpClient;
  /** Override config loader (for tests). */
  loadConfigFn?: () => Promise<import("../config").CliConfig>;
  /** Where to write stdout. */
  outFn?: (msg: string) => void;
  /** Optional config-path overrides for testing. */
  pathOverrides?: ConfigPathOverrides;
}

export interface PushResult {
  /** Slug the server assigned (URL-safe; matches /api/library entries). */
  slug: string;
  /** Internal diagram id — handy for follow-up calls. */
  diagramId: string;
}

/**
 * Server response from POST /api/render-dsl. We narrow to just the
 * fields we need; the route returns a few more (render payload, warnings)
 * that the CLI doesn't use.
 */
interface RenderDslResponse {
  diagramId: string;
  slug: string;
}

/**
 * POST /api/diagrams/:id/save — patch the freshly-created diagram with
 * the user's tags (the render-dsl endpoint doesn't accept tags inline).
 */
async function applyTagsIfAny(
  http: HttpClient,
  diagramId: string,
  tagsCsv: string | undefined,
): Promise<void> {
  if (!tagsCsv) return;
  const tags = tagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tags.length === 0) return;
  await http.postJson(`/api/diagrams/${encodeURIComponent(diagramId)}/save`, {
    tags,
  });
}

export async function push(opts: PushOpts): Promise<PushResult> {
  const out = opts.outFn ?? ((msg: string) => process.stdout.write(msg));
  const readFn = opts.readFileFn ?? ((p: string) => readFile(p, "utf-8"));

  const engine = detectEngine(opts.file, opts.engine);

  const source = await readFn(opts.file);
  if (source.length === 0) {
    throw new Error(`source file ${opts.file} is empty`);
  }

  const name = (opts.name ?? basename(opts.file, extname(opts.file))).trim();
  if (!name) throw new Error("diagram name resolved to empty string");

  const cfg = opts.loadConfigFn
    ? await opts.loadConfigFn()
    : await requireConfig(opts.pathOverrides);
  const http = opts.httpFn ? opts.httpFn(cfg) : createHttpClient(cfg);

  const resp = await http.postJson<RenderDslResponse>("/api/render-dsl", {
    engine,
    source,
    name,
  });

  await applyTagsIfAny(http, resp.diagramId, opts.tags);

  out(`${resp.slug}\n`);
  return { slug: resp.slug, diagramId: resp.diagramId };
}
