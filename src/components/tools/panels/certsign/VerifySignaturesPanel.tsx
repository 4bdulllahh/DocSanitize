"use client";

import clsx from "clsx";
import Link from "next/link";
import { BadgeCheck, CircleCheck, CircleX, Download, FileSearch, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { msg } from "@/i18n/msg";
import type { Translator } from "@/i18n/translate";
import { downloadBlob } from "@/lib/download";
import { verifySignatures } from "@/lib/sign/client";
import type { SignatureReport, VerifyReport } from "@/lib/sign/pdf-verify";
import { withSuffix } from "@/lib/zip";
import { useT } from "@/store/locale";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { CertificateFacts } from "./SignatureParts";

const CERTIFICATION = {
  1: msg("no changes are allowed"),
  2: msg("only form filling and signing are allowed"),
  3: msg("form filling, signing and comments are allowed"),
} as Record<number, string>;

type Tone = "good" | "warn" | "bad";

function overall(report: VerifyReport, t: Translator): { tone: Tone; title: string; text: string } | null {
  const sigs = report.signatures;
  if (!sigs.length) return null;
  const broken = sigs.filter((s) => !s.intact);
  if (broken.length) {
    return { tone: "bad", title: broken.length === sigs.length ? t("The signature isn't valid") : t("{broken} of {total} signatures aren't valid", { broken: broken.length, total: sigs.length }), text: t.dynamic(broken[0].problem ?? "") };
  }
  if (sigs[sigs.length - 1].changesAfter === "changed") {
    return { tone: "warn", title: t("Signed, but changed since"), text: t("Every signature is intact, but the file was changed after the last one. You can download the version that was signed and compare the two.") };
  }
  return {
    tone: "good",
    title: sigs.length === 1 ? t("Signed, and unchanged since") : t("{count} signatures, all valid", { count: sigs.length }),
    text: t("The signed content hasn't changed, and each signature was made with the key of the certificate it carries."),
  };
}

const TONE_STYLE: Record<Tone, string> = {
  good: "border-success/50 bg-success-soft",
  warn: "border-warning/50 bg-warning-soft",
  bad: "border-danger/50 bg-danger-soft",
};

function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  const Icon = tone === "good" ? CircleCheck : tone === "warn" ? TriangleAlert : CircleX;
  return <Icon className={clsx("shrink-0", tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-danger", className)} aria-hidden="true" />;
}

function SignatureCard({ file, sig }: { file: WorkspaceFile; sig: SignatureReport }) {
  const t = useT();
  const tone: Tone = !sig.intact ? "bad" : sig.changesAfter === "changed" ? "warn" : "good";
  const who = sig.signer?.name ?? t("an unknown signer");
  const authority = sig.timestamp?.authority ?? t("a timestamp authority");
  const title = sig.kind === "timestamp" ? t("Timestamped by {name}", { name: authority }) : sig.kind === "certification" ? t("Certified by {name}", { name: who }) : t("Signed by {name}", { name: who });
  const details: [string, string][] = [];
  if (sig.signedAt) {
    const when = t.date(sig.signedAt, { dateStyle: "medium", timeStyle: "long" });
    details.push([t("Signed"), sig.timestamp?.valid ? t("{date} (from a timestamp)", { date: when }) : t("{date} (the signer's clock)", { date: when })]);
  }
  if (sig.reason) details.push([t("Reason"), sig.reason]);
  if (sig.location) details.push([t("Location"), sig.location]);
  if (sig.contact) details.push([t("Contact"), sig.contact]);
  details.push([t("Shown"), sig.page ? t("On page {page}", { page: sig.page }) : t("Invisible (not drawn on a page)")]);
  details.push([t("Field"), sig.field]);

  const notes: { tone: Tone; text: string }[] = [];
  notes.push(
    sig.intact
      ? { tone: "good", text: sig.kind === "timestamp" ? t("The timestamp matches the document.") : t("The signed content hasn't changed, and the signature matches the certificate.") }
      : { tone: "bad", text: sig.problem ? t.dynamic(sig.problem) : t("The signature isn't valid.") },
  );
  if (sig.changesAfter === "covered") notes.push({ tone: "good", text: t("More was added after this signature (such as another signature); a later signature covers it.") });
  if (sig.changesAfter === "changed") notes.push({ tone: "warn", text: t("The file was changed after this signature, and no later signature covers the change.") });
  if (sig.certification) notes.push({ tone: "good", text: t("Certification: {allowed}.", { allowed: t(CERTIFICATION[sig.certification] ?? msg("some changes are allowed")) }) });
  if (sig.timestamp && sig.kind !== "timestamp") {
    notes.push(sig.timestamp.valid ? { tone: "good", text: t("Includes a timestamp from {name}.", { name: authority }) } : { tone: "warn", text: t("Includes a timestamp that doesn't check out.") });
  }
  if (sig.certificateValidThen === false) notes.push({ tone: "warn", text: t("The certificate wasn't valid (by its dates) when this was signed.") });
  if (sig.signer?.selfSigned) notes.push({ tone: "warn", text: t("The certificate is self-signed: anyone can make one in any name. Check the fingerprint with the signer if it matters who signed.") });

  return (
    <section className="rounded-xl border border-line bg-surface p-5" aria-label={title}>
      <h2 className="flex items-start gap-2 font-semibold text-fg">
        <StatusIcon tone={tone} className="mt-0.5 size-5" />
        <span className="wrap-anywhere">{title}</span>
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        {notes.map((n) => (
          <li key={n.text} className="flex gap-2 text-fg">
            <StatusIcon tone={n.tone} className="mt-0.5 size-4" />
            {n.text}
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1 text-sm">
        {details.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="wrap-anywhere text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {sig.signer && (
        <details className="mt-4 rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium text-fg">{t("Certificate")}</summary>
          <CertificateFacts summary={sig.signer} className="mt-3" />
          {sig.chain.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("Issuers in the file")}</p>
              {sig.chain.map((c) => (
                <CertificateFacts key={c.fingerprint} summary={c} className="mt-2" showFingerprint={false} />
              ))}
            </div>
          )}
        </details>
      )}
      {sig.changesAfter !== "none" && sig.signedLength > 0 && (
        <button
          type="button"
          onClick={() => downloadBlob(file.file.slice(0, sig.signedLength, "application/pdf"), withSuffix(file.name, `as-signed-by-${sig.field}`))}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"
        >
          <Download className="size-4" aria-hidden="true" />
          {t("Download the version this signature covers")}
        </button>
      )}
    </section>
  );
}

export default function VerifySignaturesPanel({ file }: ToolPanelProps) {
  const t = useT();
  const loaded = useLoaded(file, verifySignatures);
  if (!loaded) return <PdfLoading label={t("Checking the signatures")} />;
  if (!loaded.value) return <PdfLoadError title={t("Couldn't check this PDF")} message={loaded.error ?? ""} code={loaded.code} />;
  const report = loaded.value;
  const summary = overall(report, t);
  return (
    <Layout
      main={
        report.signatures.length ? (
          <div className="space-y-4">
            {report.signatures.map((sig, i) => (
              <SignatureCard key={`${sig.field}-${i}`} file={file} sig={sig} />
            ))}
          </div>
        ) : (
          <section className="rounded-xl border border-line bg-surface p-8 text-center">
            <FileSearch className="mx-auto size-10 text-fg-subtle" strokeWidth={1.5} aria-hidden="true" />
            <h2 className="mt-3 font-semibold text-fg">{t("No digital signatures")}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
              {t("This PDF isn't digitally signed. A signature drawn or typed on a page (such as E-Sign's) is a picture: it doesn't protect the document against changes.")}
            </p>
          </section>
        )
      }
      actions={
        <>
          {summary && (
            <section className={clsx("rounded-xl border p-5", TONE_STYLE[summary.tone])} role="status">
              <h2 className="flex items-center gap-2 font-semibold text-fg">
                <StatusIcon tone={summary.tone} className="size-5" />
                {summary.title}
              </h2>
              <p className="mt-1 text-sm text-fg">{summary.text}</p>
              {report.revisions > 1 && (
                <p className="mt-2 text-xs text-fg-muted">
                  {t.plural(report.revisions - 1, "The file was saved in {stages} stages (its original and {n} update).", "The file was saved in {stages} stages (its original and {n} updates).", { stages: report.revisions })}
                </p>
              )}
            </section>
          )}
          <ToolCard icon={ShieldAlert} title={t("What this can't tell you")}>
            <p className="mt-2 text-sm text-fg-muted">
              {t(
                "Checking is done offline, so DocSanitize can't ask certificate authorities whether they vouch for a certificate, or whether it was revoked. If it matters who signed, compare the certificate's fingerprint with one the signer gives you, or open the file in a reader that checks against trusted authorities, such as Adobe Acrobat.",
              )}
            </p>
            <p className="mt-2 flex gap-2 text-xs text-fg-subtle">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {t("Nothing is sent anywhere: the file and its certificates are read on this device.")}
            </p>
          </ToolCard>
          {report.signatures.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <BadgeCheck className="size-4 text-brand-text" aria-hidden="true" />
              <Link href="/tools/digital-signature/" className="font-medium text-brand-text hover:underline">
                {t("Sign it with Digital Signature")}
              </Link>
            </p>
          )}
        </>
      }
    />
  );
}
