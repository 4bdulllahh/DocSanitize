"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CornerDownLeft, Search } from "lucide-react";
import { searchTools, TOOL_CATEGORIES, type Tool } from "@/lib/tools";

const noSubscribe = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** "Search tools" button in the header, and the dialog it opens (also on Ctrl+K / ⌘K from anywhere). */
export function ToolSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const apple = useSyncExternalStore(noSubscribe, isApple, () => false);
  const results = searchTools(query);
  const current = Math.min(active, results.length - 1);

  const open = () => {
    setQuery("");
    setActive(0);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();
  const go = (tool: Tool) => {
    close();
    router.push(`/tools/${tool.id}`);
  };

  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialogRef.current?.open) close();
      else open();
    }
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((current + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (event.key === "Enter" && results[current]) {
      event.preventDefault();
      go(results[current]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-keyshortcuts="Control+K Meta+K"
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Search tools</span>
        <kbd className="hidden rounded border border-line bg-surface-muted px-1.5 font-sans text-[11px] text-fg-subtle md:inline">{apple ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Search tools"
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-auto mt-[10vh] w-[min(36rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-line bg-surface p-0 text-fg shadow-elev-2 backdrop:bg-black/40"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="tool-search-results"
            aria-autocomplete="list"
            aria-activedescendant={results[current] ? `tool-search-${results[current].id}` : undefined}
            aria-label="Search tools"
            placeholder="Search tools — e.g. compress, iPhone photo, password"
            className="h-14 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
          />
        </div>
        {results.length ? (
          <ul id="tool-search-results" role="listbox" aria-label="Tools" className="max-h-[min(26rem,60vh)] overflow-y-auto p-2">
            {results.map((tool, i) => {
              const Icon = tool.icon;
              return (
                <li
                  key={tool.id}
                  id={`tool-search-${tool.id}`}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => i !== current && setActive(i)}
                  onClick={() => go(tool)}
                  className={clsx("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5", i === current && "bg-brand-soft")}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand-text">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block text-sm font-medium", i === current ? "text-brand-text" : "text-fg")}>{tool.name}</span>
                    <span className="block truncate text-xs text-fg-muted">{tool.description}</span>
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-fg-subtle sm:block">{TOOL_CATEGORIES.find((c) => c.id === tool.category)?.name}</span>
                  {i === current && <CornerDownLeft className="hidden size-3.5 shrink-0 text-fg-subtle sm:block" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-fg-muted" role="status">
            No tools match &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
      </dialog>
    </>
  );
}
