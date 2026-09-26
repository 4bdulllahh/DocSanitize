"use client";

import { Construction } from "lucide-react";
import { extensionsFor } from "@/lib/files";
import { getTool, TOOL_CATEGORIES } from "@/lib/tools";

export function ToolView({ toolId }: { toolId: string }) {
  const tool = getTool(toolId);
  if (!tool) return null;

  const Icon = tool.icon;
  const category = TOOL_CATEGORIES.find((c) => c.id === tool.category);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-4 py-5 lg:px-8">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">{category?.name}</p>
            <h1 className="text-xl font-semibold text-fg">{tool.name}</h1>
            <p className="mt-1 text-sm text-fg-muted">{tool.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {extensionsFor(tool.accepts).map((ext) => (
                <span
                  key={ext}
                  className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                >
                  {ext}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Workspace (dropzone + file tabs) lands in Milestone 2. */}
      <div className="flex flex-1 items-center justify-center p-6 lg:p-10">
        <div className="flex w-full max-w-xl flex-col items-center rounded-xl border-2 border-dashed border-line bg-surface px-6 py-14 text-center">
          <Construction className="size-8 text-fg-subtle" aria-hidden="true" />
          <h2 className="mt-3 font-semibold text-fg">Workspace coming soon</h2>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            This tool is part of the DocSanitize roadmap and isn&apos;t available yet.
          </p>
        </div>
      </div>
    </div>
  );
}
