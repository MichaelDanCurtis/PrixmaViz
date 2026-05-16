/**
 * `prixmaviz import-workspace <bundle.pviz>` — upload a .pviz zip to the
 * server, which ALWAYS creates a brand-new workspace (per Issue #8 spec).
 * Prints the new workspace id.
 *
 * The bundle is passed through as-is in a multipart form; the server
 * handles the zip parsing.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHttpClient, type HttpClient } from "../http";
import { requireConfig, type ConfigPathOverrides, type CliConfig } from "../config";

export interface ImportWorkspaceOpts {
  /** Path to the .pviz bundle file. */
  bundle: string;
  /** Override fs.readFile (for tests). */
  readFileFn?: (path: string) => Promise<Buffer>;
  /** Override HttpClient (for tests). */
  httpFn?: (cfg: CliConfig) => HttpClient;
  /** Override config loader (for tests). */
  loadConfigFn?: () => Promise<CliConfig>;
  /** Output sink. */
  outFn?: (msg: string) => void;
  /** Optional config-path overrides for testing. */
  pathOverrides?: ConfigPathOverrides;
}

export interface ImportWorkspaceResult {
  workspaceId: string;
}

/**
 * Server response from /api/workspaces/import. The actual shape comes
 * from importBundle() in pviz-import.ts; we narrow to the field we need.
 */
interface ImportResponse {
  workspaceId: string;
}

export async function importWorkspace(
  opts: ImportWorkspaceOpts,
): Promise<ImportWorkspaceResult> {
  if (!opts.bundle || opts.bundle.trim().length === 0) {
    throw new Error("bundle path is required");
  }

  const out = opts.outFn ?? ((msg: string) => process.stdout.write(msg));
  const readFn =
    opts.readFileFn ?? ((p: string) => readFile(p));

  const cfg = opts.loadConfigFn
    ? await opts.loadConfigFn()
    : await requireConfig(opts.pathOverrides);
  const http = opts.httpFn ? opts.httpFn(cfg) : createHttpClient(cfg);

  const buf = await readFn(opts.bundle);
  // Build a Blob from the Buffer so FormData can stream it as a file
  // part. We use application/zip because that's what .pviz is on the
  // wire; the server's parseBundle() validates magic regardless.
  const blob = new Blob([new Uint8Array(buf)], { type: "application/zip" });
  const form = new FormData();
  form.append("file", blob, basename(opts.bundle));

  const resp = await http.postMultipart<ImportResponse>(
    "/api/workspaces/import",
    form,
  );
  if (!resp.workspaceId) {
    throw new Error("server response missing workspaceId");
  }

  out(`${resp.workspaceId}\n`);
  return { workspaceId: resp.workspaceId };
}
