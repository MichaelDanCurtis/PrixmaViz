import { describe, expect, it } from "bun:test";
import { LruBinaryCache, LruSvgCache, binaryCacheKey, svgCacheKey } from "../../src/kroki/cache";

describe("LruSvgCache", () => {
  it("returns undefined on miss", () => {
    const c = new LruSvgCache(1024);
    expect(c.get("key")).toBeUndefined();
  });

  it("returns set value", () => {
    const c = new LruSvgCache(1024);
    c.set("k", "<svg/>");
    expect(c.get("k")).toBe("<svg/>");
  });

  it("evicts least-recently-used when over budget", () => {
    const c = new LruSvgCache(20);
    c.set("a", "0123456789"); // 10 bytes
    c.set("b", "0123456789"); // 10 bytes (cache full)
    c.set("c", "0123456789"); // forces eviction of a
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe("0123456789");
    expect(c.get("c")).toBe("0123456789");
  });

  it("get bumps recency", () => {
    const c = new LruSvgCache(20);
    c.set("a", "0123456789");
    c.set("b", "0123456789");
    c.get("a");
    c.set("c", "0123456789"); // should evict b, not a
    expect(c.get("a")).toBeDefined();
    expect(c.get("b")).toBeUndefined();
  });
});

describe("LruBinaryCache", () => {
  it("returns undefined on miss", () => {
    const c = new LruBinaryCache(1024);
    expect(c.get("key")).toBeUndefined();
  });

  it("stores and returns Uint8Array values", () => {
    const c = new LruBinaryCache(1024);
    const v = new Uint8Array([1, 2, 3]);
    c.set("k", v);
    expect(c.get("k")).toBe(v);
  });

  it("tracks byteLength for budget accounting", () => {
    const c = new LruBinaryCache(20);
    c.set("a", new Uint8Array(10));
    c.set("b", new Uint8Array(10));
    c.set("c", new Uint8Array(10)); // evicts a
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeDefined();
    expect(c.get("c")).toBeDefined();
  });
});

describe("binaryCacheKey", () => {
  it("differs between formats for the same DSL", () => {
    const dsl = "graph TD; A-->B";
    const svgKey = binaryCacheKey("mermaid", "svg", dsl);
    const pngKey = binaryCacheKey("mermaid", "png", dsl);
    const jpegKey = binaryCacheKey("mermaid", "jpeg", dsl);
    expect(svgKey).not.toBe(pngKey);
    expect(svgKey).not.toBe(jpegKey);
    expect(pngKey).not.toBe(jpegKey);
  });

  it("differs between engines for the same DSL+format", () => {
    const dsl = "x";
    expect(binaryCacheKey("mermaid", "svg", dsl)).not.toBe(
      binaryCacheKey("d2", "svg", dsl),
    );
  });

  it("is stable for the same (engine, format, dsl)", () => {
    expect(binaryCacheKey("mermaid", "png", "x")).toBe(
      binaryCacheKey("mermaid", "png", "x"),
    );
  });

  it("is not confused by separator collisions between fields", () => {
    // engine "a", format "bc" vs engine "ab", format "c" — both serialize
    // distinct conceptual triples, so keys must differ.
    expect(binaryCacheKey("a", "bc", "dsl")).not.toBe(
      binaryCacheKey("ab", "c", "dsl"),
    );
  });
});

describe("svgCacheKey (legacy)", () => {
  it("is stable", () => {
    expect(svgCacheKey("mermaid", "x")).toBe(svgCacheKey("mermaid", "x"));
  });
});
