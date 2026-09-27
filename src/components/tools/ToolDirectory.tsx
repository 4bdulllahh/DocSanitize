"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { searchTools, TOOL_CATEGORIES, TOOLS, toolsInCategory } from "@/lib/tools";
import { ToolCard } from "./ToolCard";

/** The home page's tool grid, by category, with a filter box above it. */
export function ToolDirectory() {
  const [query, setQuery] = useState("");
  const results = query.trim() ? searchTools(query) : null;

  return (
    <>
      <div className="relative mt-12 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter tools"
          placeholder={`Search ${TOOLS.filter((t) => t.status === "ready").length} tools — e.g. merge, iPhone photo`}
          className="w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-brand-border"
        />
      </div>

      {results ? (
        <section className="mt-6" aria-live="polite">
          <h2 className="text-sm font-semibold tracking-wider text-fg-subtle uppercase">
            {results.length ? `${results.length} matching tool${results.length === 1 ? "" : "s"}` : "No matching tools"}
          </h2>
          {results.length > 0 ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">Try another word, such as &ldquo;convert&rdquo;, &ldquo;pages&rdquo; or &ldquo;privacy&rdquo;.</p>
          )}
        </section>
      ) : (
        TOOL_CATEGORIES.map((category) => (
          <section key={category.id} className="mt-10 first-of-type:mt-8">
            <h2 className="text-sm font-semibold tracking-wider text-fg-subtle uppercase">{category.name}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {toolsInCategory(category.id).map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
