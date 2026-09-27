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
}: {
  label: string;
  hint?: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
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
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
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
