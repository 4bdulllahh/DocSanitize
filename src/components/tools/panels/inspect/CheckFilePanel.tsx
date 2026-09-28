"use client";

import { useState } from "react";
import clsx from "clsx";
import { CircleCheck, CircleX, Copy, FileCheck2, ShieldAlert } from "lucide-react";
import { formatBytes } from "@/lib/files";
import { checkFileType, hashFile } from "@/lib/scan/client";
import { HASH_ALGORITHMS, matchHash } from "@/lib/scan/hash";
import { toast } from "@/store/toast";
import type { ToolPanelProps } from "../registry";
import { Field, INPUT } from "../shared/controls";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { Layout, ToolCard, useLoaded } from "../shared/toolkit";
import { FindingList } from "./parts";

const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast({ tone: "success", title: `${what} copied` }),
    () => toast({ tone: "error", title: "Couldn't copy", description: "Your browser didn't allow it." }),
  );

export default function CheckFilePanel({ file }: ToolPanelProps) {
  const check = useLoaded(file, () => checkFileType(file.file));
  const hashes = useLoaded(file, hashFile);
  const [expected, setExpected] = useState("");

  if (!check) return <PdfLoading label="Checking the file" />;
  if (check.error || !check.value) return <PdfLoadError title="Couldn't check this file" message={check.error ?? ""} code={check.code} />;
  const { type, extension, findings } = check.value;
  const danger = findings.some((f) => f.severity === "high");
  const match = hashes?.value && expected.trim() ? matchHash(hashes.value, expected) : null;

  return (
    <Layout
      main={
        <div className="space-y-4">
          {findings.length > 0 && <FindingList title="About this file" findings={findings} />}
          <section className="rounded-xl border border-line bg-surface" aria-label="Details">
            <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">Details</div>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <dt className="text-fg-muted">Name</dt>
              <dd className="break-all text-fg">{file.name}</dd>
              <dt className="text-fg-muted">Size</dt>
              <dd className="text-fg">
                {formatBytes(file.size)} ({file.size.toLocaleString("en")} bytes)
              </dd>
              <dt className="text-fg-muted">Really is</dt>
              <dd className="text-fg">{type ? type.name : "Unknown format"}</dd>
              <dt className="text-fg-muted">Extension</dt>
              <dd className="text-fg">{extension ? `.${extension}` : "None"}</dd>
            </dl>
          </section>
          <section className="rounded-xl border border-line bg-surface" aria-label="Hashes">
            <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">Hashes (checksums)</div>
            <ul className="divide-y divide-line">
              {HASH_ALGORITHMS.map((algorithm) => (
                <li key={algorithm} className={clsx("flex items-center gap-3 px-4 py-2.5", match === algorithm && "bg-success/10")}>
                  <span className="w-16 shrink-0 text-xs font-semibold text-fg-muted">{algorithm}</span>
                  <code className="min-w-0 flex-1 font-mono text-xs break-all text-fg">{hashes?.value?.[algorithm] ?? (hashes?.error ? "Couldn't compute" : "…")}</code>
                  <button type="button" disabled={!hashes?.value} onClick={() => copy(hashes!.value![algorithm], `${algorithm} hash`)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" aria-label={`Copy the ${algorithm} hash`}>
                    <Copy className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      }
      actions={
        <ToolCard icon={FileCheck2} title="Check file">
          <div className={clsx("mt-4 flex gap-2.5 rounded-lg p-3 text-sm", danger ? "bg-danger/10" : "bg-surface-muted")}>
            {danger ? <ShieldAlert className="size-5 shrink-0 text-danger" aria-hidden="true" /> : <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />}
            <p className="text-fg">
              {danger ? "This file isn't what it seems or can run code. Don't open it unless you trust where it came from." : type ? `A ${type.name.toLowerCase()}, as its name says.` : "No warning signs in its name."}
            </p>
          </div>
          <Field label="Compare with a published hash" hint="Paste the SHA-256, SHA-512, SHA-1 or MD5 value from the download page to check the file arrived intact.">
            <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="e.g. 3a7bd3e2360a3d…" className={clsx(INPUT, "font-mono")} spellCheck={false} />
          </Field>
          {expected.trim() && hashes?.value && (
            <p className={clsx("mt-2 flex items-center gap-1.5 text-sm font-medium", match ? "text-success" : "text-danger-text")} role="status">
              {match ? <CircleCheck className="size-4" aria-hidden="true" /> : <CircleX className="size-4" aria-hidden="true" />}
              {match ? `Matches the ${match} hash: the file is exactly the published one.` : "Doesn't match: the file is different from the one published (or the value was copied wrongly)."}
            </p>
          )}
        </ToolCard>
      }
    />
  );
}
