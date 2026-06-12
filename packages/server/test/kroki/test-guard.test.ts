import { describe, expect, it } from "bun:test";
import { KrokiClient } from "../../src/kroki/client";
import { fakeKroki } from "../helpers/kroki";

describe("Kroki public-default guard (tests must not hit kroki.io)", () => {
  it("a KrokiClient pointed at the public default refuses to call out during tests", async () => {
    // Explicit public base so the assertion holds regardless of KROKI_URL.
    const client = new KrokiClient({ baseUrl: "https://kroki.io" });
    await expect(client.renderSvg("mermaid", "graph TD\n A --> B")).rejects.toThrow(
      /public https:\/\/kroki\.io/,
    );
  });

  it("fakeKroki renders a canned SVG with no network call", async () => {
    const svg = await fakeKroki().renderSvg("mermaid", "graph TD\n A --> B");
    expect(svg).toContain("<svg");
  });
});
