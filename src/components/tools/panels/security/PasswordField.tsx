"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";
import type { PasswordStrength } from "@/lib/password";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Show the characters (controlled from outside, e.g. after generating a password). */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  error?: string;
  hint?: string;
  autoFocus?: boolean;
  autoComplete?: "new-password" | "current-password" | "off";
  strength?: PasswordStrength;
}

const METER = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

export function PasswordField({ label, value, onChange, visible, onVisibleChange, error, hint, autoFocus, autoComplete = "off", strength }: Props) {
  const id = useId();
  const [ownVisible, setOwnVisible] = useState(false);
  const shown = visible ?? ownVisible;
  const setShown = onVisibleChange ?? setOwnVisible;
  const describedBy = error || hint || strength?.label ? `${id}-help` : undefined;

  return (
    <div className="mt-4 text-sm">
      <label htmlFor={id} className="font-medium text-fg">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(
            "w-full rounded-lg border bg-canvas py-2 pr-10 pl-3 font-mono text-sm text-fg outline-none",
            error ? "border-danger" : "border-line focus:border-brand-border",
          )}
        />
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-fg-subtle hover:text-fg"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {strength && value && (
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={clsx("h-1 flex-1 rounded-full", i < Math.max(1, strength.score) ? METER[strength.score] : "bg-surface-muted")} />
          ))}
        </div>
      )}
      <p id={`${id}-help`} className={clsx("mt-1 text-xs", error ? "text-danger-text" : "text-fg-subtle")} aria-live="polite">
        {error ?? (strength && value ? [strength.label, strength.hint].filter(Boolean).join(" · ") : hint)}
      </p>
    </div>
  );
}
