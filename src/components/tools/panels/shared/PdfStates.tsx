import Link from "next/link";
import { CircleAlert, LoaderCircle, Lock } from "lucide-react";

export function PdfLoading() {
  return (
    <div className="flex h-72 items-center justify-center rounded-xl border border-line bg-surface" aria-busy="true">
      <LoaderCircle className="size-6 animate-spin text-fg-subtle" aria-label="Loading pages" />
    </div>
  );
}

export function PdfLoadError({ message, code }: { message: string; code?: string }) {
  const encrypted = code === "encrypted";
  const Icon = encrypted ? Lock : CircleAlert;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface px-6 py-14 text-center">
      <Icon className={encrypted ? "size-8 text-warning" : "size-8 text-danger"} aria-hidden="true" />
      <p className="font-semibold text-fg">{encrypted ? "Password-protected PDF" : "Couldn't open this PDF"}</p>
      <p className="max-w-sm text-sm text-fg-muted">{message}</p>
      {encrypted && (
        <Link href="/tools/unlock" className="text-sm font-medium text-brand-text underline underline-offset-4">
          Open Unlock PDF
        </Link>
      )}
    </div>
  );
}
