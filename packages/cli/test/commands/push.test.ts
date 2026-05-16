import { describe, expect, it } from "bun:test";
import { push } from "../../src/commands/push";
import type { HttpClient } from "../../src/http";

/**
 * Build a tiny fake HttpClient that records the calls made to it. The
 * push command exercises postJson exactly once (render-dsl) plus
 * optionally once more (apply tags). Everything else throws so we know
 * if push starts calling a new path unexpectedly.
 */
interface FakeCall {
  method: "getJson" | "postJson" | "getBinary" | "postMultipart";
  path: string;
  body?: unknown;
}

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

describe("push", () => {
  it("uploads detected-engine source and prints slug", async () => {
    const { client, calls } = fakeHttp({
      "/api/render-dsl": { diagramId: "diag-1", slug: "my-diagram" },
    });
    let stdout = "";
    const result = await push({
      file: "/tmp/example.mmd",
      readFileFn: async () => "graph TD; A-->B",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: (m) => {
        stdout += m;
      },
    });
    expect(result.slug).toBe("my-diagram");
    expect(stdout.trim()).toBe("my-diagram");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/render-dsl");
    expect(calls[0]!.method).toBe("postJson");
    const body = calls[0]!.body as { engine: string; source: string; name: string };
    expect(body.engine).toBe("mermaid");
    expect(body.source).toBe("graph TD; A-->B");
    // Default name comes from the file basename minus extension.
    expect(body.name).toBe("example");
  });

  it("honors --engine override even for known extensions", async () => {
    const { client, calls } = fakeHttp({
      "/api/render-dsl": { diagramId: "diag-x", slug: "x" },
    });
    await push({
      file: "/tmp/foo.mmd",
      engine: "plantuml",
      readFileFn: async () => "@startuml\nA -> B\n@enduml",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    const body = calls[0]!.body as { engine: string };
    expect(body.engine).toBe("plantuml");
  });

  it("uses --name when provided", async () => {
    const { client, calls } = fakeHttp({
      "/api/render-dsl": { diagramId: "diag-x", slug: "named-slug" },
    });
    await push({
      file: "/tmp/example.mmd",
      name: "Custom Name",
      readFileFn: async () => "graph TD; A-->B",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect((calls[0]!.body as { name: string }).name).toBe("Custom Name");
  });

  it("applies tags via a follow-up /save POST when --tags is set", async () => {
    const { client, calls } = fakeHttp({
      "/api/render-dsl": { diagramId: "diag-7", slug: "tagged" },
      "/api/diagrams/diag-7/save": { diagram: {} },
    });
    await push({
      file: "/tmp/example.mmd",
      tags: "infra, prod , ,",
      readFileFn: async () => "graph TD; A-->B",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.path).toBe("/api/diagrams/diag-7/save");
    // Empty tokens from the trailing commas are dropped.
    expect((calls[1]!.body as { tags: string[] }).tags).toEqual(["infra", "prod"]);
  });

  it("skips the /save call when --tags resolves to an empty list", async () => {
    const { client, calls } = fakeHttp({
      "/api/render-dsl": { diagramId: "diag-7", slug: "tagged" },
    });
    await push({
      file: "/tmp/example.mmd",
      tags: " , , ",
      readFileFn: async () => "graph TD; A-->B",
      httpFn: () => client,
      loadConfigFn: async () => fakeCfg,
      outFn: () => undefined,
    });
    expect(calls).toHaveLength(1);
  });

  it("throws when the source file is empty", async () => {
    const { client } = fakeHttp({});
    await expect(
      push({
        file: "/tmp/example.mmd",
        readFileFn: async () => "",
        httpFn: () => client,
        loadConfigFn: async () => fakeCfg,
        outFn: () => undefined,
      }),
    ).rejects.toThrow(/source file .* is empty/);
  });

  it("throws with the engine-detect hint when extension is unknown", async () => {
    const { client } = fakeHttp({});
    await expect(
      push({
        file: "/tmp/example.xyz",
        readFileFn: async () => "anything",
        httpFn: () => client,
        loadConfigFn: async () => fakeCfg,
        outFn: () => undefined,
      }),
    ).rejects.toThrow(/cannot detect engine from \.xyz; pass --engine <name>/);
  });
});
