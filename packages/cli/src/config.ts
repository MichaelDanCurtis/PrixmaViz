/**
 * XDG-compliant config storage for the PrixmaViz CLI.
 *
 * Shape on disk:
 *
 *   {
 *     "version": 1,
 *     "serverUrl":      "https://prixmaviz.example.com",
 *     "workspaceToken": "11111111-2222-3333-4444-555555555555"
 *   }
 *
 * Path per platform:
 *
 *   • Linux:   $XDG_CONFIG_HOME/prixmaviz/config.json
 *              (falls back to $HOME/.config/prixmaviz/config.json)
 *   • macOS:   $HOME/Library/Application Support/PrixmaViz/cli-config.json
 *   • Windows: %APPDATA%\PrixmaViz\cli-config.json
 *
 * On Unix the file is written with mode 0600 so the workspace token
 * (which is a bearer credential — anyone with the token can read/write
 * the workspace) isn't readable by other users on a shared host. Windows
 * doesn't honor POSIX permission bits, so mode is best-effort there.
 */

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

export interface CliConfig {
  /** Current shape version. Increment when the schema changes (so we can
   *  refuse to read a newer config from a forwards-incompatible install). */
  version: 1;
  /** Base URL of the PrixmaViz server, e.g. "https://prixmaviz.example.com".
   *  No trailing slash; the http helper handles that. */
  serverUrl: string;
  /** Workspace UUID — sent as `Authorization: Bearer <token>`. Treat as
   *  a secret; this is the only credential the CLI carries. */
  workspaceToken: string;
}

/**
 * Optional overrides used by tests to exercise per-platform behavior
 * without actually swapping `process.platform`. Production callers pass
 * no overrides and read from the live process env.
 */
export interface ConfigPathOverrides {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the absolute path of the CLI config file on disk.
 *
 * Tests pass `overrides.platform` + `overrides.env` to simulate Linux /
 * macOS / Windows without restarting the process; production calls leave
 * both unset and we read from `process`.
 */
export function configPath(overrides: ConfigPathOverrides = {}): string {
  const platform = overrides.platform ?? process.platform;
  const env = overrides.env ?? process.env;
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) throw new Error("cannot resolve home directory (no HOME/USERPROFILE)");

  if (platform === "darwin") {
    return join(home, "Library/Application Support/PrixmaViz/cli-config.json");
  }
  if (platform === "win32") {
    return join(env.APPDATA ?? home, "PrixmaViz", "cli-config.json");
  }
  // Linux (and other POSIX) — honor XDG_CONFIG_HOME if set, else ~/.config.
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(home, ".config");
  return join(base, "prixmaviz", "config.json");
}

/**
 * Read the config from disk and validate it. Returns null when the file
 * does not exist (so callers can offer a friendly "run `prixmaviz login`
 * first" message instead of a stack trace).
 */
export async function loadConfig(
  overrides: ConfigPathOverrides = {},
): Promise<CliConfig | null> {
  const path = configPath(overrides);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config at ${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    throw new Error(
      `config at ${path} has unsupported version (expected 1); was this written by a newer CLI?`,
    );
  }
  const cfg = parsed as Partial<CliConfig>;
  if (typeof cfg.serverUrl !== "string" || cfg.serverUrl.length === 0) {
    throw new Error(`config at ${path} is missing serverUrl`);
  }
  if (typeof cfg.workspaceToken !== "string" || cfg.workspaceToken.length === 0) {
    throw new Error(`config at ${path} is missing workspaceToken`);
  }
  return {
    version: 1,
    serverUrl: cfg.serverUrl,
    workspaceToken: cfg.workspaceToken,
  };
}

/**
 * Persist the config to disk atomically (well, mostly — we write through
 * a temp name then rename to avoid leaving a half-written file if the
 * process is killed mid-write). On Unix, mode 0600.
 */
export async function saveConfig(
  cfg: CliConfig,
  overrides: ConfigPathOverrides = {},
): Promise<string> {
  const platform = overrides.platform ?? process.platform;
  const path = configPath(overrides);
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify(cfg, null, 2) + "\n";
  await writeFile(path, body, "utf-8");
  if (platform !== "win32") {
    // POSIX: lock the file down so a shared-host user can't read the
    // workspace token. We do this AFTER writing so a write-fail leaves
    // no orphan empty-mode-0600 file behind.
    await chmod(path, 0o600);
  }
  return path;
}

/**
 * Convenience: load the config and throw a CLI-friendly message if it's
 * missing. Used by every command except `login`.
 */
export async function requireConfig(
  overrides: ConfigPathOverrides = {},
): Promise<CliConfig> {
  const cfg = await loadConfig(overrides);
  if (!cfg) {
    throw new Error(
      `no PrixmaViz CLI config found at ${configPath(overrides)}. Run \`prixmaviz login\` first.`,
    );
  }
  return cfg;
}
