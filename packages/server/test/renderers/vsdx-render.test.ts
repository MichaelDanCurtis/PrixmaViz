import { describe, expect, it } from "bun:test";
import { VsdxRenderer, VsdxRenderError } from "../../src/renderers/vsdx-render";

describe("VsdxRenderer", () => {
  it("POSTs bytes to /convert/svg and returns SVG text on 200", async () => {
    const calls: { url: string; bodyLen: number }[] = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        bodyLen: (init?.body as Buffer | ArrayBuffer)?.byteLength ?? 0,
      });
      return new Response("<svg width='100' height='100'/>", {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    };
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const svg = await r.render(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(svg).toContain("<svg");
    expect(calls[0]!.url).toBe("http://uno:2003/convert/svg");
    expect(calls[0]!.bodyLen).toBe(4);
  });

  it("caches by content hash", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount++;
      return new Response("<svg/>", { status: 200 });
    };
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    await r.render(bytes);
    await r.render(bytes);
    expect(callCount).toBe(1);
  });

  it("throws VsdxRenderError on non-2xx", async () => {
    const fetchImpl = async () =>
      new Response("conversion failed", { status: 500 });
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(r.render(new Uint8Array([1, 2, 3]))).rejects.toThrow(VsdxRenderError);
  });

  it("respects timeout", async () => {
    const fetchImpl = (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const r = new VsdxRenderer({
      baseUrl: "http://uno:2003",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 50,
    });
    await expect(r.render(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
