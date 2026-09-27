"use client";

import { useState } from "react";
import { formatPageRanges, parsePageRanges } from "@/lib/pdf/ranges";

/**
 * Page selection by clicking (shift-click for a range) or typing ranges such as "1-3, 5".
 * Indices are 0-based. `onChange` runs on every edit, e.g. to clear a stale result.
 */
export function usePageSelection(pageCount: number, initial: number[] = [], onChange?: () => void) {
  const [selected, setSelected] = useState<number[]>(initial);
  const [text, setText] = useState(() => formatPageRanges(initial));
  const [anchor, setAnchor] = useState<number | null>(null);

  const select = (indices: number[]) => {
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    setSelected(unique);
    setText(formatPageRanges(unique));
    onChange?.();
  };

  /** Toggle a page, or with shift add the range from the last clicked page. `fresh` ignores the current selection. */
  const click = (index: number, event: { shiftKey: boolean }, fresh = false) => {
    const base = fresh ? [] : selected;
    if (event.shiftKey && anchor !== null) {
      const [a, b] = [anchor, index].sort((x, y) => x - y);
      select([...base, ...Array.from({ length: b - a + 1 }, (_, i) => a + i)]);
    } else {
      select(base.includes(index) ? base.filter((i) => i !== index) : [...base, index]);
      setAnchor(index);
    }
  };

  const type = (value: string) => {
    setText(value);
    onChange?.();
    const parsed = parsePageRanges(value, pageCount);
    if (parsed.ok) setSelected([...new Set(parsed.groups.flat())].sort((a, b) => a - b));
    else if (!value.trim()) setSelected([]);
  };

  const parsed = text.trim() ? parsePageRanges(text, pageCount) : null;
  return {
    selected,
    text,
    /** Problem with the typed ranges, if any. */
    error: parsed && !parsed.ok ? parsed.error : undefined,
    select,
    click,
    type,
    selectAll: () => select(Array.from({ length: pageCount }, (_, i) => i)),
    clear: () => select([]),
  };
}
