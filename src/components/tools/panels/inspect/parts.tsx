"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { Finding, Severity } from "@/lib/scan/findings";

/* Shared pieces of the Inspect tools: a list of findings, ranked by how much they matter. */

const SEVERITY: Record<Severity, { label: string; icon: typeof Info; tone: string; badge: string }> = {
  high: { label: "Check this", icon: CircleAlert, tone: "text-danger", badge: "bg-danger/10 text-danger-text" },
  medium: { label: "Worth knowing", icon: TriangleAlert, tone: "text-warning", badge: "bg-warning-soft text-fg" },
  info: { label: "Info", icon: Info, tone: "text-fg-subtle", badge: "bg-surface-muted text-fg-muted" },
};

const RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

export function EmptyFindings({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-14 text-center">
      <CircleCheck className="size-8 text-success" aria-hidden="true" />
      <p className="font-semibold text-fg">{title}</p>
      <p className="max-w-md text-sm text-fg-muted">{detail}</p>
    </div>
  );
}

/** Findings, most important first, each with its details and an optional action. */
export function FindingList({ title, findings, actions }: { title: string; findings: Finding[]; actions?: Partial<Record<string, ReactNode>> }) {
  const sorted = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        <span>{title}</span>
        <span className="normal-case tracking-normal">
          {(["high", "medium", "info"] as Severity[])
            .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
            .filter(([, n]) => n > 0)
            .map(([s, n]) => `${n} ${SEVERITY[s].label.toLowerCase()}`)
            .join(" · ")}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {sorted.map((f) => {
          const { icon: Icon, tone, badge, label } = SEVERITY[f.severity];
          return (
            <li key={f.id} className="flex gap-3 px-4 py-3.5">
              <Icon className={clsx("mt-0.5 size-5 shrink-0", tone)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-fg">{f.title}</span>
                  <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase", badge)}>{label}</span>
                </p>
                {f.detail && <p className="mt-1 text-sm text-fg-muted">{f.detail}</p>}
                {f.items && f.items.length > 0 && (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">
                    {f.items.map((item, i) => (
                      <li key={i} className="break-all" dir="auto">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {actions?.[f.id] && <div className="mt-2">{actions[f.id]}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
