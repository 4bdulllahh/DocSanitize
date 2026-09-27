import fontkit from "@cantoo/fontkit";
import { degrees, PDFDict, PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { tinyPng } from "../../metadata/__tests__/fixtures";
import { liberationSans } from "../../office/__tests__/fixtures";
import { applyEdits } from "../edit/apply";
import { parseContent, removeTextInRegions } from "../edit/content";
import { selectText } from "../edit/text-select";
import { baselineOffset, type EditObject, type EditRequest, type ReplaceObject } from "../edit/types";

const fonts = liberationSans();
const enc = new TextEncoder();

async function withPdfjs<T>(bytes: Uint8Array, fn: (pages: PDFPageProxy[]) => Promise<T>): Promise<T> {
  const task = getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const pages: PDFPageProxy[] = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push(await doc.getPage(i));
    return await fn(pages);
  } finally {
    await task.destroy();
  }
}

type Item = { str: string; transform: number[]; width: number; height: number };
const textItems = async (page: PDFPageProxy): Promise<Item[]> =>
  (await page.getTextContent()).items.flatMap((i) => ("str" in i && i.str.trim() !== "" ? [i as Item] : []));
const allText = (bytes: Uint8Array) => withPdfjs(bytes, async (pages) => (await Promise.all(pages.map(textItems))).map((items) => items.map((i) => i.str)));

/** A replace object for a pdf.js text item, as the editor builds it. */
async function replaceFor(bytes: Uint8Array, pageIndex: number, str: string, text: string): Promise<ReplaceObject> {
  return withPdfjs(bytes, async (pages) => {
    const page = pages[pageIndex];
    const item = (await textItems(page)).find((i) => i.str === str)!;
    const viewport = page.getViewport({ scale: 1 });
    const [u, v] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return {
      id: "r1",
      kind: "replace",
      page: pageIndex,
      x: u,
      y: v - baselineOffset("sans", item.height),
      text,
      font: "sans",
      size: item.height,
      bold: false,
      italic: false,
      color: "#000000",
      cover: { x: u - 1, y: v - item.height, width: item.width + 2, height: item.height * 1.25 },
      background: "#ffffff",
      sources: [{ transform: item.transform, width: item.width, height: item.height, str: item.str }],
    };
  });
}

const edit = (bytes: Uint8Array, objects: EditObject[], extra: Partial<EditRequest> = {}) => applyEdits(bytes, { objects, images: {}, flatten: true, ...extra }, fonts);

describe("content stream parser", () => {
  it("reads operators with strings, escapes, hex, arrays, dicts, comments and inline images", () => {
    const content = enc.encode(
      "q 1 0 0 1 10 20 cm % a comment\nBT /F1 12 Tf (a\\(b\\)c\\101) Tj <48 69> Tj [(x) -250 (y)] TJ ET /P <</MCID 3>> BDC EMC BI /W 1 /H 1 /BPC 8 /CS /G ID ÿ EI Q",
    );
    const ops = parseContent(content);
    expect(ops.map((o) => o.op)).toEqual(["q", "cm", "BT", "Tf", "Tj", "Tj", "TJ", "ET", "BDC", "EMC", "BI", "Q"]);
    const bytesOf = (o: unknown) => new TextDecoder("latin1").decode((o as { bytes: Uint8Array }).bytes);
    expect(bytesOf(ops[4].operands[0])).toBe("a(b)cA");
    expect(bytesOf(ops[5].operands[0])).toBe("Hi");
    expect((ops[6].operands[0] as unknown[]).length).toBe(3);
    // Byte ranges cover operands and operator.
    expect(new TextDecoder().decode(content.subarray(ops[3].start, ops[3].end))).toBe("/F1 12 Tf");
  });

  it("keeps later text in place when a run is removed, including spacing and TJ kerning", () => {
    const widths = { glyphs: (b: Uint8Array) => Array.from(b, (c) => ({ width: 500, space: c === 32 })) };
    const content = enc.encode("BT /F1 10 Tf 2 Tc 3 Tw 100 700 Td (ab c) Tj [(de) -100 (f)] TJ (after) Tj ET");
    // Region around the first run only: starts at x = 100 on the baseline.
    const region = { transform: [10, 0, 0, 10, 100, 700], width: 30, height: 10 };
    const { bytes, removed } = removeTextInRegions(content, [region], () => widths);
    expect(removed).toEqual([1]);
    const text = new TextDecoder().decode(bytes);
    // "ab c": 4 glyphs × (5 + 2) + one space × 3 = 31 → -3100 thousandths of 10 pt.
    expect(text).toBe("BT /F1 10 Tf 2 Tc 3 Tw 100 700 Td [-3100] TJ [(de) -100 (f)] TJ (after) Tj ET");
  });

  it("leaves text in fonts it can't measure alone", () => {
    const { bytes, removed, unknownFonts } = removeTextInRegions(enc.encode("BT /F9 12 Tf 10 10 Td (x) Tj ET"), [{ transform: [12, 0, 0, 12, 10, 10], width: 6, height: 12 }], () => null);
    expect(removed).toEqual([0]);
    expect(unknownFonts).toBe(1);
    expect(new TextDecoder().decode(bytes)).toContain("(x) Tj");
  });
});

describe("edit text", () => {
  async function letter(embed: "standard" | "liberation") {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    const font = embed === "standard" ? await doc.embedFont(StandardFonts.Helvetica) : await doc.embedFont(fonts.regular, { subset: true });
    const page = doc.addPage([612, 792]);
    page.drawText("Dear customer,", { x: 72, y: 700, size: 12, font });
    page.drawText("Your balance is 1,200 USD.", { x: 72, y: 680, size: 12, font });
    page.drawText("Kind regards", { x: 72, y: 660, size: 12, font });
    return doc.save();
  }

  for (const kind of ["standard", "liberation"] as const) {
    it(`removes the original line from the file and writes the new one (${kind} font)`, async () => {
      const original = await letter(kind);
      const replace = await replaceFor(original, 0, "Your balance is 1,200 USD.", "Your balance is 0 USD.");
      const { bytes, warnings } = await edit(original, [replace]);
      expect(warnings).toEqual([]);
      const [page] = await allText(bytes);
      expect(page).toContain("Your balance is 0 USD.");
      expect(page).not.toContain("Your balance is 1,200 USD.");
      expect(page.join(" ")).not.toContain("1,200");
      expect(page).toEqual(expect.arrayContaining(["Dear customer,", "Kind regards"]));
      // The new text sits on the original baseline.
      const positions = await withPdfjs(bytes, async ([p]) => (await textItems(p)).map((i) => [i.str, Math.round(i.transform[5])]));
      expect(positions).toEqual(expect.arrayContaining([["Your balance is 0 USD.", 680], ["Dear customer,", 700], ["Kind regards", 660]]));
    });
  }

  it("warns when the text can't be reached (drawn inside a form XObject) and still covers it", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const donor = doc.addPage([612, 792]);
    donor.drawText("Inside a form", { x: 72, y: 700, size: 12, font });
    const embedded = await doc.embedPage(donor);
    const page = doc.addPage([612, 792]);
    page.drawPage(embedded);
    const original = await doc.save();
    const replace = await replaceFor(original, 1, "Inside a form", "Changed");
    const { bytes, warnings } = await edit(original, [replace]);
    expect(warnings.join()).toMatch(/still in the file/);
    expect((await allText(bytes))[1]).toContain("Changed");
  });
});

describe("drawing and annotations", () => {
  const every: EditObject[] = [
    { id: "t", kind: "text", page: 0, x: 72, y: 72, text: "Hello\nworld", font: "serif", size: 14, bold: true, italic: false, color: "#1d3a8a" },
    { id: "r", kind: "rect", page: 0, x: 72, y: 150, width: 100, height: 50, stroke: "#dc2626", fill: null, strokeWidth: 2, opacity: 1 },
    { id: "e", kind: "ellipse", page: 0, x: 200, y: 150, width: 80, height: 50, stroke: null, fill: "#16a34a", strokeWidth: 1, opacity: 0.5 },
    { id: "l", kind: "arrow", page: 0, x1: 72, y1: 250, x2: 250, y2: 260, color: "#000000", strokeWidth: 2, opacity: 1 },
    { id: "i", kind: "ink", page: 0, strokes: [[300, 300, 310, 310, 320, 300]], color: "#000000", strokeWidth: 2, opacity: 1, highlighter: false },
    { id: "h", kind: "highlight", page: 0, rects: [{ x: 72, y: 320, width: 120, height: 14 }], color: "#fde047", opacity: 1 },
    { id: "u", kind: "underline", page: 0, rects: [{ x: 72, y: 340, width: 120, height: 14 }], color: "#2563eb", opacity: 1 },
    { id: "s", kind: "strikeout", page: 0, rects: [{ x: 72, y: 360, width: 120, height: 14 }], color: "#dc2626", opacity: 1 },
    { id: "c", kind: "check", page: 0, x: 72, y: 400, size: 16, color: "#16a34a" },
    { id: "img", kind: "image", page: 0, x: 300, y: 400, width: 40, height: 40, image: "logo", opacity: 1 },
    { id: "n", kind: "note", page: 0, x: 500, y: 72, text: "Check this total", color: "#fde047" },
    { id: "w", kind: "whiteout", page: 0, x: 400, y: 500, width: 50, height: 20, color: "#ffffff" },
  ];
  const images = { logo: { bytes: tinyPng(), format: "png" as const } };

  async function blank(rotation = 0) {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]).setRotation(degrees(rotation));
    return doc.save();
  }

  it("keeps objects editable as annotations, with appearances and no author or dates", async () => {
    const { bytes } = await edit(await blank(), every, { images, flatten: false });
    const annotations = await withPdfjs(bytes, ([page]) => page.getAnnotations());
    expect(annotations.map((a) => a.subtype).sort()).toEqual(["Circle", "FreeText", "Highlight", "Ink", "Line", "Square", "Stamp", "Stamp", "StrikeOut", "Text", "Underline"].sort());
    expect(annotations.find((a) => a.subtype === "Text")?.contentsObj?.str).toBe("Check this total");
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.Annots()!.asArray().map((ref) => doc.context.lookup(ref) as PDFDict);
    for (const annot of annots) {
      for (const key of ["T", "M", "CreationDate"]) expect(annot.has(PDFName.of(key)), key).toBe(false);
      expect(annot.has(PDFName.of("AP"))).toBe(true);
    }
    // The white-out is drawn into the page, not added as an annotation.
    expect(annots).toHaveLength(every.length - 1);
  });

  it("flattens everything except notes into the page", async () => {
    const { bytes } = await edit(await blank(), every, { images, flatten: true });
    const [annotations, text] = await withPdfjs(bytes, async ([page]) => [await page.getAnnotations(), await textItems(page)] as const);
    expect(annotations.map((a) => a.subtype)).toEqual(["Text"]);
    expect(text.map((t) => t.str)).toEqual(["Hello", "world"]);
  });

  it("places text upright where it was put on a rotated page", async () => {
    for (const rotation of [90, 180, 270]) {
      const { bytes } = await edit(await blank(rotation), [every[0]]);
      const placed = await withPdfjs(bytes, async ([page]) => {
        const viewport = page.getViewport({ scale: 1 });
        const [item] = await textItems(page);
        const [u, v] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        // Reading direction as displayed: the text's x axis mapped through the viewport.
        const [u2, v2] = viewport.convertToViewportPoint(item.transform[4] + item.transform[0], item.transform[5] + item.transform[1]);
        return { u, v, dir: [Math.round(u2 - u), Math.round(v2 - v)] };
      });
      expect(placed.u, `rotation ${rotation}`).toBeCloseTo(72, 0);
      // First baseline: 72 + (1.2 - 0.891 - 0.216) / 2 × 14 + 0.891 × 14.
      expect(placed.v, `rotation ${rotation}`).toBeCloseTo(72 + ((1.2 - 0.891 - 0.216) / 2 + 0.891) * 14, 0);
      expect(placed.dir[0], `rotation ${rotation}`).toBeGreaterThan(0);
      expect(placed.dir[1], `rotation ${rotation}`).toBe(0);
    }
  });

  it("rejects an empty edit and objects on missing pages", async () => {
    await expect(edit(await blank(), [])).rejects.toThrow(/Make a change/);
    await expect(edit(await blank(), [{ ...every[1], page: 3 }])).rejects.toThrow(/doesn't exist/);
  });
});

describe("text selection for highlights", () => {
  // Two lines; "Hello world" as two runs, then "Second line".
  const runs = [
    { str: "Hello ", x: 100, y: 100, width: 60, height: 12 },
    { str: "world", x: 160, y: 101, width: 50, height: 12 },
    { str: "Second line", x: 100, y: 120, width: 110, height: 12 },
  ];

  it("selects within a line, snapped to character edges", () => {
    expect(selectText(runs, { x: 118, y: 105 }, { x: 171, y: 106 })).toEqual([{ x: 120, y: 100, width: 50, height: 13 }]);
  });

  it("selects across lines in reading order, whichever way you drag", () => {
    const forward = selectText(runs, { x: 170, y: 105 }, { x: 140, y: 125 });
    expect(forward).toEqual([
      { x: 170, y: 100, width: 40, height: 13 },
      { x: 100, y: 120, width: 40, height: 12 },
    ]);
    expect(selectText(runs, { x: 140, y: 125 }, { x: 170, y: 105 })).toEqual(forward);
  });

  it("selects nothing on a page without text", () => {
    expect(selectText([], { x: 0, y: 0 }, { x: 50, y: 50 })).toEqual([]);
  });
});
