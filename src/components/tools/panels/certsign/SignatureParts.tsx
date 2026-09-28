"use client";

import type { CertificateSummary } from "@/lib/sign/x509";
import { useT } from "@/store/locale";

/** Who a certificate names, who issued it, and when it's valid. */
export function CertificateFacts({ summary, className, showFingerprint = true }: { summary: CertificateSummary; className?: string; showFingerprint?: boolean }) {
  const t = useT();
  const day = (iso: string) => t.date(iso, { dateStyle: "medium" });
  const rows: [string, string][] = [];
  if (summary.email) rows.push([t("Email"), summary.email]);
  if (summary.organization) rows.push([t("Organisation"), summary.organization]);
  rows.push([t("Issued by"), summary.selfSigned ? t("Itself (self-signed)") : summary.issuer]);
  rows.push([t("Valid"), `${day(summary.notBefore)} – ${day(summary.notAfter)}`]);
  rows.push([t("Key"), t.dynamic(summary.key)]);
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
          <summary className="cursor-pointer">{t("SHA-256 fingerprint")}</summary>
          <p className="mt-1 font-mono text-[11px] break-all text-fg" dir="ltr">
            {summary.fingerprint}
          </p>
        </details>
      )}
    </div>
  );
}
