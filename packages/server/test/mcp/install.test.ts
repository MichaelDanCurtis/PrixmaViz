import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpConfig } from "../../src/mcp/install";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "inst-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("mergeMcpConfig", () => {
  it("creates entry in fresh config", () => {
    const path = join(dir, "config.json");
    const out = mergeMcpConfig(path, "/bin/prixma");
    expect(out.added).toBe(true);
    const back = JSON.parse(readFileSync(path, "utf8"));
    expect(back.mcpServers.prixmaviz.command).toBe("/bin/prixma");
  });

  it("preserves siblings", () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "/bin/other", args: [] } } }));
    mergeMcpConfig(path, "/bin/prixma");
    const back = JSON.parse(readFileSync(path, "utf8"));
    expect(back.mcpServers.other.command).toBe("/bin/other");
    expect(back.mcpServers.prixmaviz.command).toBe("/bin/prixma");
  });

  it("idempotent", () => {
    const path = join(dir, "config.json");
    mergeMcpConfig(path, "/bin/prixma");
    const second = mergeMcpConfig(path, "/bin/prixma");
    expect(second.added).toBe(false);
  });

  it("creates backup when overwriting", () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "/x" } } }));
    mergeMcpConfig(path, "/bin/prixma");
    const fs = require("node:fs");
    const files = fs.readdirSync(dir);
    expect(files.some((f: string) => f.startsWith("config.json.bak."))).toBe(true);
  });
});
