"use client";

import Link from "next/link";
import { Menu, Shield } from "lucide-react";
import { siteConfig } from "@/config/site";
import { useT } from "@/store/locale";
import { GithubIcon } from "./GithubIcon";
import { LanguagePicker } from "./LanguagePicker";
import { OfflineBadge } from "./OfflineBadge";
import { ThemeToggle } from "./ThemeToggle";
import { ToolSearch } from "./ToolSearch";

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const t = useT();
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:gap-3 sm:px-4 lg:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="-ms-1 rounded-md p-2 text-fg-muted hover:bg-surface-muted lg:hidden"
        aria-label={t("Open tool menu")}
      >
        <Menu className="size-5" />
      </button>

      <Link href="/" className="flex items-center gap-2.5" aria-label={t("{name} home", { name: siteConfig.name })}>
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg">
          <Shield className="size-4.5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="hidden text-lg font-semibold tracking-tight text-fg min-[420px]:inline">{siteConfig.name}</span>
      </Link>

      <div className="ms-auto flex items-center gap-1.5 sm:gap-3">
        <ToolSearch />
        <OfflineBadge />
        <LanguagePicker />
        <ThemeToggle />
        <a
          href={siteConfig.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 md:px-3 text-sm font-medium text-fg-muted transition-colors hover:border-brand-border hover:text-brand-text"
        >
          <GithubIcon className="size-4" />
          <span className="sr-only md:not-sr-only">{t("Star on GitHub")}</span>
        </a>
      </div>
    </header>
  );
}
