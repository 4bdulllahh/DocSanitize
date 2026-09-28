"use client";

import { ShieldCheck } from "lucide-react";
import { useT } from "@/store/locale";

export function OfflineBadge() {
  const t = useT();
  return (
    <div
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-success/30 bg-success-soft px-2 py-1 min-[420px]:px-3 text-xs font-semibold text-success-text"
      title={t("Every file is processed inside your browser. Nothing is ever uploaded.")}
    >
      <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
      <span className="hidden lg:inline">{t("100% Offline / Client-Side Engine")}</span>
      <span className="max-[419px]:sr-only lg:hidden">{t("100% Offline")}</span>
    </div>
  );
}
