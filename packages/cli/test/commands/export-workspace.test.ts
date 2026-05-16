import { describe, expect, it } from "bun:test";
import { exportWorkspace, sanitizeWorkspaceFilename } from "../../src/commands/export-workspace";
import type { HttpClient } from "../../src/http";

interface FakeCall { method: string; path: string }

function fakeHttp(
  jsonResponses: Record<string, unknown>,
  binaryResponses: Record<string, Uint8Array>,
): { client: HttpClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: HttpClient = {
    async getJson<T = unknown>(path: string): Promise<T> {
      calls.push({ method: "getJson", path });
      if (!(path in jsonResponses)) throw new Error(`unmocked ${path}`);
      return jsonResponses[path] as T;
    },
    async postJson<T = unknown>(): Promise<T> { throw new Error("not impl"); },
    async getBinary(path: string): Promise<Uint8Array> {
      calls.push({ method: "getBinary", path });
      if (!(path in binaryResponses)) throw new Error(`unmocked binary ${path}`);
      return binaryResponses[path]!;
    },
    async postMultipart<T = unknown>(): Promise<T> { throw new Error("not impl"); },
  };
  return { client, calls };
}

const fakeCfg = {
  version: 1 as const,
  serverUrl: "http://localhost:5180",
  workspaceToken: "11111111-2222-3333-4444-555555555555",
};

const WSID = "11111111-2222-3333-4444-555555555555";

describe("sanitizeWorkspaceFilename", () => {
  it("uses the workspace name when set", () => {
    expect(sanitizeWorkspaceFilename("My Workspace", WSID)).toBe("My Workspace");
  });

  it("falls back to id when name is empty", () => {
    expect(sanitizeWorkspaceFilename("", WSID)).toBe(WSID);
    expect(sanitizeWorkspaceFilename("   ", WSID)).toBe(WSID);
    expect(sanitizeWorkspaceFilename(null, WSID)).toBe(WSID);
    expect(sanitizeWorkspaceFilename(undefined, WSID)).toBe(WSID);
  });

  it("replaces path-hostile chars with underscores", () => {
    expect(sanitizeWorkspaceFilename("foo/bar:baz?", WSID)).toBe("foo_bar_baz_");
  });

  it("truncates absurdly long names to 100 chars", () => {
    const out = sanitizeWorkspaceFilename("x".repeat(500), WSID);
    expect(out.length).toBe(100);
  });
});

describe("exportWorkspace", () => {
  it("writes the bundle to <out>/<workspaceName>.pviz", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad]);
    const { client, calls } = fakeHttp(
      {
        "/api/workspace": { id: WSID, name: "Team A" },
      },
      {
        [`/api/workspaces/${WSID}/export`]: bytes,
      },
    );
    let writtenPath = "";
    let writtenBytes: Uint8Array = new Uint8Array();
    const mkdirCalls: string[] = [];
    const result = await exportWorkspace({
      out: "/tmp/backups",
      writeFileFn: async (p, b) => {
        writtenPath = p;
        writtenBytes = b;
      },
      mkdirFn: async (p) => {
        mkdirCalls.push(p);
      },
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(writtenPath).toBe("/tmp/backups/Team A.pviz");
    expect(writtenBytes).toEqual(bytes);
    expect(mkdirCalls).toEqual(["/tmp/backups"]);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/workspace",
      `/api/workspaces/${WSID}/export`,
    ]);
    expect(result.byteCount).toBe(bytes.length);
  });

  it("falls back to <workspaceId>.pviz when name is empty", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { client } = fakeHttp(
      { "/api/workspace": { id: WSID, name: "" } },
      { [`/api/workspaces/${WSID}/export`]: bytes },
    );
    let writtenPath = "";
    await exportWorkspace({
      out: "/tmp/backups",
      writeFileFn: async (p) => {
        writtenPath = p;
      },
      mkdirFn: async () => undefined,
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(writtenPath).toBe(`/tmp/backups/${WSID}.pviz`);
  });

  it("throws when --out is missing or empty", async () => {
    await expect(
      exportWorkspace({
        out: "",
        writeFileFn: async () => undefined,
        mkdirFn: async () => undefined,
        httpFn: () => undefined as unknown as HttpClient,
        loadConfigFn: async () => fakeCfg,
        outFn: () => undefined,
      }),
    ).rejects.toThrow(/--out <dir> is required/);
  });
});
