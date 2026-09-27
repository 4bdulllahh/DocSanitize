"use client";

import clsx from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
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

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
    >
      {toasts.map((t) => {
        const { icon: Icon, className } = TONES[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-elev-2"
          >
            <Icon className={clsx("mt-0.5 size-4.5 shrink-0", className)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm break-words text-fg-muted">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(t.id);
                    t.action!.onClick();
                  }}
                  className="mt-2.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-m-1 self-start rounded-md p-1 text-fg-subtle hover:bg-surface-muted hover:text-fg"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
