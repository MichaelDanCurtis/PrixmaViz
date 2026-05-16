import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath,
  loadConfig,
  saveConfig,
  requireConfig,
  type CliConfig,
} from "../src/config";

/**
 * Helper: build a tmp HOME directory that gets cleaned up after the
 * test. This lets every test write a fresh config without colliding on
 * the real user's machine.
 */
const TMP_DIRS: string[] = [];
function mkTmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "prixmaviz-cli-test-"));
  TMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of TMP_DIRS.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore cleanup races */
    }
  }
});

describe("configPath", () => {
  it("resolves the macOS path under ~/Library/Application Support", () => {
    const p = configPath({
      platform: "darwin",
      env: { HOME: "/Users/alice" },
    });
    expect(p).toBe(
      "/Users/alice/Library/Application Support/PrixmaViz/cli-config.json",
    );
  });

  it("resolves the Linux path under XDG_CONFIG_HOME when set", () => {
    const p = configPath({
      platform: "linux",
      env: { HOME: "/home/alice", XDG_CONFIG_HOME: "/home/alice/.dotfiles/conf" },
    });
    expect(p).toBe("/home/alice/.dotfiles/conf/prixmaviz/config.json");
  });

  it("falls back to $HOME/.config when XDG_CONFIG_HOME is empty", () => {
    // Empty string for XDG_CONFIG_HOME should NOT be honored — it's an
    // unset-ish value per the XDG spec. We use $HOME/.config instead.
    const p = configPath({
      platform: "linux",
      env: { HOME: "/home/alice", XDG_CONFIG_HOME: "" },
    });
    expect(p).toBe("/home/alice/.config/prixmaviz/config.json");
  });

  it("falls back to $HOME/.config when XDG_CONFIG_HOME is unset", () => {
    const p = configPath({
      platform: "linux",
      env: { HOME: "/home/alice" },
    });
    expect(p).toBe("/home/alice/.config/prixmaviz/config.json");
  });

  it("resolves the Windows path under %APPDATA%", () => {
    const p = configPath({
      platform: "win32",
      env: {
        USERPROFILE: "C:\\Users\\Alice",
        APPDATA: "C:\\Users\\Alice\\AppData\\Roaming",
      },
    });
    // join() normalizes separators per platform — we don't assert on the
    // exact slashes, just on the presence of the meaningful segments.
    expect(p.includes("PrixmaViz")).toBe(true);
    expect(p.endsWith("cli-config.json")).toBe(true);
    expect(p.includes("AppData")).toBe(true);
  });

  it("throws when neither HOME nor USERPROFILE is set", () => {
    expect(() => configPath({ platform: "linux", env: {} })).toThrow(
      /cannot resolve home directory/,
    );
  });
});

describe("saveConfig / loadConfig round-trip", () => {
  it("writes and reads back a config", async () => {
    const home = mkTmpHome();
    const overrides = { platform: "linux" as NodeJS.Platform, env: { HOME: home } };
    const cfg: CliConfig = {
      version: 1,
      serverUrl: "https://example.com",
      workspaceToken: "11111111-2222-3333-4444-555555555555",
    };
    const path = await saveConfig(cfg, overrides);
    expect(path).toBe(`${home}/.config/prixmaviz/config.json`);
    const loaded = await loadConfig(overrides);
    expect(loaded).toEqual(cfg);
  });

  it("writes the config with mode 0600 on Unix", async () => {
    const home = mkTmpHome();
    const overrides = { platform: "linux" as NodeJS.Platform, env: { HOME: home } };
    const cfg: CliConfig = {
      version: 1,
      serverUrl: "http://localhost:5180",
      workspaceToken: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    const path = await saveConfig(cfg, overrides);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when the config file does not exist", async () => {
    const home = mkTmpHome();
    const overrides = { platform: "linux" as NodeJS.Platform, env: { HOME: home } };
    const loaded = await loadConfig(overrides);
    expect(loaded).toBeNull();
  });

  it("requireConfig throws a helpful error when missing", async () => {
    const home = mkTmpHome();
    const overrides = { platform: "linux" as NodeJS.Platform, env: { HOME: home } };
    await expect(requireConfig(overrides)).rejects.toThrow(/Run `prixmaviz login`/);
  });

  it("rejects a config with an unknown version (future schema)", async () => {
    const home = mkTmpHome();
    const overrides = { platform: "linux" as NodeJS.Platform, env: { HOME: home } };
    const cfg = {
      version: 999,
      serverUrl: "http://x",
      workspaceToken: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    const dir = join(home, ".config/prixmaviz");
    const path = join(dir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, JSON.stringify(cfg));
    await expect(loadConfig(overrides)).rejects.toThrow(/unsupported version/);
  });

  it("writes JSON that's pretty-printed (newline-terminated, 2-space indent)", async () => {
    // Pretty-printing the on-disk JSON makes it diff-friendly when users
    // commit their config (occasionally a thing in team setups).
    const home = mkTmpHome();
    const overrides = { platform: "linux" as NodeJS.Platform, env: { HOME: home } };
    const cfg: CliConfig = {
      version: 1,
      serverUrl: "https://example.com",
      workspaceToken: "11111111-2222-3333-4444-555555555555",
    };
    const path = await saveConfig(cfg, overrides);
    const raw = readFileSync(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.includes('  "version": 1')).toBe(true);
  });
});
