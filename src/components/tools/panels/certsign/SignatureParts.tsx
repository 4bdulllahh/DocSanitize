"use client";

import clsx from "clsx";
import type { CertificateSummary } from "@/lib/sign/x509";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
export const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" });

/** Who a certificate names, who issued it, and when it's valid. */
export function CertificateFacts({ summary, className, showFingerprint = true }: { summary: CertificateSummary; className?: string; showFingerprint?: boolean }) {
  const rows: [string, string][] = [];
  if (summary.email) rows.push(["Email", summary.email]);
  if (summary.organization) rows.push(["Organisation", summary.organization]);
  rows.push(["Issued by", summary.selfSigned ? "Itself (self-signed)" : summary.issuer]);
  rows.push(["Valid", `${dateFormat.format(new Date(summary.notBefore))} – ${dateFormat.format(new Date(summary.notAfter))}`]);
  rows.push(["Key", summary.key]);
  return (
    <div className={className}>
      <p className="font-semibold wrap-anywhere text-fg">{summary.name}</p>
      <dl className="mt-2 space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="wrap-anywhere text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {showFingerprint && (
        <details className="mt-2 text-xs text-fg-muted">
          <summary className="cursor-pointer">SHA-256 fingerprint</summary>
          <p className={clsx("mt-1 font-mono text-[11px] break-all text-fg")}>{summary.fingerprint}</p>
        </details>
      )}
    </div>
  );
}
