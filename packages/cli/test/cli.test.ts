import { describe, expect, it } from "bun:test";
import { parseArgs, run, CLI_VERSION } from "../src/cli";

describe("parseArgs", () => {
  it("splits positionals from flags", () => {
    const r = parseArgs(["push", "file.mmd", "--engine", "mermaid"]);
    expect(r.positionals).toEqual(["push", "file.mmd"]);
    expect(r.flags.engine).toBe("mermaid");
  });

  it("handles --key=value syntax", () => {
    const r = parseArgs(["--engine=d2", "file.d2"]);
    expect(r.flags.engine).toBe("d2");
    expect(r.positionals).toEqual(["file.d2"]);
  });

  it("treats a trailing --flag without value as boolean true", () => {
    const r = parseArgs(["--help"]);
    expect(r.flags.help).toBe(true);
  });

  it("treats -h as --help", () => {
    const r = parseArgs(["-h"]);
    expect(r.flags.help).toBe(true);
  });
});

describe("run", () => {
  it("prints help and exits 0 when called with no args", async () => {
    let out = "";
    const code = await run({
      argv: [],
      outFn: (m) => {
        out += m;
      },
      errFn: () => undefined,
    });
    expect(code).toBe(0);
    expect(out).toContain("Usage: prixmaviz <command>");
  });

  it("prints help with --help", async () => {
    let out = "";
    const code = await run({
      argv: ["--help"],
      outFn: (m) => {
        out += m;
      },
      errFn: () => undefined,
    });
    expect(code).toBe(0);
    expect(out).toContain("login");
    expect(out).toContain("push");
    expect(out).toContain("pull");
    expect(out).toContain("list");
    expect(out).toContain("export-workspace");
    expect(out).toContain("import-workspace");
  });

  it("prints the CLI version with --version", async () => {
    let out = "";
    const code = await run({
      argv: ["--version"],
      outFn: (m) => {
        out += m;
      },
      errFn: () => undefined,
    });
    expect(code).toBe(0);
    expect(out.trim()).toBe(CLI_VERSION);
  });

  it("rejects unknown commands with exit 2", async () => {
    let err = "";
    const code = await run({
      argv: ["banana"],
      outFn: () => undefined,
      errFn: (m) => {
        err += m;
      },
    });
    expect(code).toBe(2);
    expect(err).toContain("unknown command: banana");
  });

  it("returns exit 2 when push has no file arg", async () => {
    let err = "";
    const code = await run({
      argv: ["push"],
      outFn: () => undefined,
      errFn: (m) => {
        err += m;
      },
    });
    expect(code).toBe(2);
    expect(err).toContain("push: expected file path");
  });

  it("returns exit 2 when pull format is invalid", async () => {
    let err = "";
    const code = await run({
      argv: ["pull", "x", "--format", "bmp"],
      outFn: () => undefined,
      errFn: (m) => {
        err += m;
      },
    });
    expect(code).toBe(2);
    expect(err).toContain("--format must be svg|png|jpeg");
  });
});
