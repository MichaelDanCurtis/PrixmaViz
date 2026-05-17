import { describe, expect, it } from "bun:test";
import { pull } from "../../src/commands/pull";
import type { HttpClient } from "../../src/http";

interface FakeCall {
  method: "getJson" | "postJson" | "getBinary" | "postMultipart";
  path: string;
  body?: unknown;
}

/** Build a deterministic HttpClient over a path → response map. */
function fakeHttp(
  responses: Record<string, unknown>,
): { client: HttpClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: HttpClient = {
    async getJson<T = unknown>(path: string): Promise<T> {
      calls.push({ method: "getJson", path });
      if (!(path in responses)) throw new Error(`unmocked getJson ${path}`);
      return responses[path] as T;
    },
    async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "postJson", path, body });
      if (!(path in responses)) throw new Error(`unmocked postJson ${path}`);
      return responses[path] as T;
    },
    async getBinary(path: string): Promise<Uint8Array> {
      calls.push({ method: "getBinary", path });
      throw new Error("not implemented in fake");
    },
    async postMultipart<T = unknown>(path: string): Promise<T> {
      calls.push({ method: "postMultipart", path });
      throw new Error("not implemented in fake");
    },
  };
  return { client, calls };
}

const fakeCfg = {
  version: 1 as const,
  serverUrl: "http://localhost:5180",
  workspaceToken: "11111111-2222-3333-4444-555555555555",
};

const libraryFor = (slug: string, id: string) => ({
  entries: [
    { id, name: "Whatever", path: `${slug}.pviz`, engine: "mermaid", tags: [] },
  ],
});

/** Tiny base64 of 5 bytes 0x00 0x01 0x02 0x03 0x04. */
const FIVE_BYTES_B64 = Buffer.from([0, 1, 2, 3, 4]).toString("base64");

describe("pull", () => {
  it("writes svg to ./<slug>.svg by default", async () => {
    const { client, calls } = fakeHttp({
      "/api/library": libraryFor("my-diagram", "diag-9"),
      "/api/mcp/export_diagram": {
        diagramId: "diag-9",
        format: "svg",
        base64: FIVE_BYTES_B64,
        byteCount: 5,
        suggestedFilename: "my-diagram.svg",
      },
    });
    let writtenPath = "";
    let writtenBytes: Uint8Array = new Uint8Array(0);
    const result = await pull({
      slug: "my-diagram",
      writeFileFn: async (p, b) => {
        writtenPath = p;
        writtenBytes = b;
      },
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(writtenPath).toBe("./my-diagram.svg");
    expect(writtenBytes.length).toBe(5);
    expect(result.format).toBe("svg");
    expect(result.byteCount).toBe(5);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/library",
      "/api/mcp/export_diagram",
    ]);
    // Verify the format was forwarded correctly to the MCP call.
    expect((calls[1]!.body as { format: string }).format).toBe("svg");
  });

  it("uses --format png", async () => {
    const { client, calls } = fakeHttp({
      "/api/library": libraryFor("topo", "diag-x"),
      "/api/mcp/export_diagram": {
        diagramId: "diag-x",
        format: "png",
        base64: FIVE_BYTES_B64,
        byteCount: 5,
        suggestedFilename: "topo.png",
      },
    });
    const result = await pull({
      slug: "topo",
      format: "png",
      writeFileFn: async () => undefined,
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect((calls[1]!.body as { format: string }).format).toBe("png");
    expect(result.outPath).toBe("./topo.png");
  });

  it("uses --format jpeg and writes .jpg extension", async () => {
    const { client } = fakeHttp({
      "/api/library": libraryFor("topo", "diag-x"),
      "/api/mcp/export_diagram": {
        diagramId: "diag-x",
        format: "jpeg",
        base64: FIVE_BYTES_B64,
        byteCount: 5,
        suggestedFilename: "topo.jpg",
      },
    });
    let writtenPath = "";
    await pull({
      slug: "topo",
      format: "jpeg",
      writeFileFn: async (p) => {
        writtenPath = p;
      },
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(writtenPath).toBe("./topo.jpg");
  });

  it("honors --out absolute path", async () => {
    const { client } = fakeHttp({
      "/api/library": libraryFor("hello", "diag-h"),
      "/api/mcp/export_diagram": {
        diagramId: "diag-h",
        format: "svg",
        base64: FIVE_BYTES_B64,
        byteCount: 5,
        suggestedFilename: "hello.svg",
      },
    });
    let writtenPath = "";
    await pull({
      slug: "hello",
      out: "/tmp/h.svg",
      writeFileFn: async (p) => {
        writtenPath = p;
      },
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(writtenPath).toBe("/tmp/h.svg");
  });

  it("throws when slug isn't found in the library", async () => {
    const { client } = fakeHttp({
      "/api/library": { entries: [] },
    });
    await expect(
      pull({
        slug: "missing",
        writeFileFn: async () => undefined,
        httpFn: () => client,
        loadConfigFn: async () => fakeCfg,
        outFn: () => undefined,
      }),
    ).rejects.toThrow(/no diagram with slug "missing"/);
  });

  it("rejects unsupported formats", async () => {
    const { client } = fakeHttp({});
    await expect(
      pull({
        slug: "x",
        format: "bmp" as unknown as "svg",
        writeFileFn: async () => undefined,
        httpFn: () => client,
        loadConfigFn: async () => fakeCfg,
        outFn: () => undefined,
      }),
    ).rejects.toThrow(/unsupported format "bmp"/);
  });
});
