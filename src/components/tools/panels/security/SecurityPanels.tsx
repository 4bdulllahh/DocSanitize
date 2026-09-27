"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { KeyRound, LoaderCircle, Lock, LockOpen, ShieldCheck, Sparkles } from "lucide-react";
import { PageThumbnail } from "@/components/pdf/PageThumbnail";
import { usePdfDocument } from "@/components/pdf/usePdfDocument";
import { errorMessage, ProcessingError } from "@/lib/errors";
import { generatePassword, passwordStrength } from "@/lib/password";
import { inspectFileEncryption, protectFile, unlockFile } from "@/lib/pdf/client";
import type { EncryptionInfo } from "@/lib/pdf/security";
import { withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { FidelityNote, PdfResultPreview } from "../shared/ConversionParts";
import { OutputCard, PRIMARY, SECONDARY, type OutputFile } from "../shared/OutputCard";
import { PdfLoadError, PdfLoading } from "../shared/PdfStates";
import { PasswordField } from "./PasswordField";

function Layout({ preview, actions }: { preview: ReactNode; actions: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">{preview}</div>
      <div className="order-first space-y-4 lg:sticky lg:top-20 lg:order-0">{actions}</div>
    </div>
  );
}

function FirstPage({ doc }: { doc: PDFDocumentProxy }) {
  return (
    <section className="rounded-xl border border-line bg-surface" aria-label="Preview">
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">Preview · page 1 of {doc.numPages}</div>
      <div className="flex justify-center bg-surface-muted p-4">
        <PageThumbnail doc={doc} pageNumber={1} width={300} height={380} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- Protect

export function ProtectPanel({ file }: ToolPanelProps) {
  const pdf = usePdfDocument(file.file);
  if (pdf.status === "loading") return <PdfLoading />;
  if (pdf.status === "error") return <PdfLoadError message={pdf.message} code={pdf.code} />;
  return <Protector file={file} doc={pdf.doc} />;
}

function Protector({ file, doc }: { file: WorkspaceFile; doc: PDFDocumentProxy }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [allow, setAllow] = useState({ printing: true, copying: true, modifying: true });
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const restricted = !allow.printing || !allow.copying || !allow.modifying;
  const ownerSame = restricted && ownerPassword.length > 0 && ownerPassword === password;
  const ready = password.length > 0 && password === confirm && !ownerSame;

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOutput(null);
  };

  const generate = () => {
    const generated = generatePassword();
    setPassword(generated);
    setConfirm(generated);
    setVisible(true);
    setOutput(null);
  };

  const protect = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setOutput(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      const blob = await protectFile(file.file, {
        userPassword: password,
        ownerPassword: restricted ? ownerPassword : undefined,
        allowPrinting: allow.printing,
        allowCopying: allow.copying,
        allowModifying: allow.modifying,
      });
      setOutput({ name: withSuffix(file.name, "protected"), blob, detail: "AES-256" });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "error", error: errorMessage(error) });
      toast({ tone: "error", title: "Couldn't protect the PDF", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const permission = (key: keyof typeof allow, label: string) => (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
      <input
        type="checkbox"
        checked={allow[key]}
        onChange={(e) => {
          setAllow((prev) => ({ ...prev, [key]: e.target.checked }));
          setOutput(null);
        }}
        className="size-4 shrink-0 accent-brand"
      />
      {label}
    </label>
  );

  return (
    <Layout
      preview={<FirstPage doc={doc} />}
      actions={
        <>
          <form onSubmit={protect} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <Lock className="size-4 text-brand-text" aria-hidden="true" />
              Protect with a password
            </h2>
            <FidelityNote>
              AES-256 encryption, done on your device. Anyone opening the file needs the password, and if it&apos;s lost the file can&apos;t be recovered,
              by us or anyone else.
            </FidelityNote>
            <PasswordField label="Password" value={password} onChange={edit(setPassword)} visible={visible} onVisibleChange={setVisible} autoComplete="new-password" strength={strength} />
            <PasswordField
              label="Confirm password"
              value={confirm}
              onChange={edit(setConfirm)}
              visible={visible}
              onVisibleChange={setVisible}
              autoComplete="new-password"
              error={mismatch ? "The passwords don't match." : undefined}
            />
            <button type="button" onClick={generate} className={clsx(SECONDARY, "mt-3 w-full")}>
              <Sparkles className="size-4" aria-hidden="true" />
              Generate a strong password
            </button>

            <fieldset className="mt-5 space-y-2">
              <legend className="mb-1.5 text-sm font-medium text-fg">Permissions</legend>
              {permission("printing", "Allow printing")}
              {permission("copying", "Allow copying text and images")}
              {permission("modifying", "Allow editing, comments and forms")}
              <p className="text-xs text-fg-subtle">Readers such as Acrobat and Preview honour these; they aren&apos;t a hard guarantee.</p>
            </fieldset>
            {restricted && (
              <PasswordField
                label="Permissions password (optional)"
                value={ownerPassword}
                onChange={edit(setOwnerPassword)}
                autoComplete="new-password"
                error={ownerSame ? "Use a different password from the one that opens the file." : undefined}
                hint="Lets you lift the restrictions later. Left empty, a random one is used."
              />
            )}

            <button type="submit" disabled={busy || !ready} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
              {busy ? "Encrypting…" : "Protect PDF"}
            </button>
          </form>
          {output && <OutputCard title="Protected" outputs={[output]} />}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- Unlock

type Inspection = { status: "loading" } | { status: "ready"; info: EncryptionInfo } | { status: "error"; message: string };

function useEncryptionInfo(file: File): Inspection {
  const [result, setResult] = useState<{ file: File; state: Inspection } | null>(null);
  useEffect(() => {
    let active = true;
    inspectFileEncryption(file)
      .then((info) => active && setResult({ file, state: { status: "ready", info } }))
      .catch((error: unknown) => active && setResult({ file, state: { status: "error", message: errorMessage(error) } }));
    return () => {
      active = false;
    };
  }, [file]);
  return result?.file === file ? result.state : { status: "loading" };
}

export function UnlockPanel({ file }: ToolPanelProps) {
  const inspection = useEncryptionInfo(file.file);
  if (inspection.status === "loading") return <PdfLoading label="Checking the PDF" />;
  if (inspection.status === "error") return <PdfLoadError message={inspection.message} />;
  if (!inspection.info.encrypted) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-14 text-center">
        <ShieldCheck className="size-8 text-success" aria-hidden="true" />
        <p className="font-semibold text-fg">This PDF isn&apos;t password-protected</p>
        <p className="max-w-sm text-sm text-fg-muted">It opens without a password and has no restrictions, so there&apos;s nothing to unlock.</p>
      </div>
    );
  }
  return <Unlocker file={file} info={inspection.info} />;
}

function Unlocker({ file, info }: { file: WorkspaceFile; info: EncryptionInfo }) {
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<OutputFile | null>(null);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    const { updateFile } = useWorkspaceStore.getState();
    setBusy(true);
    setWrong(null);
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      const blob = await unlockFile(file.file, info.needsPassword ? password : undefined);
      setOutput({ name: withSuffix(file.name, "unlocked"), blob });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      updateFile(file.id, { status: "idle" });
      // A wrong password is feedback on the form, not a failure.
      if (error instanceof ProcessingError && error.code === "encrypted") setWrong(error.message);
      else toast({ tone: "error", title: "Couldn't unlock the PDF", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const restrictions = info.restrictions.length ? info.restrictions.join(", ") : null;
  return (
    <Layout
      preview={
        output ? (
          <PdfResultPreview blob={output.blob} />
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface px-6 py-14 text-center">
            <Lock className="size-8 text-warning" aria-hidden="true" />
            <p className="font-semibold text-fg">{info.needsPassword ? "Password needed to open" : "Restricted PDF"}</p>
            <p className="max-w-sm text-sm text-fg-muted">
              Encrypted with {info.algorithm}.{" "}
              {info.needsPassword ? "Enter its password to remove the protection." : "It opens without a password"}
              {!info.needsPassword && (restrictions ? `, but blocks ${restrictions}.` : ".")}
            </p>
          </div>
        )
      }
      actions={
        <>
          <form onSubmit={unlock} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <LockOpen className="size-4 text-brand-text" aria-hidden="true" />
              {info.needsPassword ? "Unlock PDF" : "Remove restrictions"}
            </h2>
            <FidelityNote>
              {info.needsPassword
                ? "The password is checked on your device and never leaves it. The unlocked copy opens without a password and has no restrictions."
                : "No password is needed. The copy you get has no encryption and no restrictions on printing, copying or editing."}
            </FidelityNote>
            {info.needsPassword && (
              <PasswordField
                label="Password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setWrong(null);
                }}
                autoFocus
                autoComplete="current-password"
                error={wrong ?? undefined}
                hint="The open password or the permissions (owner) password."
              />
            )}
            <button type="submit" disabled={busy || (info.needsPassword && !password)} className={clsx(PRIMARY, "mt-5 w-full")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              {busy ? "Unlocking…" : info.needsPassword ? "Unlock PDF" : "Remove restrictions"}
            </button>
          </form>
          {output && <OutputCard title="Unlocked" outputs={[output]} replaceFileId={file.id} />}
        </>
      }
    />
  );
}
