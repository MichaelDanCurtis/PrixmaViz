import { describe, expect, it } from "vitest";
import { isTypingTarget } from "../../src/lib/shortcuts";

describe("isTypingTarget", () => {
  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns true for INPUT elements", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
  });

  it("returns true for TEXTAREA elements", () => {
    const ta = document.createElement("textarea");
    expect(isTypingTarget(ta)).toBe(true);
  });

  it("returns true for SELECT elements", () => {
    const sel = document.createElement("select");
    expect(isTypingTarget(sel)).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = document.createElement("div");
    // happy-dom's `isContentEditable` does NOT read the attribute the same
    // way real browsers do; assigning the property directly is the portable
    // path. The predicate's job is to honor whichever signal the runtime
    // chose to expose.
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });
    expect(isTypingTarget(div)).toBe(true);
  });

  it("returns false for plain DIV / BUTTON / SPAN", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.createElement("span"))).toBe(false);
  });

  it("returns false for non-Element targets", () => {
    // window itself is an EventTarget but not an Element; the predicate must
    // not throw on it (real keydowns can have window as the target during
    // tests).
    expect(isTypingTarget(window as unknown as EventTarget)).toBe(false);
  });
});
