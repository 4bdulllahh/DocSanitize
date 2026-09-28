"use client";

import clsx from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useT } from "@/store/locale";
import { useToastStore, type ToastTone } from "@/store/toast";

const TONES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-brand-text" },
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleAlert, className: "text-danger" },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  // Titles and texts arrive in English (marked with msg(), or errors from the workers).
  const t = useT();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:start-auto sm:w-96"
    >
      {toasts.map((toast) => {
        const { icon: Icon, className } = TONES[toast.tone];
        return (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-elev-2"
          >
            <Icon className={clsx("mt-0.5 size-4.5 shrink-0", className)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{t.dynamic(toast.title)}</p>
              {toast.description && <p className="mt-0.5 text-sm break-words text-fg-muted">{t.dynamic(toast.description)}</p>}
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(toast.id);
                    toast.action!.onClick();
                  }}
                  className="mt-2.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
                >
                  {t.dynamic(toast.action.label)}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="-m-1 self-start rounded-md p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg"
              aria-label={t("Dismiss notification")}
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
