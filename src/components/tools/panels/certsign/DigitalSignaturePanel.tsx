"use client";

import { useEffect, useId, useState } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BadgeCheck, ChevronLeft, ChevronRight, FileKey, LoaderCircle } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { errorMessage } from "@/lib/errors";
import { anchorBox, type Anchor } from "@/lib/pdf/anchor";
import { signPdfFile, verifySignatures } from "@/lib/sign/client";
import { SIGNATURE_BOX, SIGNATURE_MARGIN } from "@/lib/sign/layout";
import { useCertificateStore } from "@/store/certificate";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote } from "../shared/ConversionParts";
import { AnchorPicker, Field, INPUT, Segmented } from "../shared/controls";
import { OutputCard, PRIMARY } from "../shared/OutputCard";
import { DocGate, Layout, ToolCard, useApply, useLoaded } from "../shared/toolkit";
import { CertificateCard } from "./CertificateCard";

const REASONS = ["I approve this document", "I am the author of this document", "I have reviewed this document", "I agree to its terms"];
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;
const LEVELS = [
  { id: "1", label: "No changes", hint: "Any change after this breaks the certification." },
  { id: "2", label: "Form filling and signing", hint: "Others can still fill in forms and sign." },
  { id: "3", label: "Forms, signing and comments", hint: "Others can also add comments." },
] as const;

export default function DigitalSignaturePanel({ file }: ToolPanelProps) {
  return <DocGate file={file}>{(doc) => <Signer key={`${file.id}:${file.revision}`} file={file} doc={doc} />}</DocGate>;
}

/** The page as shown (rotation applied), in points. */
function usePageSize(doc: PDFDocumentProxy, pageNumber: number) {
  const [size, setSize] = useState<{ key: string; width: number; height: number } | null>(null);
  const key = `${pageNumber}`;
  useEffect(() => {
    let active = true;
    doc.getPage(pageNumber).then((page) => {
      const { width, height } = page.getViewport({ scale: 1 });
      if (active) setSize({ key, width, height });
    });
    return () => {
      active = false;
    };
  }, [doc, pageNumber, key]);
  return size?.key === key ? size : null;
}

function Preview({ doc, pageNumber, anchor, visible, onPage }: { doc: PDFDocumentProxy; pageNumber: number; anchor: Anchor; visible: boolean; onPage: (n: number) => void }) {
  const size = usePageSize(doc, pageNumber);
  const fit = size ? Math.min(360 / size.width, 460 / size.height) : 1;
  const [w, h] = size ? [size.width * fit, size.height * fit] : [360, 460];
  const box = size && visible ? anchorBox(anchor, size, SIGNATURE_BOX, SIGNATURE_MARGIN) : null;
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Where the signature goes">
      <div className="flex justify-center rounded-lg bg-surface-muted p-4">
        <div className="relative shadow-elev-1" style={{ width: w, height: h }}>
          <PageThumbnail doc={doc} pageNumber={pageNumber} width={w} height={h} />
          {box && (
            <div
              className="absolute flex flex-col justify-center rounded-sm border-2 border-brand bg-brand/10 px-1.5 text-[9px] leading-tight text-brand-text"
              style={{ left: box.u * fit, top: box.v * fit, width: SIGNATURE_BOX.width * fit, height: SIGNATURE_BOX.height * fit }}
              aria-label="Signature box"
            >
              <span>Digitally signed by</span>
              <span className="font-semibold">your name</span>
            </div>
          )}
        </div>
      </div>
      {visible && doc.numPages > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm text-fg-muted">
          <button type="button" onClick={() => onPage(pageNumber - 1)} disabled={pageNumber <= 1} className="rounded-md p-1.5 hover:bg-surface-muted disabled:opacity-40" aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums">
            Page {pageNumber} of {doc.numPages}
          </span>
          <button type="button" onClick={() => onPage(pageNumber + 1)} disabled={pageNumber >= doc.numPages} className="rounded-md p-1.5 hover:bg-surface-muted disabled:opacity-40" aria-label="Next page">
            <ChevronRight className="size-4" />
          </button>
        </div>
      ) : (
        !visible && <p className="mt-3 text-center text-xs text-fg-subtle">An invisible signature isn&apos;t drawn on a page; PDF readers list it in their signatures panel.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Signing

function Signer({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const certificate = useCertificateStore((s) => s.current);
  const existing = useLoaded(file, verifySignatures);
  const signedAlready = existing?.value?.signatures.length ?? 0;
  const { busy, output, setOutput, apply } = useApply(file, "signed");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [visible, setVisible] = useState(true);
  const [pageNumber, setPageNumber] = useState(doc.numPages);
  const [anchor, setAnchor] = useState<Anchor>("bottom-right");
  const [certify, setCertify] = useState(false);
  const [level, setLevel] = useState<"1" | "2" | "3">("2");
  const [check, setCheck] = useState<{ blob: Blob; text: string; ok: boolean } | null>(null);
  const listId = useId();
  const changed =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setOutput(null);
    };

  // Read the result back, as a reader would.
  useEffect(() => {
    if (!output) return;
    let active = true;
    verifySignatures(output.blob)
      .then((report) => {
        const last = report.signatures[report.signatures.length - 1];
        const ok = !!last?.intact && last.changesAfter === "none";
        if (active) setCheck({ blob: output.blob, ok, text: ok ? "Checked: the signature is valid and covers the whole document." : `The new signature didn't check out${last?.problem ? `: ${last.problem}` : "."}` });
      })
      .catch((e) => active && setCheck({ blob: output.blob, ok: false, text: errorMessage(e) }));
    return () => {
      active = false;
    };
  }, [output]);
  const verified = output && check?.blob === output.blob ? check : null;

  const sign = () =>
    certificate &&
    apply(() =>
      signPdfFile(file.file, {
        certificate: certificate.file,
        password: certificate.password,
        reason,
        location,
        contact,
        certify: certify ? (Number(level) as 1 | 2 | 3) : null,
        appearance: visible ? { page: pageNumber - 1, anchor } : null,
      }),
    );

  const canCertify = existing !== null && signedAlready === 0;
  return (
    <Layout
      main={
        <>
          <Preview doc={doc} pageNumber={pageNumber} anchor={anchor} visible={visible} onPage={(n) => changed(setPageNumber)(Math.min(doc.numPages, Math.max(1, n)))} />
          {signedAlready > 0 && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-fg-muted">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-text" aria-hidden="true" />
              This PDF already has {signedAlready} digital signature{signedAlready === 1 ? "" : "s"}. Yours is added after {signedAlready === 1 ? "it" : "them"}, so {signedAlready === 1 ? "it stays" : "they stay"} valid.
            </p>
          )}
        </>
      }
      actions={
        <>
          <CertificateCard />
          <ToolCard icon={FileKey} title="Signature">
            <Field label="Reason (optional)">
              <input list={listId} value={reason} onChange={(e) => changed(setReason)(e.target.value)} placeholder="I approve this document" className={INPUT} />
              <datalist id={listId}>
                {REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location (optional)">
                <input value={location} onChange={(e) => changed(setLocation)(e.target.value)} placeholder="City" className={INPUT} />
              </Field>
              <Field label="Contact (optional)">
                <input value={contact} onChange={(e) => changed(setContact)(e.target.value)} placeholder="Email or phone" className={INPUT} />
              </Field>
            </div>
            <Segmented
              label="On the page"
              value={visible ? "box" : "invisible"}
              onChange={(v) => changed(setVisible)(v === "box")}
              options={[
                { id: "box", label: "Signature box" },
                { id: "invisible", label: "Invisible" },
              ]}
            />
            {visible && <AnchorPicker label="Position" value={anchor} onChange={(a) => changed(setAnchor)(a)} allowed={CORNERS} />}
            <Segmented
              label="Type"
              hint={certify ? "Certifying marks you as the document's author and says what others may still change. Only the first signature can certify." : "An approval signature, like signing on paper. Others can sign after you."}
              value={certify ? "certify" : "approve"}
              onChange={(v) => changed(setCertify)(v === "certify")}
              options={[
                { id: "approve", label: "Sign" },
                { id: "certify", label: "Certify", disabled: !canCertify },
              ]}
            />
            {certify && (
              <Field label="Allowed after certifying" hint={LEVELS.find((l) => l.id === level)?.hint}>
                <select value={level} onChange={(e) => changed(setLevel)(e.target.value as "1" | "2" | "3")} className={INPUT}>
                  {LEVELS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <FidelityNote>The signature holds your certificate, the time, and the details above. Nothing else is added, and the rest of the file stays byte-for-byte the same.</FidelityNote>
            <button type="button" onClick={sign} disabled={!certificate || busy} className={clsx(PRIMARY, "mt-4 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <FileKey className="size-4" aria-hidden="true" />}
              {certificate ? (certify ? "Certify PDF" : "Sign PDF") : "Open a certificate first"}
            </button>
          </ToolCard>
          {output && (
            <>
              <OutputCard title="Signed PDF ready" outputs={[output]} replaceFileId={file.id} />
              <p className={clsx("rounded-lg p-3 text-sm", verified && !verified.ok ? "bg-danger-soft text-fg" : "bg-surface-muted text-fg-muted")} role="status">
                {verified ? verified.text : "Checking the signature…"}
              </p>
            </>
          )}
        </>
      }
    />
  );
}
