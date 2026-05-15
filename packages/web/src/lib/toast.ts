import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss after this many ms. Pass 0 to require manual dismiss. */
  ttlMs: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (input) => {
    const id = `t_${Math.random().toString(36).slice(2, 10)}`;
    const toast: Toast = { id, kind: input.kind, message: input.message, ttlMs: input.ttlMs ?? 5000 };
    set({ toasts: [...get().toasts, toast] });
    if (toast.ttlMs > 0) {
      setTimeout(() => get().dismiss(id), toast.ttlMs);
    }
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// Helper for quick error notifications — matches the existing alert() call shape.
export function toastError(message: string): void {
  useToastStore.getState().push({ kind: "error", message, ttlMs: 8000 });
}

export function toastSuccess(message: string): void {
  useToastStore.getState().push({ kind: "success", message, ttlMs: 4000 });
}

export function toastInfo(message: string): void {
  useToastStore.getState().push({ kind: "info", message, ttlMs: 4000 });
}
