import { describe, expect, it } from "bun:test";
import { slugify, resolveSlug } from "../../src/pviz/slug";

describe("slugify", () => {
  it("kebab-cases simple names", () => {
    expect(slugify("Auth Flow")).toBe("auth-flow");
  });

  it("strips punctuation", () => {
    expect(slugify("data model: v2!")).toBe("data-model-v2");
  });

  it("replaces unicode with hyphen-fallback", () => {
    expect(slugify("café résumé")).toBe("caf-rsum");
  });

  it("collapses repeated hyphens", () => {
    expect(slugify("a___b...c")).toBe("a-b-c");
  });

  it("trims to 80 chars", () => {
    const s = slugify("x".repeat(200));
    expect(s.length).toBeLessThanOrEqual(80);
  });

  it("returns 'untitled' for empty input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!@#$%")).toBe("untitled");
  });
});

describe("resolveSlug", () => {
  it("returns base when no conflict", () => {
    expect(resolveSlug("auth-flow", new Set())).toBe("auth-flow");
  });

  it("appends -2 on first conflict", () => {
    expect(resolveSlug("auth-flow", new Set(["auth-flow"]))).toBe("auth-flow-2");
  });

  it("increments until free", () => {
    expect(
      resolveSlug("auth-flow", new Set(["auth-flow", "auth-flow-2", "auth-flow-3"])),
    ).toBe("auth-flow-4");
  });
});
