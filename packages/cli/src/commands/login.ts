/**
 * `prixmaviz login` — interactive prompt for the server URL and workspace
 * token, then write the config to the XDG-appropriate location.
 *
 * Non-interactive flags are accepted too (`--server-url`, `--workspace-token`)
 * so CI pipelines can configure the CLI without a TTY.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { saveConfig, type CliConfig, type ConfigPathOverrides } from "../config";

export interface LoginOpts {
  /** Pre-supplied server URL — skips the prompt when set. */
  serverUrl?: string;
  /** Pre-supplied workspace token — skips the prompt when set. */
  workspaceToken?: string;
  /** Optional config-path overrides for testing. */
  pathOverrides?: ConfigPathOverrides;
  /** Optional override of the prompt fn — tests inject a deterministic reader. */
  promptFn?: (question: string) => Promise<string>;
  /** Where to write user-visible output. */
  outFn?: (msg: string) => void;
}

/**
 * Run the login flow. Returns the path the config was written to so
 * tests can assert on it.
 */
export async function login(opts: LoginOpts = {}): Promise<string> {
  const out = opts.outFn ?? ((msg: string) => process.stdout.write(msg));

  const prompt = opts.promptFn ?? (async (question: string) => {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  });

  let serverUrl = opts.serverUrl?.trim();
  if (!serverUrl) {
    serverUrl = (await prompt("Server URL (e.g. https://prixmaviz.example.com): ")).trim();
  }
  if (!serverUrl) {
    throw new Error("server URL is required");
  }
  // Light sanity check — catch the common "forgot the scheme" mistake.
  // We allow http:// for local dev, but bare hostnames will fail every
  // subsequent call so reject them up front.
  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error(
      `server URL must start with http:// or https:// (got "${serverUrl}")`,
    );
  }

  let workspaceToken = opts.workspaceToken?.trim();
  if (!workspaceToken) {
    workspaceToken = (await prompt("Workspace token (UUID): ")).trim();
  }
  if (!workspaceToken) {
    throw new Error("workspace token is required");
  }
  // UUID v4-ish — same shape the bearer middleware accepts. We don't
  // validate against the server here; that happens on the first real
  // call. But catching obvious typos before writing the config saves a
  // confusing 401 later.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    workspaceToken,
  )) {
    throw new Error(
      `workspace token must be a UUID (got "${workspaceToken}")`,
    );
  }

  const cfg: CliConfig = {
    version: 1,
    serverUrl: serverUrl.replace(/\/$/, ""),
    workspaceToken: workspaceToken.toLowerCase(),
  };
  const path = await saveConfig(cfg, opts.pathOverrides);
  out(`Saved PrixmaViz CLI config to ${path}\n`);
  return path;
}
