import { describe, expect, it } from "bun:test";
import { LruSvgCache } from "../../src/kroki/cache";

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
