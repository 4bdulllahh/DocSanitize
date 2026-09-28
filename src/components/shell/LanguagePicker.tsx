"use client";

import { Languages } from "lucide-react";
import { LOCALES, type Locale } from "@/i18n/locales";
import { useLocaleStore, useT } from "@/store/locale";

/** Interface language: a native select (keyboard, screen readers and phones handle it well). */
export function LanguagePicker() {
  const t = useT();
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <label className="relative inline-flex items-center rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg" title={t("Language")}>
      <Languages className="size-4.5" aria-hidden="true" />
      <select
        value={t.locale}
        onChange={(e) => void setLocale(e.target.value as Locale, true)}
        aria-label={t("Language")}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
