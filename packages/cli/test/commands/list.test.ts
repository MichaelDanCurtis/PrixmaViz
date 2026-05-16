import { describe, expect, it } from "bun:test";
import { list, renderTable, filterEntries } from "../../src/commands/list";
import type { HttpClient } from "../../src/http";

interface FakeCall { method: string; path: string }

function fakeHttp(responses: Record<string, unknown>): { client: HttpClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: HttpClient = {
    async getJson<T = unknown>(path: string): Promise<T> {
      calls.push({ method: "getJson", path });
      if (!(path in responses)) throw new Error(`unmocked ${path}`);
      return responses[path] as T;
    },
    async postJson<T = unknown>(): Promise<T> { throw new Error("not impl"); },
    async getBinary(): Promise<Uint8Array> { throw new Error("not impl"); },
    async postMultipart<T = unknown>(): Promise<T> { throw new Error("not impl"); },
  };
  return { client, calls };
}

const fakeCfg = {
  version: 1 as const,
  serverUrl: "http://localhost:5180",
  workspaceToken: "11111111-2222-3333-4444-555555555555",
};

const SAMPLE_ENTRIES = [
  {
    id: "1",
    name: "alpha",
    path: "alpha.pviz",
    engine: "mermaid",
    tags: ["infra"],
    lastOpenedAt: "2026-05-10T00:00:00Z",
  },
  {
    id: "2",
    name: "beta",
    path: "beta.pviz",
    engine: "d2",
    tags: ["docs", "infra"],
    lastOpenedAt: null,
  },
  {
    id: "3",
    name: "gamma",
    path: "gamma.pviz",
    engine: "mermaid",
    tags: ["docs"],
    lastOpenedAt: "2026-05-11T00:00:00Z",
  },
];

describe("filterEntries", () => {
  it("returns everything when no filters", () => {
    expect(filterEntries(SAMPLE_ENTRIES).length).toBe(3);
  });

  it("filters by engine, case-insensitive", () => {
    const got = filterEntries(SAMPLE_ENTRIES, "MERMAID");
    expect(got.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("filters by tag", () => {
    const got = filterEntries(SAMPLE_ENTRIES, undefined, "docs");
    expect(got.map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("filters by both engine and tag (AND)", () => {
    const got = filterEntries(SAMPLE_ENTRIES, "mermaid", "docs");
    expect(got.map((e) => e.id)).toEqual(["3"]);
  });
});

describe("renderTable", () => {
  it("renders a header + separator + body row", () => {
    const out = renderTable([SAMPLE_ENTRIES[0]!]);
    const lines = out.trimEnd().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]!).toContain("name");
    expect(lines[0]!).toContain("engine");
    expect(lines[0]!).toContain("tags");
    expect(lines[0]!).toContain("lastOpenedAt");
    // Separator row is dashes only.
    expect(/^[- ]+$/.test(lines[1]!)).toBe(true);
    expect(lines[2]!).toContain("alpha");
    expect(lines[2]!).toContain("mermaid");
    expect(lines[2]!).toContain("infra");
    expect(lines[2]!).toContain("2026-05-10");
  });

  it("prints \"(no diagrams)\" for an empty workspace", () => {
    expect(renderTable([])).toBe("(no diagrams)\n");
  });

  it("renders missing lastOpenedAt as -", () => {
    const out = renderTable([SAMPLE_ENTRIES[1]!]);
    // "beta" row should have a single literal `-` in the lastOpenedAt column.
    expect(/beta\s+d2\s+docs,infra\s+-/.test(out)).toBe(true);
  });

  it("renders missing tags as -", () => {
    const out = renderTable([
      { ...SAMPLE_ENTRIES[0]!, tags: [] },
    ]);
    expect(/alpha\s+mermaid\s+-/.test(out)).toBe(true);
  });
});

describe("list", () => {
  it("hits /api/library and prints filtered table", async () => {
    const { client, calls } = fakeHttp({
      "/api/library": { entries: SAMPLE_ENTRIES },
    });
    let stdout = "";
    const filtered = await list({
      engine: "mermaid",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: (m) => {
        stdout += m;
      },
    });
    expect(calls.map((c) => c.path)).toEqual(["/api/library"]);
    expect(filtered.length).toBe(2);
    expect(stdout).toContain("alpha");
    expect(stdout).toContain("gamma");
    expect(stdout).not.toContain("beta");
  });

  it("propagates both engine + tag filters to the rendered table", async () => {
    const { client } = fakeHttp({
      "/api/library": { entries: SAMPLE_ENTRIES },
    });
    let stdout = "";
    const filtered = await list({
      engine: "mermaid",
      tag: "docs",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: (m) => {
        stdout += m;
      },
    });
    expect(filtered.map((e) => e.id)).toEqual(["3"]);
    expect(stdout).toContain("gamma");
  });
});
