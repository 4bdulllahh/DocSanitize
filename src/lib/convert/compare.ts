import { createTranslator, type Translator } from "@/i18n/translate";
import { groupLines, splitColumns, type TextPage } from "../office/text-layout";
import { pageTextIndex, spanBoxes, type Box } from "../pdf/redact-search";

/*
 * Compare PDFs: the words of two versions, in reading order, diffed. Unchanged stretches are
 * matched first on words that occur once in each (patience diff), which keeps big documents fast
 * and lines moved around from matching nonsense; the gaps between are diffed exactly (Myers).
 */

export interface Word {
  text: string;
  /** 0-based page index. */
  page: number;
  /** Where it is, as fractions of the displayed page (one per text run it spans). */
  boxes: Box[];
}

export type DiffOp = { kind: "equal" | "delete" | "insert"; a: [number, number]; b: [number, number] };

export interface Change {
  kind: "added" | "removed" | "changed";
  before: string;
  after: string;
  /** Words in each version (empty for a pure insertion or deletion). */
  beforeWords: Word[];
  afterWords: Word[];
  /** Where it happened in each version: the page of the change or of the word next to it. */
  beforePage: number;
  afterPage: number;
  /** For a pure insertion or deletion: the word next to where it happened in the other version. */
  anchor?: Word;
}

export interface Comparison {
  changes: Change[];
  wordsBefore: number;
  wordsAfter: number;
  /** Words present in both. */
  unchanged: number;
}

/** A page's words in reading order: columns left to right, lines top to bottom. */
export function pageWords(page: TextPage, pageIndex: number): Word[] {
  const words: Word[] = [];
  for (const column of splitColumns(page.items, page.width)) {
    for (const line of groupLines(column)) {
      const sorted: TextPage = { ...page, items: line.items };
      const index = pageTextIndex(sorted);
      for (const m of index.text.matchAll(/\S+/g)) {
        words.push({ text: m[0], page: pageIndex, boxes: spanBoxes(sorted, index, m.index, m.index + m[0].length) });
      }
    }
  }
  return words;
}

/** The form words are compared in: compatibility forms folded (ligatures, wide digits), quotes and dashes unified. */
export function wordKey(word: string): string {
  return word
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00ad/g, "");
}

/** Myers' O(ND) diff of a[aLo..aHi) and b[bLo..bHi); null when it needs more than `maxD` edits. */
function myers(a: number[], b: number[], aLo: number, aHi: number, bLo: number, bHi: number, maxD: number): DiffOp[] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
  }
  if (found < 0) return null;

  // Walk back through the saved frontiers.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  const push = (kind: DiffOp["kind"], ax: number, ax2: number, by: number, by2: number) => {
    const last = ops[0];
    if (last && last.kind === kind && last.a[0] === aLo + ax2 && last.b[0] === bLo + by2) {
      last.a[0] = aLo + ax;
      last.b[0] = bLo + by;
    } else {
      ops.unshift({ kind, a: [aLo + ax, aLo + ax2], b: [bLo + by, bLo + by2] });
    }
  };
  for (let d = found; d > 0; d--) {
    const frontier = trace[d]; // v before step d, indices k+d+1
    const at = (k: number) => frontier[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const startX = down ? prevX : prevX + 1;
    const startY = startX - k;
    if (x > startX) push("equal", startX, x, startY, y);
    if (down) push("insert", prevX, prevX, prevY, startY);
    else push("delete", prevX, startX, prevY, prevY);
    x = prevX;
    y = prevY;
  }
  if (x > 0) push("equal", 0, x, 0, y);
  return ops;
}

/** Longest increasing subsequence of pairs by `b` (pairs already sorted by `a`). */
function lis(pairs: [number, number][]): [number, number][] {
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([, b], i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < b) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const out: [number, number][] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.unshift(pairs[i]);
  return out;
}

const MAX_D = 1500;

/** Diff two sequences of word ids. */
export function diffSequences(a: number[], b: number[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const emit = (kind: DiffOp["kind"], a0: number, a1: number, b0: number, b1: number) => {
    if (a1 - a0 === 0 && b1 - b0 === 0) return;
    const last = ops.at(-1);
    if (last && last.kind === kind && last.a[1] === a0 && last.b[1] === b0) {
      last.a[1] = a1;
      last.b[1] = b1;
    } else {
      ops.push({ kind, a: [a0, a1], b: [b0, b1] });
    }
  };
  const replace = (a0: number, a1: number, b0: number, b1: number) => {
    emit("delete", a0, a1, b0, b0);
    emit("insert", a1, a1, b0, b1);
  };

  const solve = (a0: number, a1: number, b0: number, b1: number) => {
    // Common start and end.
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) emit("equal", a0, ++a0, b0, ++b0);
    let tail = 0;
    while (a1 - tail > a0 && b1 - tail > b0 && a[a1 - tail - 1] === b[b1 - tail - 1]) tail++;
    const [ea, eb] = [a1 - tail, b1 - tail];
    if (ea === a0 || eb === b0) {
      replace(a0, ea, b0, eb);
    } else {
      // Anchors: words that occur exactly once on each side.
      const count = new Map<number, [number, number, number]>(); // id -> [countA, countB, indexB]
      for (let i = a0; i < ea; i++) {
        const c = count.get(a[i]) ?? [0, 0, -1];
        c[0]++;
        count.set(a[i], c);
      }
      for (let j = b0; j < eb; j++) {
        const c = count.get(b[j]);
        if (c) {
          c[1]++;
          c[2] = j;
        }
      }
      const pairs: [number, number][] = [];
      for (let i = a0; i < ea; i++) {
        const c = count.get(a[i])!;
        if (c[0] === 1 && c[1] === 1) pairs.push([i, c[2]]);
      }
      const anchors = lis(pairs);
      if (anchors.length) {
        let [pa, pb] = [a0, b0];
        for (const [i, j] of anchors) {
          solve(pa, i, pb, j);
          emit("equal", i, i + 1, j, j + 1);
          [pa, pb] = [i + 1, j + 1];
        }
        solve(pa, ea, pb, eb);
      } else {
        const exact = myers(a, b, a0, ea, b0, eb, MAX_D);
        if (exact) for (const op of exact) emit(op.kind, op.a[0], op.a[1], op.b[0], op.b[1]);
        else replace(a0, ea, b0, eb);
      }
    }
    for (let t = tail; t > 0; t--) emit("equal", a1 - t, a1 - t + 1, b1 - t, b1 - t + 1);
  };
  solve(0, a.length, 0, b.length);
  return ops;
}

const join = (words: Word[]) => words.map((w) => w.text).join(" ");

/** Compare two documents' words and list the changes in reading order. */
export function compareWords(before: Word[], after: Word[]): Comparison {
  const ids = new Map<string, number>();
  const id = (w: Word) => {
    const key = wordKey(w.text);
    if (!ids.has(key)) ids.set(key, ids.size);
    return ids.get(key)!;
  };
  const a = before.map(id);
  const b = after.map(id);
  const ops = diffSequences(a, b);

  const changes: Change[] = [];
  let unchanged = 0;
  const pageNear = (words: Word[], index: number) => words[Math.min(index, words.length - 1)]?.page ?? 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.kind === "equal") {
      unchanged += op.a[1] - op.a[0];
      continue;
    }
    // Deletions and insertions next to each other are one change.
    const [aAt, bAt] = [op.a[0], op.b[0]];
    let [aEnd, bEnd] = [aAt, bAt];
    while (i < ops.length && ops[i].kind !== "equal") {
      aEnd = Math.max(aEnd, ops[i].a[1]);
      bEnd = Math.max(bEnd, ops[i].b[1]);
      i++;
    }
    i--;
    const beforeWords = before.slice(aAt, aEnd);
    const afterWords = after.slice(bAt, bEnd);
    changes.push({
      kind: beforeWords.length && afterWords.length ? "changed" : beforeWords.length ? "removed" : "added",
      before: join(beforeWords),
      after: join(afterWords),
      beforeWords,
      afterWords,
      anchor: !afterWords.length ? (after[bAt] ?? after[bAt - 1]) : !beforeWords.length ? (before[aAt] ?? before[aAt - 1]) : undefined,
      beforePage: beforeWords[0]?.page ?? pageNear(before, aAt),
      afterPage: afterWords[0]?.page ?? pageNear(after, bAt),
    });
  }
  return { changes, wordsBefore: before.length, wordsAfter: after.length, unchanged };
}

/** A plain-text list of the changes, for copying. */
export function changesReport(comparison: Comparison, names: { before: string; after: string }, t: Translator = createTranslator("en")): string {
  const lines = [t("Comparing “{before}” (before) with “{after}” (after)", names), t.plural(comparison.changes.length, "{n} change", "{n} changes"), ""];
  for (const c of comparison.changes) {
    if (c.kind === "added") lines.push(t("Added (page {page}): {text}", { page: c.afterPage + 1, text: c.after }));
    else if (c.kind === "removed") lines.push(t("Removed (page {page}): {text}", { page: c.beforePage + 1, text: c.before }));
    else lines.push(t("Changed (page {from} → {to}): {before} → {after}", { from: c.beforePage + 1, to: c.afterPage + 1, before: c.before, after: c.after }));
  }
  return `${lines.join("\n")}\n`;
}
