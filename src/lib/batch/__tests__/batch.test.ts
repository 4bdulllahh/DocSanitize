import { describe, expect, it } from "vitest";
import type { FileKind } from "../../files";
import { BATCH_PRESETS } from "../presets";
import { parseRecipe, recipeToJson } from "../recipe";
import { runBatch, uniqueNames, type BatchItem, type Operations } from "../run";
import { checkSteps, defaultStep, describeStep, pagesToDelete, planFiles, STEP_INFO, type BatchStep, type StepType } from "../steps";

const ALL_TYPES = Object.keys(STEP_INFO) as StepType[];
const item = (name: string, kind: FileKind, text = name): BatchItem => ({ name, kind, blob: new Blob([text]) });
const textOf = (i: BatchItem) => i.blob.text();

describe("page lists for Delete pages", () => {
  it("reads pages, ranges and pages counted from the end", () => {
    expect(pagesToDelete("1", 5)).toEqual([0]);
    expect(pagesToDelete("1-2, 4", 5)).toEqual([0, 1, 3]);
    expect(pagesToDelete("3-", 5)).toEqual([2, 3, 4]);
    expect(pagesToDelete("-1", 5)).toEqual([4]);
    expect(pagesToDelete("last 2", 5)).toEqual([3, 4]);
    expect(pagesToDelete("last", 5)).toEqual([4]);
  });

  it("ignores pages a shorter file doesn't have", () => {
    expect(pagesToDelete("2, 9", 3)).toEqual([1]);
    expect(pagesToDelete("5-8", 3)).toEqual([]);
    expect(pagesToDelete("-4", 2)).toEqual([0, 1]);
  });

  it("rejects what isn't a page list", () => {
    expect(() => pagesToDelete("abc", 3)).toThrow(/isn't a page number/);
    expect(() => pagesToDelete("3-1", 3)).toThrow();
    expect(() => pagesToDelete("0", 3)).toThrow();
  });
});

describe("checking the steps", () => {
  const ok = { hasCertificate: true };

  it("accepts the defaults of every step except the ones that need input", () => {
    const needInput = new Set<StepType>(["protect"]);
    for (const type of ALL_TYPES) {
      const problems = checkSteps([defaultStep(type)], ok);
      expect(problems.length > 0, type).toBe(needInput.has(type));
    }
  });

  it("explains settings that can't work", () => {
    const steps: BatchStep[] = [
      { ...defaultStep("watermark"), text: " " },
      { ...defaultStep("page-numbers"), format: "Page" },
      { ...defaultStep("delete-pages"), pages: "x" },
      { ...defaultStep("bates"), digits: 20 },
      { ...defaultStep("ocr"), languages: [] },
      { ...defaultStep("convert-image"), maxSide: 4 },
    ];
    expect(checkSteps(steps, ok).map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(checkSteps([defaultStep("sign")], { hasCertificate: false })[0].message).toMatch(/certificate/);
  });

  it("refuses PDF changes after protecting or signing", () => {
    const protect = { ...defaultStep("protect"), password: "secret" };
    const afterProtect = checkSteps([protect, defaultStep("watermark")], ok);
    expect(afterProtect).toEqual([{ index: 1, message: expect.stringMatching(/before Password-protect/) }]);
    expect(checkSteps([defaultStep("sign"), protect], ok)[0]).toMatchObject({ index: 1, message: expect.stringMatching(/breaks the signature/) });
    // Steps for other kinds of files may still follow.
    expect(checkSteps([protect, defaultStep("convert-image"), defaultStep("clean-media")], ok)).toEqual([]);
  });

  it("allows Bates numbers and Combine only once", () => {
    expect(checkSteps([defaultStep("merge"), defaultStep("merge")], ok)).toEqual([{ index: 1, message: expect.stringMatching(/only be used once/) }]);
  });

  it("describes every step", () => {
    for (const type of ALL_TYPES) expect(describeStep(defaultStep(type)).length, type).toBeGreaterThan(0);
  });

  it("offers presets that pass the checks", () => {
    for (const preset of BATCH_PRESETS) expect(checkSteps(preset.steps({ ocrLanguage: "deu" }), ok), preset.id).toEqual([]);
  });
});

describe("planning", () => {
  it("follows each file's kind through the steps", () => {
    const steps = [defaultStep("sanitize"), defaultStep("to-pdf"), defaultStep("watermark"), defaultStep("convert-audio")];
    const [photo, doc, report, song, other] = planFiles(["image", "word", "pdf", "video", "unknown"], steps);
    expect(photo).toEqual({ steps: [0, 1, 2], kind: "pdf", mergedAt: null });
    expect(doc).toEqual({ steps: [1, 2], kind: "pdf", mergedAt: null });
    expect(report).toEqual({ steps: [0, 2], kind: "pdf", mergedAt: null });
    expect(song).toEqual({ steps: [3], kind: "audio", mergedAt: null });
    expect(other).toEqual({ steps: [], kind: "unknown", mergedAt: null });
  });

  it("notes where files are combined", () => {
    const plans = planFiles(["pdf", "image"], [defaultStep("merge"), defaultStep("to-pdf")]);
    expect(plans[0].mergedAt).toBe(0);
    expect(plans[1].mergedAt).toBeNull();
  });
});

describe("saved lists of steps", () => {
  it("round-trips the settings, without passwords", () => {
    const steps: BatchStep[] = [{ ...defaultStep("watermark"), text: "DRAFT", opacity: 0.4 }, { ...defaultStep("protect"), password: "hunter2", allowCopying: true }, { ...defaultStep("ocr"), languages: ["deu", "eng"] }];
    const json = recipeToJson(steps);
    expect(json).not.toContain("hunter2");
    const read = parseRecipe(json);
    expect(read[0]).toEqual(steps[0]);
    expect(read[1]).toEqual({ ...steps[1], password: "" });
    expect(read[2]).toEqual(steps[2]);
  });

  it("drops unknown or wrong settings and fills in missing ones", () => {
    const json = JSON.stringify({
      format: "docsanitize-batch",
      version: 1,
      steps: [
        { type: "compress", preset: "extreme", extra: 1 },
        { type: "rotate", angle: 45 },
        { type: "watermark", text: 7, size: 30 },
        { type: "convert-image", maxSide: 800 },
      ],
    });
    expect(parseRecipe(json)).toEqual([defaultStep("compress"), defaultStep("rotate"), { ...defaultStep("watermark"), size: 30 }, { ...defaultStep("convert-image"), maxSide: 800 }]);
  });

  it("rejects other files", () => {
    expect(() => parseRecipe("not json")).toThrow(/isn't a saved list/);
    expect(() => parseRecipe(JSON.stringify({ steps: [] }))).toThrow(/isn't a saved list/);
    expect(() => parseRecipe(JSON.stringify({ format: "docsanitize-batch", version: 9, steps: [] }))).toThrow(/newer version/);
    expect(() => parseRecipe(JSON.stringify({ format: "docsanitize-batch", version: 1, steps: [{ type: "teleport" }] }))).toThrow(/doesn't know/);
    expect(() => parseRecipe(JSON.stringify({ format: "docsanitize-batch", version: 1, steps: [] }))).toThrow(/no steps/);
  });
});

/** Fake steps that record what they did, so the order can be checked. */
function fakeOperations(log: string[], failOn?: (step: BatchStep, item: BatchItem) => boolean): Operations {
  return {
    one: async (step, i) => {
      log.push(`${step.type}:${i.name}`);
      if (failOn?.(step, i)) throw new Error(`${i.name} is broken`);
      const kind = STEP_INFO[step.type].produces ?? i.kind;
      const name = kind === "pdf" && i.kind !== "pdf" ? i.name.replace(/\.[^.]+$/, ".pdf") : i.name;
      return { name, kind, blob: new Blob([`${await textOf(i)}+${step.type}`]) };
    },
    all: async (step, items) => {
      log.push(`${step.type}:${items.map((i) => i.name).join(",")}`);
      if (step.type === "merge") return [{ name: "combined.pdf", kind: "pdf", blob: new Blob([(await Promise.all(items.map(textOf))).join("|")]) }];
      return Promise.all(items.map(async (i) => ({ ...i, blob: new Blob([`${await textOf(i)}+${step.type}`]) })));
    },
  };
}

const run = (files: BatchItem[], steps: BatchStep[], ops: Operations, signal = new AbortController().signal) => runBatch(files, steps, ops, { signal });

describe("running a batch", () => {
  it("runs step by step, skipping files a step can't open", async () => {
    const log: string[] = [];
    const files = [item("a.pdf", "pdf"), item("b.jpg", "image"), item("c.mp3", "audio")];
    const result = await run(files, [defaultStep("sanitize"), defaultStep("watermark")], fakeOperations(log));
    expect(log).toEqual(["sanitize:a.pdf", "sanitize:b.jpg", "watermark:a.pdf"]);
    expect(await Promise.all(result.outputs.map(textOf))).toEqual(["a.pdf+sanitize+watermark", "b.jpg+sanitize"]);
    expect(result.untouched).toEqual(["c.mp3"]);
    expect(result.failures).toEqual([]);
  });

  it("hands converted files to the later steps", async () => {
    const log: string[] = [];
    const result = await run([item("photo.jpg", "image"), item("notes.docx", "word")], [defaultStep("to-pdf"), defaultStep("page-numbers")], fakeOperations(log));
    expect(log).toEqual(["to-pdf:photo.jpg", "to-pdf:notes.docx", "page-numbers:photo.pdf", "page-numbers:notes.pdf"]);
    expect(result.outputs.map((o) => [o.name, o.kind])).toEqual([
      ["photo.pdf", "pdf"],
      ["notes.pdf", "pdf"],
    ]);
  });

  it("works on the files together for Bates numbers and Combine, in tab order", async () => {
    const log: string[] = [];
    const files = [item("x.jpg", "image"), item("1.pdf", "pdf"), item("2.pdf", "pdf")];
    const result = await run(files, [defaultStep("bates"), defaultStep("merge"), defaultStep("compress")], fakeOperations(log));
    expect(log).toEqual(["bates:1.pdf,2.pdf", "merge:1.pdf,2.pdf", "compress:combined.pdf"]);
    expect(result.outputs.map((o) => o.name)).toEqual(["combined.pdf"]);
    expect(await textOf(result.outputs[0])).toBe("1.pdf+bates|2.pdf+bates+compress");
    expect(result.untouched).toEqual(["x.jpg"]);
  });

  it("drops a file that fails and carries on with the others", async () => {
    const log: string[] = [];
    const files = [item("good.pdf", "pdf"), item("bad.pdf", "pdf"), item("also.pdf", "pdf")];
    const result = await run(files, [defaultStep("grayscale"), defaultStep("compress")], fakeOperations(log, (s, i) => s.type === "grayscale" && i.name === "bad.pdf"));
    expect(log).toEqual(["grayscale:good.pdf", "grayscale:bad.pdf", "grayscale:also.pdf", "compress:good.pdf", "compress:also.pdf"]);
    expect(result.failures).toEqual([{ name: "bad.pdf", step: "Grayscale", message: "bad.pdf is broken" }]);
    expect(result.outputs.map((o) => o.name)).toEqual(["good.pdf", "also.pdf"]);
  });

  it("reports progress across the whole run", async () => {
    const seen: number[] = [];
    await runBatch([item("a.pdf", "pdf"), item("b.pdf", "pdf")], [defaultStep("grayscale"), defaultStep("compress")], fakeOperations([]), {
      signal: new AbortController().signal,
      onProgress: (p) => seen.push(p.fraction),
    });
    expect(seen).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    const log: string[] = [];
    const ops = fakeOperations(log);
    const stopping: Operations = { ...ops, one: async (step, i, c) => (controller.abort(), ops.one(step, i, c)) };
    await expect(run([item("a.pdf", "pdf"), item("b.pdf", "pdf")], [defaultStep("grayscale")], stopping, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(log).toEqual(["grayscale:a.pdf"]);
  });

  it("gives files with the same name distinct names", () => {
    expect(uniqueNames([{ name: "a.pdf" }, { name: "A.pdf" }, { name: "a.pdf" }, { name: "b" }, { name: "b" }]).map((i) => i.name)).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "b", "b (2)"]);
  });
});
