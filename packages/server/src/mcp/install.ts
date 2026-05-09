import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";

interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MergeResult {
  added: boolean;
  path: string;
  snippet: string;
}

export function mergeMcpConfig(path: string, binaryPath: string): MergeResult {
  const entry: McpEntry = { command: binaryPath, args: ["--mcp"] };
  const snippet = JSON.stringify({ mcpServers: { prixmaviz: entry } }, null, 2);

  let config: { mcpServers?: Record<string, McpEntry> } = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`config at ${path} is not valid JSON; refusing to overwrite`);
    }
    // backup
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(path, `${path}.bak.${stamp}`);
  }

  if (!config.mcpServers) config.mcpServers = {};
  const existing = config.mcpServers.prixmaviz;
  if (existing && existing.command === binaryPath) {
    return { added: false, path, snippet };
  }
  config.mcpServers.prixmaviz = entry;
  writeFileSync(path, JSON.stringify(config, null, 2));
  return { added: true, path, snippet };
}

export function defaultConfigPath(host: "claude-code"): string {
  if (host === "claude-code") {
    if (process.platform === "darwin") {
      return `${process.env.HOME}/Library/Application Support/Claude/claude_desktop_config.json`;
    }
    if (process.platform === "linux") {
      return `${process.env.HOME}/.config/Claude/claude_desktop_config.json`;
    }
    if (process.platform === "win32") {
      return `${process.env.APPDATA}/Claude/claude_desktop_config.json`;
    }
  }
  throw new Error(`unknown host: ${host}`);
}
