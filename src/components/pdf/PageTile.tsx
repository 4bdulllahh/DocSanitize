"use client";

import type { MouseEvent, ReactNode } from "react";
import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Check } from "lucide-react";
import { PageThumbnail } from "./PageThumbnail";

interface Props {
  doc: PDFDocumentProxy;
  /** 0-based page index. */
  index: number;
  /** Highlighted with a check mark. */
  selected: boolean;
  /** Faded, e.g. not part of the output. */
  dimmed?: boolean;
  /** aria-pressed; leave undefined when the tile isn't a toggle. */
  pressed?: boolean;
  label: string;
  /** Extra overlay, e.g. a "Part 2" badge. */
  badge?: ReactNode;
  onClick: (event: MouseEvent) => void;
}

/** A clickable page thumbnail for page-picking grids (Split, PDF to Images). */
export function PageTile({ doc, index, selected, dimmed, pressed, label, badge, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      className={clsx(
        "relative w-full rounded-xl border-2 p-2 transition-colors",
        selected ? "border-brand-text bg-brand-soft" : "border-transparent hover:bg-surface-muted",
      )}
    >
      <PageThumbnail doc={doc} pageNumber={index + 1} width={120} height={156} className={clsx("mx-auto", dimmed && "opacity-40")} />
      <span className="mt-1.5 block text-center text-xs font-semibold text-fg tabular-nums">{index + 1}</span>
      {selected && (
        <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-brand text-brand-fg">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
      )}
      {badge}
    </button>
  );
}
