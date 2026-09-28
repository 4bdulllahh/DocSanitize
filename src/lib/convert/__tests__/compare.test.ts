import { describe, expect, it } from "vitest";
import type { TextItem, TextPage } from "../../office/text-layout";
import { changesReport, compareWords, diffSequences, pageWords, wordKey, type Word } from "../compare";

const words = (text: string, page = 0): Word[] => text.split(/\s+/).filter(Boolean).map((t) => ({ text: t, page, boxes: [] }));

/** Apply a diff to `a` and check it produces `b`. */
function check(a: number[], b: number[]) {
  const ops = diffSequences(a, b);
  const out: number[] = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    expect(op.a[0]).toBe(ai);
    expect(op.b[0]).toBe(bi);
    if (op.kind === "equal") {
      expect(a.slice(...op.a)).toEqual(b.slice(...op.b));
      out.push(...a.slice(...op.a));
    } else if (op.kind === "insert") out.push(...b.slice(...op.b));
    [ai, bi] = [op.a[1], op.b[1]];
  }
  expect([ai, bi]).toEqual([a.length, b.length]);
  expect(out).toEqual(b);
  return ops;
}

describe("diff", () => {
  it("finds a minimal edit script", () => {
    const ops = check([1, 2, 3, 4, 5], [1, 2, 9, 4, 5, 6]);
    expect(ops.filter((o) => o.kind !== "equal").map((o) => o.kind)).toEqual(["delete", "insert", "insert"]);
    check([], [1, 2]);
    check([1, 2], []);
    check([1, 1, 1, 2], [2, 1, 1, 1]);
  });

  it("stays correct on random edits", () => {
    let seed = 7;
    const random = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
    for (let t = 0; t < 60; t++) {
      const a = Array.from({ length: random(80) }, () => random(12));
      const b = a.filter(() => random(10) > 1).flatMap((x) => (random(10) === 0 ? [x, random(12)] : [x]));
      check(a, b);
    }
  });

  it("handles big documents quickly", () => {
    const a = Array.from({ length: 60000 }, (_, i) => i % 5000);
    const b = [...a.slice(0, 30000), 99999, ...a.slice(30010)];
    const start = performance.now();
    check(a, b);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe("comparing documents", () => {
  it("lists additions, removals and changes in order", () => {
    const before = words("The buyer pays 500 dollars within 30 days of delivery. Late fees apply.");
    const after = words("The buyer pays 750 dollars within 30 days of delivery. Late fees apply. Signed today.", 1);
    const result = compareWords(before, after);
    expect(result.changes.map((c) => [c.kind, c.before, c.after])).toEqual([
      ["changed", "500", "750"],
      ["added", "", "Signed today."],
    ]);
    expect(result.changes[1].afterPage).toBe(1);
    expect(result.unchanged).toBe(12);
    expect(changesReport(result, { before: "v1.pdf", after: "v2.pdf" })).toContain("Changed (page 1 → 2): 500 → 750");
  });

  it("ignores ligatures, curly quotes and dash styles", () => {
    expect(wordKey("ﬁle")).toBe(wordKey("file"));
    expect(wordKey("“quoted”")).toBe(wordKey('"quoted"'));
    expect(compareWords(words("don’t – ﬁne"), words("don't - fine")).changes).toEqual([]);
  });

  it("reads a page's words in reading order with their boxes", () => {
    const item = (text: string, x: number, y: number): TextItem => ({ text, x, y, width: text.length * 6, size: 12 });
    const page: TextPage = { width: 600, height: 800, items: [item("world", 100, 100), item("Hello", 40, 100), item("Next", 40, 130)] };
    const found = pageWords(page, 2);
    expect(found.map((w) => w.text)).toEqual(["Hello", "world", "Next"]);
    expect(found[0].page).toBe(2);
    expect(found[0].boxes[0].x).toBeCloseTo(39 / 600);
  });
});
