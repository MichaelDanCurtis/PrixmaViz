#!/usr/bin/env node
/**
 * prixmaviz — command-line interface
 *
 * Hand-rolled argv parsing (matches the shim's style — see
 * packages/shim/src/index.ts). Six commands; no top-level dependencies
 * beyond Node + Bun runtime APIs.
 */

import { login } from "./commands/login";
import { push } from "./commands/push";
import { pull, type PullFormat } from "./commands/pull";
import { list } from "./commands/list";
import { exportWorkspace } from "./commands/export-workspace";
import { importWorkspace } from "./commands/import-workspace";

export const CLI_VERSION = "0.1.0";

const HELP_TEXT = [
  "prixmaviz — PrixmaViz command-line interface",
  "",
  "Usage: prixmaviz <command> [options]",
  "",
  "Commands:",
  "  login                                  Save server URL + workspace token to config",
  "  push <file> [opts]                     Upload a DSL source file, render, save as a diagram",
  "      --engine <name>                    Override engine detection",
  "      --name <name>                      Override diagram name (default: filename)",
  "      --tags a,b,c                       Tag the diagram",
  "  pull <slug> [opts]                     Download a rendered diagram",
  "      --format svg|png|jpeg              Default: svg",
  "      --out <path>                       Default: ./<slug>.<ext>",
  "  list [opts]                            Print workspace library as a table",
  "      --engine <name>                    Filter by engine",
  "      --tag <tag>                        Filter by tag",
  "  export-workspace --out <dir>           Stream workspace as .pviz to <dir>",
  "  import-workspace <bundle.pviz>         Upload a .pviz bundle, create a NEW workspace",
  "",
  "Options:",
  "  --help, -h                             Show this help",
  "  --version                              Print CLI version",
  "",
  "Config path by platform:",
  "  macOS:   ~/Library/Application Support/PrixmaViz/cli-config.json",
  "  Linux:   $XDG_CONFIG_HOME/prixmaviz/config.json (default: ~/.config/...)",
  "  Windows: %APPDATA%\\PrixmaViz\\cli-config.json",
  "",
].join("\n");

/**
 * Minimal argv parser: separates positional args from `--flag value` /
 * `--flag=value` / boolean `--flag` pairs. Returns the rest of argv after
 * known flags are stripped so each command can re-parse its own.
 *
 * Doesn't try to be a full getopt — we have six commands with at most
 * three options each, and we want the test harness to introspect the
 * result without depending on a library.
 */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        // --key=value
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (a === "-h") {
      flags.help = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** Convert a flag value to a string, throwing if it's missing or boolean. */
function requireStringFlag(flags: ParsedArgs["flags"], key: string): string {
  const v = flags[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`--${key} requires a value`);
  }
  return v;
}

/** Read an optional string flag (returns undefined when boolean/missing). */
function optionalStringFlag(
  flags: ParsedArgs["flags"],
  key: string,
): string | undefined {
  const v = flags[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export interface RunOpts {
  argv?: string[];
  outFn?: (msg: string) => void;
  errFn?: (msg: string) => void;
}

/**
 * Top-level dispatch. Returns the exit code rather than calling
 * process.exit, so tests can run it in-process.
 */
export async function run(opts: RunOpts = {}): Promise<number> {
  const argv = opts.argv ?? process.argv.slice(2);
  const out = opts.outFn ?? ((m: string) => process.stdout.write(m));
  const err = opts.errFn ?? ((m: string) => process.stderr.write(m));

  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    // No-argv path also shows help so a bare invocation isn't a hard error.
    out(HELP_TEXT);
    return argv.length === 0 ? 0 : 0;
  }
  if (argv.includes("--version")) {
    out(`${CLI_VERSION}\n`);
    return 0;
  }

  const [cmd, ...rest] = argv;
  const parsed = parseArgs(rest);

  try {
    switch (cmd) {
      case "login": {
        await login({
          serverUrl: optionalStringFlag(parsed.flags, "server-url"),
          workspaceToken: optionalStringFlag(parsed.flags, "workspace-token"),
          outFn: out,
        });
        return 0;
      }
      case "push": {
        const file = parsed.positionals[0];
        if (!file) {
          err("push: expected file path\n");
          return 2;
        }
        await push({
          file,
          engine: optionalStringFlag(parsed.flags, "engine"),
          name: optionalStringFlag(parsed.flags, "name"),
          tags: optionalStringFlag(parsed.flags, "tags"),
          outFn: out,
        });
        return 0;
      }
      case "pull": {
        const slug = parsed.positionals[0];
        if (!slug) {
          err("pull: expected slug\n");
          return 2;
        }
        const fmt = optionalStringFlag(parsed.flags, "format");
        const format: PullFormat | undefined =
          fmt === "svg" || fmt === "png" || fmt === "jpeg" ? fmt : undefined;
        if (fmt && !format) {
          err(`pull: --format must be svg|png|jpeg (got "${fmt}")\n`);
          return 2;
        }
        await pull({
          slug,
          format,
          out: optionalStringFlag(parsed.flags, "out"),
          outFn: out,
        });
        return 0;
      }
      case "list": {
        await list({
          engine: optionalStringFlag(parsed.flags, "engine"),
          tag: optionalStringFlag(parsed.flags, "tag"),
          outFn: out,
        });
        return 0;
      }
      case "export-workspace": {
        const outDir = requireStringFlag(parsed.flags, "out");
        await exportWorkspace({ out: outDir, outFn: out });
        return 0;
      }
      case "import-workspace": {
        const bundle = parsed.positionals[0];
        if (!bundle) {
          err("import-workspace: expected bundle path\n");
          return 2;
        }
        await importWorkspace({ bundle, outFn: out });
        return 0;
      }
      default: {
        err(`unknown command: ${cmd}\n\n${HELP_TEXT}`);
        return 2;
      }
    }
  } catch (e) {
    err(`prixmaviz ${cmd}: ${(e as Error).message}\n`);
    return 1;
  }
}

// Only auto-start when this file is invoked directly (i.e. as the bin
// entry point). Importing it from tests doesn't trigger a run.
//
// We support both Bun (`import.meta.main`) and Node, plus standalone-
// compiled binaries (bun --compile sets `import.meta.url` to something
// like blob:/$bunfs/.../cli.ts and process.argv[1] to the binary path).
function isEntryModule(): boolean {
  // Bun-specific: import.meta.main is true when this is the entry module.
  const bunMain = (import.meta as { main?: boolean }).main;
  if (typeof bunMain === "boolean") return bunMain;
  // Node fallback — compare the file:// URL of this module against
  // argv[1]. When `node dist/cli.js` is invoked, import.meta.url points
  // at file:///abs/path/dist/cli.js and process.argv[1] is the same
  // path (possibly without the file:// scheme).
  try {
    const moduleUrl = (import.meta as { url?: string }).url;
    if (!moduleUrl) return false;
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return moduleUrl === `file://${argv1}` || moduleUrl.endsWith(argv1);
  } catch {
    return false;
  }
}

if (isEntryModule()) {
  run().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`prixmaviz error: ${e?.message ?? String(e)}\n`);
      process.exit(1);
    },
  );
}
