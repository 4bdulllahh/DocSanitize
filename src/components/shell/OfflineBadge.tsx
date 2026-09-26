import { ShieldCheck } from "lucide-react";

export function OfflineBadge() {
  return (
    <div
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-success/30 bg-success-soft px-3 py-1 text-xs font-semibold text-success-text"
      title="Every file is processed inside your browser. Nothing is ever uploaded."
    >
      <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">100% Offline / Client-Side Engine</span>
      <span className="sm:hidden">100% Offline</span>
    </div>
  );
}
