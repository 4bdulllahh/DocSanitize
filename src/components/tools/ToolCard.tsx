"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Tool } from "@/lib/tools";
import { useT } from "@/store/locale";

export function ToolCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const t = useT();
  return (
    <Link
      href={`/tools/${tool.id}`}
      className="group flex flex-col rounded-xl border border-line bg-surface p-5 transition-all hover:border-brand-border hover:shadow-elev-1"
    >
      <div className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand-text">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {tool.status === "planned" && (
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">{t("Soon")}</span>
        )}
      </div>
      <h3 className="mt-4 font-semibold text-fg">{t(tool.name)}</h3>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-fg-muted">{t(tool.description)}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-text opacity-0 transition-opacity group-hover:opacity-100">
        {t("Open tool")} <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
      </span>
    </Link>
  );
}
