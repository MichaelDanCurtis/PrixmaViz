import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createCallTool, SHIM_VERSION } from "../src/index";
import { workspaceConfigPath } from "../src/bootstrap";

const REMOTE = "https://prixmaviz.example.com";
const STALE_ID = "00000000-stale-stale-stale-000000000000";
const FRESH_ID = "11111111-fresh-fresh-fresh-111111111111";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

interface Deps {
  fetchCalls: Array<{ url: string; headers: Headers; body: string }>;
  renamed: Array<{ from: string; to: string }>;
  logs: string[];
  resolveCalls: number;
  fetchFn: typeof fetch;
  resolveWorkspaceIdFn: (remoteUrl: string) => Promise<string>;
  renameFn: (a: string, b: string) => Promise<void>;
  workspaceConfigPathFn: () => string;
  logFn: (msg: string) => void;
  nowSecondsFn: () => number;
}

function mkDeps(fetchResponses: Response[]): Deps {
  let i = 0;
  const fetchCalls: Array<{ url: string; headers: Headers; body: string }> = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const logs: string[] = [];
  let resolveCalls = 0;
  return {
    fetchCalls,
    renamed,
    logs,
    get resolveCalls() {
      return resolveCalls;
    },
    fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? init.body : "";
      fetchCalls.push({ url, headers, body });
      const r = fetchResponses[i++];
      if (!r) throw new Error(`unexpected fetch call #${i}`);
      return r;
    },
    resolveWorkspaceIdFn: async (_remoteUrl: string) => {
      resolveCalls++;
      return FRESH_ID;
    },
    renameFn: async (from: string, to: string) => {
      renamed.push({ from, to });
    },
    workspaceConfigPathFn: () => "/tmp/test/workspace.txt",
    logFn: (msg: string) => {
      logs.push(msg);
    },
    nowSecondsFn: () => 1747353600, // fixed value for deterministic backup names
  } as Deps;
}

describe("workspaceConfigPath", () => {
  it("returns a non-empty platform-specific path", () => {
    const p = workspaceConfigPath();
    expect(p).toBeTruthy();
    expect(p).toContain("workspace.txt");
  });

  it("matches documented path on darwin", () => {
    if (process.platform !== "darwin") return;
    const home = process.env.HOME!;
    expect(workspaceConfigPath()).toBe(
      join(home, "Library/Application Support/PrixmaViz/workspace.txt")
    );
  });

  it("matches documented path on linux", () => {
    if (process.platform !== "linux") return;
    const home = process.env.HOME!;
    expect(workspaceConfigPath()).toBe(join(home, ".config/prixmaviz/workspace.txt"));
  });

  it("matches documented path on win32", () => {
    if (process.platform !== "win32") return;
    const base = process.env.APPDATA ?? process.env.USERPROFILE!;
    expect(workspaceConfigPath()).toBe(join(base, "PrixmaViz/workspace.txt"));
  });
});

describe("createCallTool 401 recovery", () => {
  it("succeeds on a 200 with no recovery", async () => {
    const deps = mkDeps([jsonResponse({ ok: true, value: 42 })]);
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    const result = await callTool("list_diagrams", { tag: "x" });

    expect(result).toEqual({ ok: true, value: 42 });
    expect(deps.fetchCalls.length).toBe(1);
    expect(deps.resolveCalls).toBe(0);
    expect(deps.renamed.length).toBe(0);
    expect(deps.logs.length).toBe(0);
    // Bearer used the original id.
    expect(deps.fetchCalls[0]!.headers.get("Authorization")).toBe(`Bearer ${STALE_ID}`);
    expect(deps.fetchCalls[0]!.headers.get("X-PrixmaViz-Shim-Version")).toBe(SHIM_VERSION);
    expect(deps.fetchCalls[0]!.url).toBe(`${REMOTE}/api/mcp/list_diagrams`);
  });

  it("re-bootstraps on 401 and retries once with the new workspace id", async () => {
    const deps = mkDeps([unauthorized(), jsonResponse({ ok: true, recovered: true })]);
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    const result = await callTool("render_dsl", { engine: "mermaid", source: "graph TD;A-->B" });

    expect(result).toEqual({ ok: true, recovered: true });
    expect(deps.fetchCalls.length).toBe(2);
    expect(deps.resolveCalls).toBe(1);

    // First call used the stale id.
    expect(deps.fetchCalls[0]!.headers.get("Authorization")).toBe(`Bearer ${STALE_ID}`);
    // Retry used the fresh id.
    expect(deps.fetchCalls[1]!.headers.get("Authorization")).toBe(`Bearer ${FRESH_ID}`);

    // Cache file was moved aside with the timestamped backup name.
    expect(deps.renamed.length).toBe(1);
    expect(deps.renamed[0]!.from).toBe("/tmp/test/workspace.txt");
    expect(deps.renamed[0]!.to).toBe("/tmp/test/workspace.txt.bak-401-recovery-1747353600");

    // stderr log mentions both old and new prefixes.
    expect(deps.logs.length).toBe(1);
    expect(deps.logs[0]!).toContain("workspace 401 detected");
    expect(deps.logs[0]!).toContain(STALE_ID.slice(0, 8));
    expect(deps.logs[0]!).toContain(FRESH_ID.slice(0, 8));
  });

  it("does not loop: a second 401 throws with the retry's error", async () => {
    const deps = mkDeps([unauthorized(), unauthorized()]);
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    await expect(callTool("save_diagram", { diagramId: "d1" })).rejects.toThrow(/HTTP 401/);

    expect(deps.fetchCalls.length).toBe(2);
    // We attempted recovery exactly once.
    expect(deps.resolveCalls).toBe(1);
    expect(deps.renamed.length).toBe(1);
  });

  it("ignores rename failure (cache file may not exist)", async () => {
    const deps = mkDeps([unauthorized(), jsonResponse({ ok: true })]);
    deps.renameFn = async () => {
      throw new Error("ENOENT");
    };
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    // No throw — recovery should still proceed and the retry should succeed.
    const result = await callTool("list_diagrams", {});
    expect(result).toEqual({ ok: true });
    expect(deps.resolveCalls).toBe(1);
  });

  it("passes through non-401 errors verbatim (no recovery attempt)", async () => {
    const deps = mkDeps([
      new Response("internal error", { status: 500 }),
    ]);
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    await expect(callTool("render_dsl", { engine: "mermaid", source: "" })).rejects.toThrow(
      /HTTP 500/
    );
    expect(deps.resolveCalls).toBe(0);
    expect(deps.renamed.length).toBe(0);
  });

  it("coalesces concurrent 401s into a single recovery", async () => {
    // Two callTool calls in flight; the server returns 401 to both, then 200
    // to both retries. We expect only ONE resolveWorkspaceId and ONE rename.
    const deps = mkDeps([
      unauthorized(),
      unauthorized(),
      jsonResponse({ ok: true, n: 1 }),
      jsonResponse({ ok: true, n: 2 }),
    ]);
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    const [r1, r2] = await Promise.all([
      callTool("list_diagrams", { tag: "a" }),
      callTool("list_diagrams", { tag: "b" }),
    ]);

    expect(r1).toEqual({ ok: true, n: 1 });
    expect(r2).toEqual({ ok: true, n: 2 });

    // Both initial fetches went out with the stale token (concurrent).
    expect(deps.fetchCalls[0]!.headers.get("Authorization")).toBe(`Bearer ${STALE_ID}`);
    expect(deps.fetchCalls[1]!.headers.get("Authorization")).toBe(`Bearer ${STALE_ID}`);
    // Both retries used the fresh token.
    expect(deps.fetchCalls[2]!.headers.get("Authorization")).toBe(`Bearer ${FRESH_ID}`);
    expect(deps.fetchCalls[3]!.headers.get("Authorization")).toBe(`Bearer ${FRESH_ID}`);

    // Recovery happened exactly once despite two concurrent 401s.
    expect(deps.resolveCalls).toBe(1);
    expect(deps.renamed.length).toBe(1);
    expect(deps.logs.length).toBe(1);
  });

  it("recovers again on a fresh 401 after a prior successful recovery", async () => {
    // First call: 401 then 200 (recovers).
    // Second call (later): 401 again — recovery latch should have released, allowing a second recovery.
    const deps = mkDeps([
      unauthorized(),
      jsonResponse({ ok: true, first: true }),
      unauthorized(),
      jsonResponse({ ok: true, second: true }),
    ]);
    const callTool = createCallTool(REMOTE, STALE_ID, deps);

    const first = await callTool("list_diagrams", {});
    expect(first).toEqual({ ok: true, first: true });
    expect(deps.resolveCalls).toBe(1);

    const second = await callTool("list_diagrams", {});
    expect(second).toEqual({ ok: true, second: true });
    expect(deps.resolveCalls).toBe(2);
    expect(deps.renamed.length).toBe(2);
  });
});
