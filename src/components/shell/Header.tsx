import Link from "next/link";
import { Menu, Shield } from "lucide-react";
import { siteConfig } from "@/config/site";
import { GithubIcon } from "./GithubIcon";
import { OfflineBadge } from "./OfflineBadge";
import { ThemeToggle } from "./ThemeToggle";
import { ToolSearch } from "./ToolSearch";

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:gap-3 sm:px-4 lg:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="-ml-1 rounded-md p-2 text-fg-muted hover:bg-surface-muted lg:hidden"
        aria-label="Open tool menu"
      >
        <Menu className="size-5" />
      </button>

      <Link href="/" className="flex items-center gap-2.5" aria-label={`${siteConfig.name} home`}>
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg">
          <Shield className="size-4.5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="hidden text-lg font-semibold tracking-tight text-fg min-[420px]:inline">{siteConfig.name}</span>
      </Link>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <ToolSearch />
        <OfflineBadge />
        <ThemeToggle />
        <a
          href={siteConfig.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 md:px-3 text-sm font-medium text-fg-muted transition-colors hover:border-brand-border hover:text-brand-text"
        >
          <GithubIcon className="size-4" />
          <span className="sr-only md:not-sr-only">Star on GitHub</span>
        </a>
      </div>
    </header>
  );
}
