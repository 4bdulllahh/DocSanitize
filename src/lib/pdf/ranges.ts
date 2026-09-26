export type RangeResult = { ok: true; groups: number[][] } | { ok: false; error: string };

/**
 * Parse page ranges typed by a user, e.g. "1-3, 5, 8-" (1-based, "8-" means 8 to the end,
 * "-3" means 1 to 3). Returns one group of 0-based page indices per comma-separated part.
 */
export function parsePageRanges(input: string, pageCount: number): RangeResult {
  const parts = input
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "Enter at least one page or range." };

  const groups: number[][] = [];
  for (const part of parts) {
    const m = /^(\d*)\s*(?:(-|–|to)\s*(\d*))?$/i.exec(part);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `“${part}” isn't a page number or range.` };
    const isRange = Boolean(m[2]);
    const from = m[1] ? Number(m[1]) : 1;
    const to = isRange ? (m[3] ? Number(m[3]) : pageCount) : from;
    for (const n of [from, to]) {
      if (n < 1 || n > pageCount) {
        return { ok: false, error: `Page ${n} doesn't exist — this document has ${pageCount} page${pageCount === 1 ? "" : "s"}.` };
      }
    }
    if (from > to) return { ok: false, error: `“${part}” runs backwards. Write it as ${to}-${from}.` };
    groups.push(Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  }
  return { ok: true, groups };
}

/** 0-based indices -> "1-3, 5" (runs of consecutive pages collapse into ranges). */
export function formatPageRanges(indices: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++;
    parts.push(j > i ? `${indices[i] + 1}-${indices[j] + 1}` : `${indices[i] + 1}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Split 0..pageCount-1 into consecutive chunks of `size` pages. */
export function chunkPages(pageCount: number, size: number): number[][] {
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    groups.push(Array.from({ length: Math.min(size, pageCount - start) }, (_, i) => start + i));
  }
  return groups;
}
