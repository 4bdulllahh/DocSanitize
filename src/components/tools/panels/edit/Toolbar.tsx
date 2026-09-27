"use client";

import { Fragment } from "react";
import clsx from "clsx";
import { Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { TOOL_GROUPS, type Tool } from "./model";

export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const BUTTON = "flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent";

export function Toolbar({
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoom,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  const zoomIndex = ZOOMS.indexOf(zoom);
  return (
    <div
      role="toolbar"
      aria-label="Editing tools"
      className="sticky top-16 z-10 flex items-center gap-1 overflow-x-auto rounded-t-xl border-b border-line bg-surface px-2 py-1.5 sm:flex-wrap sm:overflow-visible"
    >
      {TOOL_GROUPS.map((group, g) => (
        <Fragment key={g}>
          {g > 0 && <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />}
          {group.map(({ id, label, icon: Icon, key }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTool(id)}
              aria-pressed={tool === id}
              aria-label={label}
              aria-keyshortcuts={key?.toUpperCase()}
              title={key ? `${label} (${key.toUpperCase()})` : label}
              className={clsx(BUTTON, tool === id && "bg-brand-soft text-brand-text hover:bg-brand-soft hover:text-brand-text")}
            >
              <Icon className="size-4.5" aria-hidden="true" />
            </button>
          ))}
        </Fragment>
      ))}
      <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)" className={BUTTON}>
        <Undo2 className="size-4.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z" title="Redo (Ctrl+Shift+Z)" className={BUTTON}>
        <Redo2 className="size-4.5" aria-hidden="true" />
      </button>
      <span className="flex-1" />
      <button type="button" onClick={() => onZoom(ZOOMS[zoomIndex - 1])} disabled={zoomIndex <= 0} aria-label="Zoom out" className={BUTTON}>
        <ZoomOut className="size-4.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onZoom(1)} className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-fg-muted tabular-nums hover:bg-surface-muted hover:text-fg" aria-label={`Zoom ${Math.round(zoom * 100)}%; reset to fit the width`}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={() => onZoom(ZOOMS[zoomIndex + 1])} disabled={zoomIndex >= ZOOMS.length - 1} aria-label="Zoom in" className={BUTTON}>
        <ZoomIn className="size-4.5" aria-hidden="true" />
      </button>
    </div>
  );
}
