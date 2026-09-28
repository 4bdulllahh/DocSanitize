"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { Download, FileKey, KeyRound, LoaderCircle, Plus, TriangleAlert, X } from "lucide-react";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { createCertificate, describeCertificate } from "@/lib/sign/client";
import { useCertificateStore } from "@/store/certificate";
import { useT } from "@/store/locale";
import { Field, INPUT } from "../shared/controls";
import { PRIMARY, SECONDARY } from "../shared/OutputCard";
import { ToolCard } from "../shared/toolkit";
import { CertificateFacts } from "./SignatureParts";

/* Opening a certificate file, or creating one; shared by Digital Signature and Batch Process. */

function OpenCertificate() {
  const set = useCertificateStore((s) => s.set);
  const t = useT();
  const inputId = useId();
  const [chosen, setChosen] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      set({ file: chosen.bytes, fileName: chosen.name, password, identity: await describeCertificate(chosen.bytes, password), madeHere: false });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <label htmlFor={inputId} className={clsx(SECONDARY, "w-full cursor-pointer")}>
        <FileKey className="size-4" aria-hidden="true" />
        {chosen ? chosen.name : t("Choose a .p12 or .pfx file")}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".p12,.pfx,application/x-pkcs12"
        className="sr-only"
        aria-label={t("Certificate file")}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setChosen({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
          setError(null);
        }}
      />
      {chosen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void open();
          }}
        >
          <Field label={t("Password")} error={error ? t.dynamic(error) : undefined}>
            <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
          </Field>
          <button type="submit" disabled={busy} className={clsx(PRIMARY, "mt-3 w-full")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
            {t("Open certificate")}
          </button>
        </form>
      )}
    </div>
  );
}

function CreateCertificate({ onCancel }: { onCancel: () => void }) {
  const set = useCertificateStore((s) => s.set);
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [years, setYears] = useState("3");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = !name.trim() ? t("Enter your name.") : password.length < 6 ? t("Choose a password of at least 6 characters.") : password !== repeat ? t("The passwords don't match.") : null;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await createCertificate({ name, email, organization, years: Number(years), password });
      const fileName = `${name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "certificate"}.p12`;
      set({ file, fileName, password, identity: await describeCertificate(file, password), madeHere: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-3 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) void create();
      }}
    >
      <p className="text-sm font-medium text-fg">{t("Create a certificate")}</p>
      <p className="mt-1 text-xs text-fg-muted">{t("Made on this device. It proves a document hasn't changed since you signed it; others see it as self-signed unless they choose to trust it.")}</p>
      <Field label={t("Your name")}>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Email (optional)")}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={INPUT} />
        </Field>
        <Field label={t("Organisation (optional)")}>
          <input value={organization} onChange={(e) => setOrganization(e.target.value)} autoComplete="organization" className={INPUT} />
        </Field>
      </div>
      <Field label={t("Valid for")}>
        <select value={years} onChange={(e) => setYears(e.target.value)} className={INPUT}>
          {[1, 2, 3, 5, 10].map((y) => (
            <option key={y} value={y}>
              {t.plural(y, "{n} year", "{n} years")}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Password")}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={INPUT} />
        </Field>
        <Field label={t("Repeat password")}>
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" className={INPUT} />
        </Field>
      </div>
      <p className={clsx("mt-2 text-xs", error ? "text-danger-text" : "text-fg-subtle")}>
        {error ? t.dynamic(error) : problem && (name || password) ? problem : t("The password locks the certificate file; you need it every time you sign.")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY}>
          {t("Cancel")}
        </button>
        <button type="submit" disabled={busy || !!problem} className={PRIMARY}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          {t("Create")}
        </button>
      </div>
    </form>
  );
}

export function CertificateCard() {
  const current = useCertificateStore((s) => s.current);
  const forget = useCertificateStore((s) => s.forget);
  const t = useT();
  const [creating, setCreating] = useState(false);
  if (current) {
    const { identity } = current;
    return (
      <ToolCard icon={KeyRound} title={t("Your certificate")}>
        <CertificateFacts summary={identity} className="mt-3" />
        {(identity.expired || identity.notYetValid) && (
          <p className="mt-3 flex gap-2 rounded-lg bg-warning-soft p-2.5 text-xs text-fg">
            <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
            {identity.expired ? t("This certificate has expired. Signatures made with it show as invalid in most readers.") : t("This certificate isn't valid yet.")}
          </p>
        )}
        {!identity.canSign && <p className="mt-3 text-xs text-warning-text">{t("This certificate isn't meant for signing, so readers may not accept its signatures.")}</p>}
        {current.madeHere && (
          <div className="mt-3 rounded-lg bg-brand-soft p-3 text-xs text-fg">
            <p>{t("Download your certificate and keep it safe with its password: you need both to sign again. DocSanitize doesn't keep it.")}</p>
            <button type="button" onClick={() => downloadBlob(new Blob([current.file as BlobPart], { type: "application/x-pkcs12" }), current.fileName)} className={clsx(PRIMARY, "mt-2 w-full")}>
              <Download className="size-4" aria-hidden="true" />
              {t("Download {name}", { name: current.fileName })}
            </button>
          </div>
        )}
        <button type="button" onClick={forget} className={clsx(SECONDARY, "mt-3 w-full")}>
          <X className="size-4" aria-hidden="true" />
          {t("Use another certificate")}
        </button>
      </ToolCard>
    );
  }
  return (
    <ToolCard icon={KeyRound} title={t("Your certificate")}>
      <p className="mt-2 text-sm text-fg-muted">{t("A digital ID file (.p12 or .pfx) from a certificate authority, your employer or your ID card provider. It's opened here and never uploaded.")}</p>
      <OpenCertificate />
      {creating ? (
        <CreateCertificate onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="mt-3 text-sm font-medium text-brand-text hover:underline">
          {t("Don't have one? Create a certificate")}
        </button>
      )}
    </ToolCard>
  );
}
