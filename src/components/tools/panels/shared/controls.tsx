"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";

export const INPUT = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-brand-border";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="mt-4 block text-sm">
      <span className="font-medium text-fg">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger-text">{error}</span> : hint && <span className="mt-1 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

/** A compact single-choice control (radio group) with arrow-key navigation. */
export function Segmented<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
  columns,
}: {
  label: string;
  hint?: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Wrap the options into this many columns (default: one row). */
  columns?: number;
}) {
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    let index = options.findIndex((o) => o.id === value);
    do index = (index + step + options.length) % options.length;
    while (options[index].disabled && options[index].id !== value);
    onChange(options[index].id);
    groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[index]?.focus();
  };

  return (
    <div className="mt-4">
      <p id={labelId} className={clsx("text-sm font-medium text-fg", disabled && "opacity-50")}>
        {label}
      </p>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="mt-1.5 grid gap-1 rounded-lg bg-surface-muted p-1"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const checked = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled || o.disabled}
              onClick={() => onChange(o.id)}
              className={clsx(
                "rounded-md px-2 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                checked ? "bg-surface text-fg shadow-elev-1 ring-1 ring-line-strong" : "text-fg-muted hover:text-fg",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

const ANCHORS = ["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"] as const;
export type AnchorId = (typeof ANCHORS)[number];
const anchorLabel = (a: AnchorId) => (a === "center" ? "Centre" : a.replace("-", " ").replace("center", "centre").replace(/^./, (c) => c.toUpperCase()));

/** A 3 × 3 grid for choosing where on the page something goes. `allowed` limits the usable spots. */
export function AnchorPicker({ label, value, onChange, allowed = ANCHORS }: { label: string; value: AnchorId | null; onChange: (value: AnchorId) => void; allowed?: readonly AnchorId[] }) {
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const index = ANCHORS.indexOf(value ?? "center");
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 };
    const step = moves[event.key];
    if (step === undefined) return;
    event.preventDefault();
    // Skip spots that aren't allowed, in the direction of travel.
    for (let i = index + step; i >= 0 && i < 9; i += step) {
      if (Math.abs(step) === 1 && Math.floor(i / 3) !== Math.floor(index / 3)) break;
      if (allowed.includes(ANCHORS[i])) {
        onChange(ANCHORS[i]);
        groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[i]?.focus();
        break;
      }
    }
  };
  return (
    <div className="mt-4">
      <p id={labelId} className="text-sm font-medium text-fg">
        {label}
      </p>
      <div ref={groupRef} role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown} className="mt-1.5 grid w-32 grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1.5">
        {ANCHORS.map((a) => {
          const usable = allowed.includes(a);
          const checked = value === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={anchorLabel(a)}
              tabIndex={checked || (value === null && a === allowed[0]) ? 0 : -1}
              disabled={!usable}
              onClick={() => onChange(a)}
              className={clsx("flex h-7 items-center justify-center rounded-md transition-colors disabled:cursor-default", checked ? "bg-brand" : usable ? "bg-surface hover:bg-brand-soft" : "bg-transparent")}
            >
              <span className={clsx("size-1.5 rounded-full", checked ? "bg-brand-fg" : usable ? "bg-fg-subtle" : "bg-line")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Preset colours plus a custom picker. */
export function ColorField({ label, value, onChange, presets }: { label: string; value: string; onChange: (value: string) => void; presets: { value: string; name: string }[] }) {
  const labelId = useId();
  return (
    <div className="mt-4">
      <p id={labelId} className="text-sm font-medium text-fg">
        {label}
      </p>
      <div role="group" aria-labelledby={labelId} className="mt-1.5 flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            aria-label={p.name}
            aria-pressed={value.toLowerCase() === p.value.toLowerCase()}
            className={clsx("size-7 rounded-full border border-line-strong", value.toLowerCase() === p.value.toLowerCase() && "ring-2 ring-brand-border ring-offset-2 ring-offset-surface")}
            style={{ backgroundColor: p.value }}
          />
        ))}
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-7 cursor-pointer rounded border border-line bg-transparent" aria-label={`Custom ${label.toLowerCase()}`} />
          Custom
        </label>
      </div>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, format, onChange }: { label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (value: number) => void }) {
  return (
    <label className="mt-4 block text-sm">
      <span className="flex justify-between font-medium text-fg">
        {label} <span className="font-normal text-fg-muted tabular-nums">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.valueAsNumber)} className="mt-2 w-full accent-brand" />
    </label>
  );
}
