import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAppRunning, lockfilePath } from "../../src/mcp/lifecycle";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "lifecycle-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("lockfilePath", () => {
  it("appends instance.json to stateDir", () => {
    expect(lockfilePath("/tmp/state")).toBe("/tmp/state/instance.json");
  });
});

describe("isAppRunning", () => {
  it("returns {running:false, port:null} when lockfile missing", async () => {
    const r = await isAppRunning(join(dir, "missing.lock"));
    expect(r.running).toBe(false);
    expect(r.port).toBeNull();
  });

  it("returns {running:true, port:N} when lockfile present with valid port", async () => {
    const path = join(dir, "instance.lock");
    writeFileSync(path, JSON.stringify({ pid: process.pid, port: 5180, startedAt: new Date().toISOString() }));
    const r = await isAppRunning(path);
    expect(r.running).toBe(true);
    expect(r.port).toBe(5180);
  });

  it("returns {running:false} when lockfile is malformed JSON", async () => {
    const path = join(dir, "bad.lock");
    writeFileSync(path, "{not json");
    const r = await isAppRunning(path);
    expect(r.running).toBe(false);
    expect(r.port).toBeNull();
  });
});
