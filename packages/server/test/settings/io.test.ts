import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings, defaultSettings } from "../../src/settings/io";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "settings-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("settings IO", () => {
  it("returns defaults when file missing", async () => {
    const s = await readSettings(join(dir, "missing.json"));
    expect(s).toEqual(defaultSettings());
  });

  it("roundtrips", async () => {
    const path = join(dir, "settings.json");
    const settings = { krokiUrl: "http://localhost:18000" };
    await writeSettings(path, settings);
    const back = await readSettings(path);
    expect(back.krokiUrl).toBe("http://localhost:18000");
  });

  it("returns defaults on parse error", async () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not json");
    const s = await readSettings(path);
    expect(s).toEqual(defaultSettings());
  });
});
