import { describe, expect, it, beforeEach } from "vitest";
import { useToastStore, toastError, toastSuccess } from "../../src/lib/toast";

describe("toast store", () => {
  beforeEach(() => {
    // Reset between tests
    useToastStore.setState({ toasts: [] });
  });

  it("pushes a toast and returns its id", () => {
    const id = useToastStore.getState().push({ kind: "info", message: "hello", ttlMs: 0 });
    expect(id).toMatch(/^t_/);
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0]!.message).toBe("hello");
  });

  it("dismisses by id", () => {
    const id = useToastStore.getState().push({ kind: "error", message: "oops", ttlMs: 0 });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  it("toastError pushes an error-kind toast", () => {
    toastError("nope");
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0]!.kind).toBe("error");
    expect(toasts[0]!.message).toBe("nope");
  });

  it("toastSuccess pushes a success-kind toast", () => {
    toastSuccess("yay");
    expect(useToastStore.getState().toasts[0]!.kind).toBe("success");
  });
});
