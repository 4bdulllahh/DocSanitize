"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
    >
      {/* Both icons render; CSS picks one so the prerendered HTML is correct before hydration. */}
      <Moon className="size-4.5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4.5 dark:block" aria-hidden="true" />
    </button>
  );
}
