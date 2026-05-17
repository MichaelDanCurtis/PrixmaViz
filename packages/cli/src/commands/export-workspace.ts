/**
 * `prixmaviz export-workspace --out <dir>` — stream the current workspace
 * as a `.pviz` zip bundle to disk.
 *
 * The Wave 1B server returns the workspace name in the Content-Disposition
 * filename, so we honor that when picking a basename. If parsing fails,
 * we fall back to "<workspaceId>.pviz".
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHttpClient, type HttpClient } from "../http";
import { requireConfig, type ConfigPathOverrides, type CliConfig } from "../config";

export interface ExportWorkspaceOpts {
  /** Output directory. The file is written as `<workspaceName>.pviz`. */
  out: string;
  /** Override HttpClient (for tests). */
  httpFn?: (cfg: CliConfig) => HttpClient;
  /** Override config loader (for tests). */
  loadConfigFn?: () => Promise<CliConfig>;
  /** Override fs.writeFile (for tests). */
  writeFileFn?: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Override fs.mkdir (for tests). */
  mkdirFn?: (path: string, opts: { recursive: boolean }) => Promise<void>;
  /** Output sink. */
  outFn?: (msg: string) => void;
  /** Optional config-path overrides for testing. */
  pathOverrides?: ConfigPathOverrides;
}

export interface ExportWorkspaceResult {
  /** Path the .pviz file was written to. */
  outPath: string;
  /** Bytes written. */
  byteCount: number;
}

/**
 * GET /api/workspace returns the workspace metadata (including `name`).
 * Used as a sidecar call so we can name the .pviz file something other
 * than "<uuid>.pviz".
 */
interface WorkspaceMeta {
  id: string;
  name?: string | null;
}

/**
 * Filesystem-friendly version of the workspace name. Matches the server
 * sanitizer (strips control chars + path separators), then falls back to
 * the workspace id if the result would be empty.
 */
export function sanitizeWorkspaceFilename(name: string | null | undefined, id: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) return id;
  return trimmed.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 100) || id;
}

export async function exportWorkspace(
  opts: ExportWorkspaceOpts,
): Promise<ExportWorkspaceResult> {
  if (!opts.out || opts.out.trim().length === 0) {
    throw new Error("--out <dir> is required");
  }

  const out = opts.outFn ?? ((msg: string) => process.stdout.write(msg));
  const writeFn =
    opts.writeFileFn ?? ((p: string, b: Uint8Array) => writeFile(p, b));
  const mkdirFn =
    opts.mkdirFn ??
    (async (p: string, o: { recursive: boolean }) => {
      await mkdir(p, o);
    });

  const cfg = opts.loadConfigFn
    ? await opts.loadConfigFn()
    : await requireConfig(opts.pathOverrides);
  const http = opts.httpFn ? opts.httpFn(cfg) : createHttpClient(cfg);

  // Hit /api/workspace first to learn the workspace id + display name.
  // The export route requires :id and accepts only the caller's own.
  const ws = await http.getJson<WorkspaceMeta>("/api/workspace");
  if (!ws.id) throw new Error("server did not return a workspace id");

  const bytes = await http.getBinary(
    `/api/workspaces/${encodeURIComponent(ws.id)}/export`,
  );

  await mkdirFn(opts.out, { recursive: true });

  const baseName = sanitizeWorkspaceFilename(ws.name, ws.id);
  const outPath = join(opts.out, `${baseName}.pviz`);
  await writeFn(outPath, bytes);

  out(`wrote ${bytes.length} bytes to ${outPath}\n`);
  return { outPath, byteCount: bytes.length };
}

/**
 * Helper used by the CLI argv layer: refuse to overwrite an existing
 * .pviz file unless the user passes a different --out. Not used by
 * exportWorkspace() itself because tests inject a fake writeFn.
 */
export async function assertOutDirWritable(dir: string): Promise<void> {
  if (!existsSync(dir)) return; // mkdir will create it
  const s = await stat(dir);
  if (!s.isDirectory()) {
    throw new Error(`--out ${dir} exists and is not a directory`);
  }
}
