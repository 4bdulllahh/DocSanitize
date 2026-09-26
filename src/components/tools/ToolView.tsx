"use client";

import { Workspace } from "@/components/workspace/Workspace";
import { extensionsFor } from "@/lib/files";
import { getTool, TOOL_CATEGORIES } from "@/lib/tools";

export function ToolView({ toolId }: { toolId: string }) {
  const tool = getTool(toolId);
  if (!tool) return null;

  const Icon = tool.icon;
  const category = TOOL_CATEGORIES.find((c) => c.id === tool.category);

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="border-b border-line bg-surface px-4 py-4 lg:px-6">
        <div className="flex items-center gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">{category?.name}</p>
            <h1 className="text-lg leading-tight font-semibold text-fg">{tool.name}</h1>
          </div>
          <div className="hidden flex-wrap justify-end gap-1.5 md:flex">
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
        <p className="mt-2 text-sm text-fg-muted">{tool.description}</p>
      </div>

      <Workspace tool={tool} />
    </div>
  );
}
