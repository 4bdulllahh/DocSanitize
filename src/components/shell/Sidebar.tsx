"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { House, Lock, X } from "lucide-react";
import { TOOL_CATEGORIES, toolsInCategory } from "@/lib/tools";

function normalize(path: string) {
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = normalize(usePathname());

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-surface transition-transform",
          "lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100dvh-4rem)] lg:w-64 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Tools"
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-4 lg:hidden">
          <span className="font-semibold text-fg">Tools</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-fg-muted hover:bg-surface-muted"
            aria-label="Close tool menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavLink href="/" active={pathname === "/"} onNavigate={onClose}>
            <House className="size-4 shrink-0" aria-hidden="true" />
            <span>All tools</span>
          </NavLink>

          {TOOL_CATEGORIES.map((category) => (
            <div key={category.id} className="mt-5">
              <h2 className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                {category.name}
              </h2>
              <ul className="space-y-0.5">
                {toolsInCategory(category.id).map((tool) => {
                  const href = `/tools/${tool.id}`;
                  const Icon = tool.icon;
                  return (
                    <li key={tool.id}>
                      <NavLink href={href} active={pathname === href} onNavigate={onClose}>
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{tool.name}</span>
                        {tool.status === "planned" && (
                          <span className="ml-auto rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                            Soon
                          </span>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-4">
          <div className="flex gap-2.5 rounded-lg bg-canvas p-3 text-xs leading-relaxed text-fg-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
            <p>Files stay in this browser tab&apos;s memory and are discarded when you close it.</p>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-brand-soft font-medium text-brand-text"
          : "text-fg-muted hover:bg-surface-muted hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
