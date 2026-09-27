import { create } from "zustand";
import { createId } from "@/lib/files";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** A button in the toast; clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">, durationMs?: number) => string;
  dismiss: (id: string) => void;
}

const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (toast, durationMs = 5000) => {
    const id = createId();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
    if (durationMs > 0) setTimeout(() => get().dismiss(id), durationMs);
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-React code paths (e.g. inside async tool handlers). */
export function toast(t: Omit<Toast, "id">, durationMs?: number) {
  return useToastStore.getState().push(t, durationMs);
}
