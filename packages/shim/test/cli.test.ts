import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { workspaceConfigPath } from "../src/bootstrap";

describe("workspaceConfigPath", () => {
  it("exports a function", () => {
    expect(typeof workspaceConfigPath).toBe("function");
  });

  it("returns an absolute path ending with workspace.txt", () => {
    const p = workspaceConfigPath();
    expect(p.endsWith("workspace.txt")).toBe(true);
    expect(p.length).toBeGreaterThan("workspace.txt".length);
  });

  it("includes PrixmaViz / prixmaviz in the path", () => {
    const p = workspaceConfigPath().toLowerCase();
    expect(p.includes("prixmaviz")).toBe(true);
  });
});

const indexPath = join(import.meta.dir, "..", "src", "index.ts");

describe("CLI flags", () => {
  it("--print-config-path prints the path and exits 0", async () => {
    const proc = Bun.spawn(["bun", indexPath, "--print-config-path"], {
      env: { ...process.env, PRIXMAVIZ_REMOTE_URL: "http://localhost:5180" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(out.trim().endsWith("workspace.txt")).toBe(true);
  });

  it("--help exits 0", async () => {
    const proc = Bun.spawn(["bun", indexPath, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    expect(exit).toBe(0);
  });

  it("--version prints 0.7.0 and exits 0", async () => {
    const proc = Bun.spawn(["bun", indexPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(out.trim()).toBe("0.7.0");
  });
});
