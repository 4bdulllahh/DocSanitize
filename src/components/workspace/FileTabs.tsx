"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { CircleAlert, CircleCheck, LoaderCircle, Plus, X } from "lucide-react";
import { KindIcon } from "@/components/files/KindIcon";
import { formatBytes, KIND_LABELS } from "@/lib/files";
import type { Tool } from "@/lib/tools";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";

const TAB_DRAG_TYPE = "application/x-docsanitize-tab";

export const tabId = (fileId: string) => `file-tab-${fileId}`;
export const PANEL_ID = "file-panel";

export function FileTabs({ tool, onAddFiles }: { tool: Tool; onAddFiles: () => void }) {
  const files = useWorkspaceStore((s) => s.files);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);
  const removeFile = useWorkspaceStore((s) => s.removeFile);
  const reorderFiles = useWorkspaceStore((s) => s.reorderFiles);
  const clearFiles = useWorkspaceStore((s) => s.clearFiles);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Keep the active tab visible when it changes (new files, keyboard navigation, closing).
  useEffect(() => {
    if (activeFileId) {
      document.getElementById(tabId(activeFileId))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeFileId]);

  function focusTab(index: number) {
    const file = files[index];
    if (!file) return;
    setActiveFile(file.id);
    document.getElementById(tabId(file.id))?.focus();
  }

  function onKeyDown(e: KeyboardEvent, index: number, file: WorkspaceFile) {
    const last = files.length - 1;
    const keys: Record<string, () => void> = {
      ArrowRight: () => focusTab(index === last ? 0 : index + 1),
      ArrowLeft: () => focusTab(index === 0 ? last : index - 1),
      Home: () => focusTab(0),
      End: () => focusTab(last),
      Delete: () => {
        removeFile(file.id);
        // Move focus to whichever tab became active so keyboard users aren't stranded.
        requestAnimationFrame(() => {
          const next = useWorkspaceStore.getState().activeFileId;
          if (next) document.getElementById(tabId(next))?.focus();
        });
      },
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  function endDrag() {
    setDragIndex(null);
    setDropIndex(null);
  }

  return (
    <div className="flex bg-canvas">
      <div
        role="tablist"
        aria-label="Open files"
        className="relative flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-line scrollbar-thin lg:px-4"
      >
        {files.map((file, index) => {
          const active = file.id === activeFileId;
          const compatible = tool.accepts.includes(file.kind);
          return (
            <div
              key={file.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG_TYPE, file.id);
                e.dataTransfer.effectAllowed = "move";
                setDragIndex(index);
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropIndex(index);
              }}
              onDrop={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                reorderFiles(dragIndex, index);
                endDrag();
              }}
              onDragEnd={endDrag}
              className={clsx(
                "group relative z-10 flex max-w-60 shrink-0 items-center rounded-t-lg border border-b-0 transition-colors",
                active
                  ? "border-line bg-surface text-fg shadow-[inset_0_2px_0_var(--brand-text)]"
                  : "border-transparent text-fg-muted hover:bg-surface/60 hover:text-fg",
                !compatible && "opacity-60",
                dragIndex === index && "opacity-40",
                dropIndex === index && dragIndex !== index && "ring-2 ring-brand-border",
              )}
            >
              <button
                type="button"
                role="tab"
                id={tabId(file.id)}
                aria-selected={active}
                aria-controls={PANEL_ID}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveFile(file.id)}
                onAuxClick={(e) => e.button === 1 && removeFile(file.id)}
                onKeyDown={(e) => onKeyDown(e, index, file)}
                title={`${file.name} — ${KIND_LABELS[file.kind]}, ${formatBytes(file.size)}${compatible ? "" : ` (not supported by ${tool.name})`}`}
                className="flex min-w-0 items-center gap-2 py-2 pr-1 pl-3 text-sm"
              >
                <TabStatusIcon file={file} active={active} />
                <span className="truncate">{file.name}</span>
              </button>
              <button
                type="button"
                onClick={() => removeFile(file.id)}
                tabIndex={-1}
                aria-label={`Close ${file.name}`}
                className={clsx(
                  "mr-1.5 rounded p-0.5 text-fg-subtle transition-opacity hover:bg-surface-muted hover:text-fg",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 pt-2 pb-1 lg:pr-4">
        <button
          type="button"
          onClick={onAddFiles}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-text hover:bg-brand-soft"
        >
          <Plus className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Add files</span>
          <span className="sr-only sm:hidden">Add files</span>
        </button>
        {files.length > 1 && (
          <button
            type="button"
            onClick={clearFiles}
            className="rounded-lg px-2.5 py-1.5 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            Close all
          </button>
        )}
      </div>
    </div>
  );
}

function TabStatusIcon({ file, active }: { file: WorkspaceFile; active: boolean }) {
  switch (file.status) {
    case "processing":
      return <LoaderCircle className="size-4 shrink-0 animate-spin text-brand-text" aria-label="Processing" />;
    case "done":
      return <CircleCheck className="size-4 shrink-0 text-success" aria-label="Done" />;
    case "error":
      return <CircleAlert className="size-4 shrink-0 text-danger" aria-label="Error" />;
    default:
      return <KindIcon kind={file.kind} className={clsx("size-4 shrink-0", active && "text-brand-text")} />;
  }
}
