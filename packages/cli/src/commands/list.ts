/**
 * `prixmaviz list` — print diagrams in the current workspace as a table.
 *
 * Flags:
 *   --engine <name>   filter by engine (matches case-insensitively)
 *   --tag <tag>       filter by tag (matches case-insensitively)
 *
 * The server's /api/library endpoint doesn't accept engine/tag filters
 * inline (it returns the full library), so we apply the filter client-
 * side. That's fine for the CLI's scale — workspaces are tens to low
 * hundreds of diagrams.
 */

import { createHttpClient, type HttpClient } from "../http";
import { requireConfig, type ConfigPathOverrides, type CliConfig } from "../config";

export interface ListOpts {
  /** Engine filter, e.g. "mermaid". */
  engine?: string;
  /** Tag filter — single tag for now. */
  tag?: string;
  /** Override HttpClient builder (for tests). */
  httpFn?: (cfg: CliConfig) => HttpClient;
  /** Override config loader (for tests). */
  loadConfigFn?: () => Promise<CliConfig>;
  /** Where to write the table. */
  outFn?: (msg: string) => void;
  /** Optional config-path overrides for testing. */
  pathOverrides?: ConfigPathOverrides;
}

export interface LibraryEntry {
  id: string;
  name: string;
  path: string;
  engine: string;
  tags?: string[];
  lastOpenedAt?: string | null;
  updatedAt?: string;
}

interface LibraryListResponse {
  entries: LibraryEntry[];
}

/**
 * Render a table to a string. We avoid `console.table` because (a) it
 * prints to stdout directly instead of returning a string, which
 * complicates testing, and (b) its output is wider than terminal-
 * friendly. Hand-rolled is short enough.
 */
export function renderTable(rows: LibraryEntry[]): string {
  if (rows.length === 0) {
    return "(no diagrams)\n";
  }
  const headers = ["name", "engine", "tags", "lastOpenedAt"] as const;
  const cells: string[][] = rows.map((r) => [
    r.name,
    r.engine,
    (r.tags ?? []).join(",") || "-",
    r.lastOpenedAt ?? "-",
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => row[i]!.length)),
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const lines: string[] = [];
  lines.push(headers.map((h, i) => pad(h, widths[i]!)).join("  "));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of cells) {
    lines.push(row.map((c, i) => pad(c, widths[i]!)).join("  "));
  }
  return lines.join("\n") + "\n";
}

/**
 * Apply the engine/tag filters to the library payload. Case-insensitive
 * — users shouldn't have to remember whether the server stored "Mermaid"
 * or "mermaid".
 */
export function filterEntries(
  rows: LibraryEntry[],
  engine?: string,
  tag?: string,
): LibraryEntry[] {
  const engineFilter = engine?.trim().toLowerCase();
  const tagFilter = tag?.trim().toLowerCase();
  return rows.filter((r) => {
    if (engineFilter && r.engine.toLowerCase() !== engineFilter) return false;
    if (tagFilter) {
      const tags = (r.tags ?? []).map((t) => t.toLowerCase());
      if (!tags.includes(tagFilter)) return false;
    }
    return true;
  });
}

export async function list(opts: ListOpts = {}): Promise<LibraryEntry[]> {
  const out = opts.outFn ?? ((msg: string) => process.stdout.write(msg));

  const cfg = opts.loadConfigFn
    ? await opts.loadConfigFn()
    : await requireConfig(opts.pathOverrides);
  const http = opts.httpFn ? opts.httpFn(cfg) : createHttpClient(cfg);

  const lib = await http.getJson<LibraryListResponse>("/api/library");
  const filtered = filterEntries(lib.entries, opts.engine, opts.tag);
  out(renderTable(filtered));
  return filtered;
}
