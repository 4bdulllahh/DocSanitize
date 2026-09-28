"use client";

import { Lock, Upload } from "lucide-react";
import { extensionsFor } from "@/lib/files";
import type { Tool } from "@/lib/tools";
import { useT } from "@/store/locale";

/** Empty-state drop target. Actual drops are handled window-wide by useWindowFileDrop. */
export function Dropzone({ tool, onBrowse }: { tool: Tool; onBrowse: () => void }) {
  const t = useT();
  const browse = <span className="text-brand-text underline underline-offset-4">{t("browse")}</span>;
  const [before, after] = (tool.multiFile ? t("Drop files here or {browse}") : t("Drop a file here or {browse}")).split("{browse}");
  return (
    <div className="flex flex-1 items-center justify-center p-4 lg:p-10">
      <button
        type="button"
        onClick={onBrowse}
        className="group flex w-full max-w-2xl flex-col items-center rounded-2xl border-2 border-dashed border-line-strong bg-surface px-6 py-16 text-center transition-colors hover:border-brand hover:bg-brand-soft/40"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-text transition-transform group-hover:-translate-y-0.5">
          <Upload className="size-6" aria-hidden="true" />
        </span>
        <span className="mt-5 text-lg font-semibold text-fg">
          {before}
          {browse}
          {after}
        </span>
        <span className="mt-1.5 text-sm text-fg-muted">
          {t("{formats} · each file opens in its own tab", { formats: extensionsFor(tool.accepts).map(t.dynamic).join(", ") })}
        </span>
        <span className="mt-6 inline-flex items-center gap-1.5 text-xs text-fg-subtle">
          <Lock className="size-3.5 text-success" aria-hidden="true" />
          {t("Processed on this device. Nothing is uploaded.")}
        </span>
      </button>
    </div>
  );
}

export function DropOverlay({ tool }: { tool: Tool }) {
  const t = useT();
  return (
    <div className="pointer-events-none fixed inset-0 z-[55] flex items-center justify-center bg-canvas/80 p-6 backdrop-blur-sm">
      <div className="flex w-full max-w-xl flex-col items-center rounded-2xl border-2 border-dashed border-brand bg-surface px-6 py-14 text-center shadow-elev-2">
        <Upload className="size-8 text-brand-text" aria-hidden="true" />
        <p className="mt-3 text-lg font-semibold text-fg">{t("Drop to open in {tool}", { tool: t(tool.name) })}</p>
        <p className="mt-1 text-sm text-fg-muted">{extensionsFor(tool.accepts).map(t.dynamic).join(", ")}</p>
      </div>
    </div>
  );
}
