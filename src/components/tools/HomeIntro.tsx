"use client";

import { CloudOff, Code2, UserX } from "lucide-react";
import { msg } from "@/i18n/msg";
import { useT } from "@/store/locale";

const PROMISES = [
  { icon: CloudOff, title: msg("Nothing is uploaded"), body: msg("Every operation runs in your browser. There is no server to send files to.") },
  { icon: UserX, title: msg("No account, no tracking"), body: msg("Open the page and start working. No sign-up, cookies or analytics.") },
  { icon: Code2, title: msg("Open source"), body: msg("MIT licensed. Read the code, self-host it, or run it fully offline.") },
];

export function HomeIntro() {
  const t = useT();
  return (
    <>
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t("Your documents never leave this device.")}</h1>
        <p className="mt-3 text-base leading-relaxed text-fg-muted sm:text-lg">
          {t("Strip hidden metadata, reorganize, convert, sign and secure PDFs and images — all processed locally in your browser.")}
        </p>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {PROMISES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
            <Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-fg">{t(title)}</h2>
              <p className="mt-0.5 text-sm text-fg-muted">{t(body)}</p>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
