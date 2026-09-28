"use client";

import clsx from "clsx";
import Link from "next/link";
import { BadgeCheck, CircleCheck, CircleX, Download, FileSearch, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { downloadBlob } from "@/lib/download";
import { verifySignatures } from "@/lib/sign/client";
import type { SignatureReport, VerifyReport } from "@/lib/sign/pdf-verify";
import { withSuffix } from "@/lib/zip";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { CertificateFacts, dateTimeFormat } from "./SignatureParts";

const CERTIFICATION = {
  1: "no changes are allowed",
  2: "only form filling and signing are allowed",
  3: "form filling, signing and comments are allowed",
} as Record<number, string>;

type Tone = "good" | "warn" | "bad";

function overall(report: VerifyReport): { tone: Tone; title: string; text: string } | null {
  const sigs = report.signatures;
  if (!sigs.length) return null;
  const broken = sigs.filter((s) => !s.intact);
  if (broken.length) return { tone: "bad", title: broken.length === sigs.length ? "The signature isn't valid" : `${broken.length} of ${sigs.length} signatures aren't valid`, text: broken[0].problem ?? "" };
  if (sigs[sigs.length - 1].changesAfter === "changed") return { tone: "warn", title: "Signed, but changed since", text: "Every signature is intact, but the file was changed after the last one. You can download the version that was signed and compare the two." };
  return { tone: "good", title: sigs.length === 1 ? "Signed, and unchanged since" : `${sigs.length} signatures, all valid`, text: "The signed content hasn't changed, and each signature was made with the key of the certificate it carries." };
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
  const tone: Tone = !sig.intact ? "bad" : sig.changesAfter === "changed" ? "warn" : "good";
  const who = sig.signer?.name ?? "an unknown signer";
  const title = sig.kind === "timestamp" ? `Timestamped by ${sig.timestamp?.authority ?? "a timestamp authority"}` : sig.kind === "certification" ? `Certified by ${who}` : `Signed by ${who}`;
  const details: [string, string][] = [];
  if (sig.signedAt) details.push(["Signed", `${dateTimeFormat.format(new Date(sig.signedAt))}${sig.timestamp?.valid ? " (from a timestamp)" : " (the signer's clock)"}`]);
  if (sig.reason) details.push(["Reason", sig.reason]);
  if (sig.location) details.push(["Location", sig.location]);
  if (sig.contact) details.push(["Contact", sig.contact]);
  details.push(["Shown", sig.page ? `On page ${sig.page}` : "Invisible (not drawn on a page)"]);
  details.push(["Field", sig.field]);

  const notes: { tone: Tone; text: string }[] = [];
  notes.push(sig.intact ? { tone: "good", text: sig.kind === "timestamp" ? "The timestamp matches the document." : "The signed content hasn't changed, and the signature matches the certificate." } : { tone: "bad", text: sig.problem ?? "The signature isn't valid." });
  if (sig.changesAfter === "covered") notes.push({ tone: "good", text: "More was added after this signature (such as another signature); a later signature covers it." });
  if (sig.changesAfter === "changed") notes.push({ tone: "warn", text: "The file was changed after this signature, and no later signature covers the change." });
  if (sig.certification) notes.push({ tone: "good", text: `Certification: ${CERTIFICATION[sig.certification] ?? "some changes are allowed"}.` });
  if (sig.timestamp && sig.kind !== "timestamp") notes.push(sig.timestamp.valid ? { tone: "good", text: `Includes a timestamp from ${sig.timestamp.authority ?? "a timestamp authority"}.` } : { tone: "warn", text: "Includes a timestamp that doesn't check out." });
  if (sig.certificateValidThen === false) notes.push({ tone: "warn", text: "The certificate wasn't valid (by its dates) when this was signed." });
  if (sig.signer?.selfSigned) notes.push({ tone: "warn", text: "The certificate is self-signed: anyone can make one in any name. Check the fingerprint with the signer if it matters who signed." });

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
          <summary className="cursor-pointer text-sm font-medium text-fg">Certificate</summary>
          <CertificateFacts summary={sig.signer} className="mt-3" />
          {sig.chain.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Issuers in the file</p>
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
          Download the version this signature covers
        </button>
      )}
    </section>
  );
}

export default function VerifySignaturesPanel({ file }: ToolPanelProps) {
  const loaded = useLoaded(file, verifySignatures);
  if (!loaded) return <PdfLoading label="Checking the signatures" />;
  if (!loaded.value) return <PdfLoadError title="Couldn't check this PDF" message={loaded.error ?? ""} code={loaded.code} />;
  const report = loaded.value;
  const summary = overall(report);
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
            <h2 className="mt-3 font-semibold text-fg">No digital signatures</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">This PDF isn&apos;t digitally signed. A signature drawn or typed on a page (such as E-Sign&apos;s) is a picture: it doesn&apos;t protect the document against changes.</p>
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
              {report.revisions > 1 && <p className="mt-2 text-xs text-fg-muted">The file was saved in {report.revisions} stages (its original and {report.revisions - 1} update{report.revisions === 2 ? "" : "s"}).</p>}
            </section>
          )}
          <ToolCard icon={ShieldAlert} title="What this can't tell you">
            <p className="mt-2 text-sm text-fg-muted">
              Checking is done offline, so DocSanitize can&apos;t ask certificate authorities whether they vouch for a certificate, or whether it was revoked. If it matters who signed, compare the certificate&apos;s fingerprint with one the signer gives you, or open the file in a reader that checks
              against trusted authorities, such as Adobe Acrobat.
            </p>
            <p className="mt-2 flex gap-2 text-xs text-fg-subtle">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Nothing is sent anywhere: the file and its certificates are read on this device.
            </p>
          </ToolCard>
          {report.signatures.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <BadgeCheck className="size-4 text-brand-text" aria-hidden="true" />
              <Link href="/tools/digital-signature/" className="font-medium text-brand-text hover:underline">
                Sign it with Digital Signature
              </Link>
            </p>
          )}
        </>
      }
    />
  );
}
