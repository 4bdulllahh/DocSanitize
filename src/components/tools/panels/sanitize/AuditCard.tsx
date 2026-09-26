"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { CircleAlert, Info, Lock, MapPin, ShieldCheck, TriangleAlert } from "lucide-react";
import type { MetadataEntry, MetadataReport, Sensitivity } from "@/lib/metadata/types";
import type { AuditState } from "./useAudit";

export function AuditCard({ audit }: { audit: AuditState }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface" aria-labelledby="audit-heading">
      <header className="border-b border-line px-5 py-4">
        <h2 id="audit-heading" className="font-semibold text-fg">
          Metadata audit
        </h2>
        <p className="mt-0.5 text-sm text-fg-muted">Everything hidden inside this file, besides its visible content.</p>
      </header>
      {audit.status === "loading" && <AuditSkeleton />}
      {audit.status === "error" && <AuditError message={audit.message} code={audit.code} />}
      {audit.status === "ready" && <AuditResults report={audit.report} />}
    </section>
  );
}

function AuditSkeleton() {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Reading metadata">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-4 w-1/4 animate-pulse rounded bg-surface-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

function AuditError({ message, code }: { message: string; code?: string }) {
  const encrypted = code === "encrypted";
  const Icon = encrypted ? Lock : CircleAlert;
  return (
    <div className="p-5">
      <div className={clsx("flex gap-3 rounded-lg p-4", encrypted ? "bg-warning-soft" : "bg-danger-soft")}>
        <Icon className={clsx("mt-0.5 size-5 shrink-0", encrypted ? "text-warning" : "text-danger")} aria-hidden="true" />
        <div className="text-sm">
          <p className="font-medium text-fg">{encrypted ? "Password-protected PDF" : "Couldn't read this file"}</p>
          <p className="mt-1 text-fg-muted">{message}</p>
          {encrypted && (
            <Link href="/tools/unlock" className="mt-2 inline-block font-medium text-brand-text underline underline-offset-4">
              Open Unlock PDF
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const SENSITIVITY_ORDER: Record<Sensitivity, number> = { high: 0, medium: 1, low: 2 };

function AuditResults({ report }: { report: MetadataReport }) {
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const high = report.entries.filter((e) => e.sensitivity === "high").length;

  const groups = useMemo(() => {
    const visible = sensitiveOnly ? report.entries.filter((e) => e.sensitivity === "high") : report.entries;
    const map = new Map<string, MetadataEntry[]>();
    for (const e of visible) map.set(e.group, [...(map.get(e.group) ?? []), e]);
    // Groups holding the most sensitive data first.
    return [...map].sort(
      ([, a], [, b]) =>
        Math.min(...a.map((e) => SENSITIVITY_ORDER[e.sensitivity])) - Math.min(...b.map((e) => SENSITIVITY_ORDER[e.sensitivity])),
    );
  }, [report.entries, sensitiveOnly]);

  if (report.entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
        <ShieldCheck className="size-9 text-success" aria-hidden="true" />
        <p className="font-semibold text-success-text">0 metadata tags found</p>
        <p className="max-w-sm text-sm text-fg-muted">This file carries no hidden metadata.</p>
        <KeptList kept={report.kept} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-fg">
          {report.entries.length} tag{report.entries.length === 1 ? "" : "s"} found
        </span>
        {high > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-text">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            {high} sensitive
          </span>
        )}
        {high > 0 && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={sensitiveOnly}
              onChange={(e) => setSensitiveOnly(e.target.checked)}
              className="size-4 accent-brand"
            />
            Sensitive only
          </label>
        )}
      </div>

      {report.location && (
        <div className="flex items-start gap-3 border-b border-line bg-warning-soft px-5 py-3 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-fg">
            <span className="font-semibold">This file reveals a location:</span>{" "}
            <span className="font-mono">
              {report.location.latitude.toFixed(5)}, {report.location.longitude.toFixed(5)}
            </span>
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Metadata found in this file</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Value</th>
              <th scope="col">Risk</th>
            </tr>
          </thead>
          {groups.map(([group, entries]) => (
            <tbody key={group}>
              <tr>
                <th colSpan={3} scope="colgroup" className="bg-surface-muted px-5 py-2 text-left text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                  {group}
                </th>
              </tr>
              {entries.map((e, i) => (
                <EntryRow key={`${e.key}-${i}`} entry={e} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {report.kept.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <KeptList kept={report.kept} />
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: MetadataEntry }) {
  const high = entry.sensitivity === "high";
  return (
    <tr className={clsx("border-t border-line align-top", high && "bg-warning-soft/70")}>
      <td className={clsx("w-[34%] py-2.5 pr-3 pl-5", high && "shadow-[inset_3px_0_0_var(--warning)]")}>
        <span className={clsx("font-medium", high ? "text-warning-text" : "text-fg")}>{entry.label}</span>
        {entry.key !== entry.label && entry.key.replace(/\s/g, "") !== entry.label.replace(/\s/g, "") && (
          <span className="mt-0.5 block font-mono text-[11px] break-all text-fg-subtle">{entry.key}</span>
        )}
      </td>
      <td className="py-2.5 pr-3 wrap-anywhere text-fg-muted">
        <ExpandableValue value={entry.value} />
      </td>
      <td className="w-24 py-2.5 pr-5 text-right">
        <SensitivityBadge sensitivity={entry.sensitivity} />
      </td>
    </tr>
  );
}

function ExpandableValue({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  if (value.length <= 180) return <>{value}</>;
  return (
    <>
      {open ? value : `${value.slice(0, 180)}…`}{" "}
      <button type="button" onClick={() => setOpen(!open)} className="font-medium text-brand-text hover:underline">
        {open ? "Show less" : "Show all"}
      </button>
    </>
  );
}

function SensitivityBadge({ sensitivity }: { sensitivity: Sensitivity }) {
  if (sensitivity === "high") {
    return <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning-text">Sensitive</span>;
  }
  if (sensitivity === "medium") {
    return <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">Revealing</span>;
  }
  return <span className="text-[11px] text-fg-subtle">Technical</span>;
}

function KeptList({ kept }: { kept: MetadataReport["kept"] }) {
  if (kept.length === 0) return null;
  return (
    <ul className="space-y-1 text-left text-xs text-fg-muted">
      {kept.map((k) => (
        <li key={k.label} className="flex items-start gap-1.5">
          <Info className="mt-px size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span>
            <span className="font-medium text-fg">{k.label}</span> is kept on purpose — {k.reason.toLowerCase()}.
          </span>
        </li>
      ))}
    </ul>
  );
}
