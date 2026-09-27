import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { getDocument, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { sizedJpeg, TINY_JPEG, tinyPng } from "../../metadata/__tests__/fixtures";
import { liberationSans } from "../../office/__tests__/fixtures";
import { applyEdits } from "../edit/apply";
import { flattenPdf } from "../flatten";
import { fillForm, readForm } from "../forms";
import { grayscalePdf, unpredict } from "../grayscale";
import { readBookmarks, readInfo, writeBookmarks, writeInfo } from "../info";
import { addBatesNumbers, addHeaderFooter } from "../markup";
import { cropPages, deletePages, insertPages, resizePages, rotatePages } from "../pages";

const fonts = liberationSans();

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

/** Text items with their displayed position. */
const displayed = (bytes: Uint8Array) =>
  withPdfjs(bytes, (pages) =>
    Promise.all(
      pages.map(async (page) => {
        const viewport = page.getViewport({ scale: 1 });
        const items = (await page.getTextContent()).items.flatMap((i) => ("str" in i && i.str.trim() ? [i] : []));
        return {
          size: [Math.round(viewport.width), Math.round(viewport.height)],
          text: items.map((i) => {
            const [u, v] = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
            return { str: i.str, u: Math.round(u), v: Math.round(v) };
          }),
        };
      }),
    ),
  );

/** Pages labelled "Page 1".."Page n" at (72, 72 from the top) on Letter paper. */
async function pdf(n: number, setup?: (doc: PDFDocument) => void | Promise<void>): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 72, y: 720, size: 12, font });
  await setup?.(doc);
  return doc.save();
}
const labels = async (bytes: Uint8Array) => (await displayed(bytes)).map((p) => p.text.map((t) => t.str).join(" | "));

describe("rotate, delete, insert", () => {
  it("rotates only the chosen pages, adding to their rotation", async () => {
    const out = await rotatePages(await pdf(3, (d) => void d.getPage(2).setRotation(degrees(90))), [0, 2], 90);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 180]);
  });

  it("deletes pages and refuses to delete them all", async () => {
    expect(await labels(await deletePages(await pdf(4), [1, 3]))).toEqual(["Page 1", "Page 3"]);
    await expect(deletePages(await pdf(2), [0, 1])).rejects.toThrow(/Keep at least one/);
  });

  it("inserts blank pages sized like their neighbour, or a named size", async () => {
    const landscape = await pdf(2, (d) => void d.getPage(1).setRotation(degrees(90)));
    const out = await insertPages(landscape, { at: 2, blank: { count: 2, size: "match" } });
    expect((await displayed(out)).map((p) => p.size)).toEqual([[612, 792], [792, 612], [792, 612], [792, 612]]);
    const a4 = await insertPages(await pdf(1), { at: 0, blank: { count: 1, size: "a4" } });
    expect((await displayed(a4))[0].size).toEqual([595, 842]);
  });

  it("inserts pages from another PDF at a position, without dragging in pages they link to", async () => {
    const other = await pdf(3, (d) => {
      const [first, , third] = d.getPages();
      const link = d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [third.ref, PDFName.of("Fit")] }));
      first.node.set(PDFName.of("Annots"), d.context.obj([link]));
    });
    const out = await insertPages(await pdf(2), { at: 1, source: { bytes: other, pages: [0] } });
    expect(await labels(out)).toEqual(["Page 1", "Page 1", "Page 2"]);
    const doc = await PDFDocument.load(out);
    const inTree = new Set(doc.getPages().map((p) => p.ref.toString()));
    const stray = doc.context.enumerateIndirectObjects().filter(([ref, o]) => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Page") && !inTree.has(ref.toString()));
    expect(stray.every(([, o]) => (o as PDFDict).keys().length === 1)).toBe(true);
  });
});

describe("crop and resize", () => {
  it("crops to the box drawn on the displayed page, rotated or not", async () => {
    const src = await pdf(2, (d) => void d.getPage(1).setRotation(degrees(90)));
    const box = { x: 50, y: 30, width: 300, height: 200 };
    const out = await cropPages(src, [
      { page: 0, box },
      { page: 1, box },
    ]);
    const pages = await displayed(out);
    expect(pages.map((p) => p.size)).toEqual([[300, 200], [300, 200]]);
    // "Page 1" was at (72, 72) on the full page; now 50 and 30 points further up-left.
    expect(pages[0].text[0]).toMatchObject({ u: 22, v: 42 });
    await expect(cropPages(src, [{ page: 0, box: { x: 0, y: 0, width: 5, height: 5 } }])).rejects.toThrow(/too small/);
  });

  it("resizes Letter to A4, scaling the content to fit and moving annotations with it", async () => {
    const src = await pdf(1, (d) => {
      const annot = d.context.register(d.context.obj({ Type: "Annot", Subtype: "Square", Rect: [100, 100, 200, 200] }));
      d.getPage(0).node.set(PDFName.of("Annots"), d.context.obj([annot]));
    });
    const out = await resizePages(src, { size: "a4", orientation: "auto" });
    const [page] = await displayed(out);
    expect(page.size).toEqual([595, 842]);
    // Scale 595.28 / 612, centred vertically: (842 - 792 × s) / 2 ≈ 36.
    const s = 595.28 / 612;
    expect(page.text[0].u).toBe(Math.round(72 * s));
    expect(page.text[0].v).toBe(Math.round((841.89 - 792 * s) / 2 + 72 * s));
    const doc = await PDFDocument.load(out);
    const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0)) as PDFDict;
    const rect = (annot.lookup(PDFName.of("Rect")) as PDFArray).asArray().map((n) => +n.toString());
    expect(rect[0]).toBeCloseTo(100 * s, 1);
    expect(rect[2] - rect[0]).toBeCloseTo(100 * s, 1);
  });
});

describe("header, footer and Bates numbers", () => {
  it("fills {page}, {pages}, {date} and {file} in each position, on the chosen pages", async () => {
    const out = await addHeaderFooter(await pdf(3), { slots: { "top-right": "{file}", "bottom-center": "Page {page} of {pages}", "bottom-left": "{date}" }, size: 9, color: "#333333", margin: 24, start: 1, pages: [1, 2], date: "28 Sep 2026", file: "report.pdf" }, fonts);
    const pages = await displayed(out);
    expect(pages[0].text.map((t) => t.str)).toEqual(["Page 1"]);
    expect(pages[1].text.map((t) => t.str).sort()).toEqual(["28 Sep 2026", "Page 2", "Page 2 of 3", "report.pdf"].sort());
    const footer = pages[2].text.find((t) => t.str === "Page 3 of 3")!;
    expect(footer.v).toBeGreaterThan(740);
  });

  it("numbers several files in one sequence", async () => {
    const [a, b] = await addBatesNumbers([await pdf(2), await pdf(3)], { prefix: "ACME-", suffix: "", start: 7, digits: 6, position: "bottom-right", margin: 24, size: 9, color: "#000000" }, fonts);
    expect([a.first, a.last, b.first, b.last]).toEqual(["ACME-000007", "ACME-000008", "ACME-000009", "ACME-000011"]);
    expect((await labels(b.bytes))[2]).toContain("ACME-000011");
  });
});

describe("flatten", () => {
  it("draws form fields and annotations into the page and removes them, keeping links", async () => {
    const src = await pdf(1, (d) => {
      const field = d.getForm().createTextField("name");
      field.addToPage(d.getPage(0), { x: 72, y: 600, width: 200, height: 20 });
      field.setText("Jane Doe");
      const link = d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 20, 20] }));
      d.getPage(0).node.Annots()!.push(link);
    });
    const annotated = (await applyEdits(src, { objects: [{ id: "r", kind: "rect", page: 0, x: 72, y: 300, width: 100, height: 50, stroke: "#ff0000", fill: null, strokeWidth: 2, opacity: 1 }], images: {}, flatten: false }, fonts)).bytes;
    const { bytes, fields, annotations } = await flattenPdf(annotated, { forms: true, annotations: true });
    expect([fields, annotations]).toEqual([1, 1]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    const subtypes = await withPdfjs(bytes, async ([page]) => (await page.getAnnotations()).map((a) => a.subtype));
    expect(subtypes).toEqual(["Link"]);
    expect((await labels(bytes))[0]).toContain("Jane Doe");
  });
});

describe("document properties and bookmarks", () => {
  it("writes exactly the properties given, removes XMP, and reads them back", async () => {
    const src = await pdf(1, (d) => {
      d.setTitle("Old title");
      d.setAuthor("Old Author");
      d.catalog.set(PDFName.of("Metadata"), d.context.register(d.context.stream("<x:xmpmeta/>", { Type: "Metadata", Subtype: "XML" })));
    });
    expect((await readInfo(src)).hasXmp).toBe(true);
    const out = await writeInfo(src, { fields: { Title: "Annual report", Author: "", Subject: "Finance", Keywords: "", Creator: "", Producer: "" }, created: "2026-01-02T03:04:05.000Z", modified: "" });
    const info = await readInfo(out);
    expect(info.fields).toMatchObject({ Title: "Annual report", Author: "", Subject: "Finance", Producer: "" });
    expect(info.created).toBe("2026-01-02T03:04:05.000Z");
    expect(info.hasXmp).toBe(false);
    expect(Buffer.from(out).toString("latin1")).not.toContain("Old Author");
  });

  it("writes nested bookmarks that readers see, replacing the old ones", async () => {
    const out = await writeBookmarks(await pdf(4), [
      { title: "Intro", page: 0, level: 0 },
      { title: "Part A", page: 1, level: 0 },
      { title: "A.1", page: 2, level: 1 },
      { title: "A.1.a", page: 3, level: 2 },
      { title: "Ünïcode", page: 3, level: 0 },
    ]);
    expect(await readBookmarks(out)).toEqual([
      { title: "Intro", page: 0, level: 0 },
      { title: "Part A", page: 1, level: 0 },
      { title: "A.1", page: 2, level: 1 },
      { title: "A.1.a", page: 3, level: 2 },
      { title: "Ünïcode", page: 3, level: 0 },
    ]);
    const task = getDocument({ data: out.slice() });
    const outline = (await (await task.promise).getOutline()).map((o) => [o.title, o.items.length]);
    await task.destroy();
    expect(outline).toEqual([["Intro", 0], ["Part A", 1], ["Ünïcode", 0]]);
    expect(await readBookmarks(await writeBookmarks(out, []))).toEqual([]);
    await expect(writeBookmarks(out, [{ title: "x", page: 0, level: 1 }])).rejects.toThrow(/indented/);
  });
});

describe("fill forms", () => {
  async function formPdf() {
    return pdf(2, (d) => {
      const form = d.getForm();
      const [p1, p2] = d.getPages();
      p2.setRotation(degrees(90));
      form.createTextField("name").addToPage(p1, { x: 72, y: 600, width: 200, height: 20 });
      form.createCheckBox("agree").addToPage(p1, { x: 72, y: 560, width: 14, height: 14 });
      const radio = form.createRadioGroup("plan");
      radio.addOptionToPage("basic", p1, { x: 72, y: 520, width: 14, height: 14 });
      radio.addOptionToPage("pro", p1, { x: 120, y: 520, width: 14, height: 14 });
      const dropdown = form.createDropdown("country");
      dropdown.addOptions(["Oman", "Pakistan", "UAE"]);
      dropdown.addToPage(p2, { x: 100, y: 100, width: 120, height: 20 });
      const list = form.createOptionList("topics");
      list.addOptions(["Tax", "Travel", "Visa"]);
      list.enableMultiselect();
      list.addToPage(p1, { x: 300, y: 500, width: 100, height: 60 });
    });
  }

  it("lists fields with where their widgets are shown", async () => {
    const { fields, xfa } = await readForm(await formPdf());
    expect(xfa).toBe(false);
    expect(fields.map((f) => [f.name, f.kind])).toEqual([["name", "text"], ["agree", "checkbox"], ["plan", "radio"], ["country", "dropdown"], ["topics", "list"]]);
    // pdf-lib grows each widget by half its 1 pt border.
    expect(fields[0].widgets).toEqual([{ page: 0, box: { x: 71.5, y: 171.5, width: 201, height: 21 } }]);
    expect(fields[2].widgets.map((w) => w.option)).toEqual(["basic", "pro"]);
    // On the page rotated 90°, a user-space rect (99.5, 99.5, 121 × 21) shows as 21 × 121 at (99.5, 99.5).
    expect(fields[3].widgets[0]).toEqual({ page: 1, box: { x: 99.5, y: 99.5, width: 21, height: 121 } });
    expect(fields[3].options).toEqual(["Oman", "Pakistan", "UAE"]);
  });

  it("fills every kind of field and can flatten the result", async () => {
    const values = { name: "Aïsha Ωmega", agree: true, plan: "pro", country: "UAE", topics: ["Tax", "Visa"] };
    const filled = await fillForm(await formPdf(), values, { flatten: false }, fonts);
    const { fields } = await readForm(filled);
    expect(Object.fromEntries(fields.map((f) => [f.name, f.value]))).toEqual(values);
    const flat = await fillForm(await formPdf(), values, { flatten: true }, fonts);
    expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(0);
    expect((await labels(flat))[0]).toContain("Aïsha Ωmega");
  });

  it("explains a PDF without fields", async () => {
    await expect(fillForm(await pdf(1), {}, { flatten: false }, fonts)).rejects.toThrow(/no fillable fields/);
  });
});

describe("grayscale", () => {
  it("rewrites colours and converts images; a JPEG it can't re-encode gets the blend layer", async () => {
    const src = await pdf(2, async (d) => {
      const font = await d.embedFont(StandardFonts.Helvetica);
      d.getPage(0).drawText("Red text", { x: 72, y: 600, size: 20, font, color: rgb(1, 0, 0) });
      d.getPage(0).drawRectangle({ x: 72, y: 400, width: 100, height: 50, color: rgb(0, 0.5, 1), borderColor: rgb(0.2, 0.8, 0.2), borderWidth: 3 });
      const png = await d.embedPng(tinyPng());
      d.getPage(0).drawImage(png, { x: 300, y: 300, width: 50, height: 50 });
      const jpeg = await d.embedJpg(sizedJpeg(4, 4, { components: 3 })); // a colour JPEG
      d.getPage(1).drawImage(jpeg, { x: 72, y: 300, width: 50, height: 50 });
    });
    const { bytes, images, overlaid } = await grayscalePdf(src);
    expect(images).toBe(1); // the PNG; the JPEG needs the browser's re-encoder
    expect(overlaid).toBe(1);
    const doc = await PDFDocument.load(bytes);
    const content = (i: number) =>
      (doc.getPage(i).node.Contents() as PDFArray)
        .asArray()
        .map((r) => new TextDecoder().decode(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()))
        .join("\n");
    expect(content(0)).not.toMatch(/\brg\b|\bRG\b/);
    expect(content(0)).not.toContain("Saturation");
    expect(content(1)).toMatch(/gs 0 g/);
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject")) as PDFDict;
    const image = doc.context.lookup(xobjects.values()[0] as PDFRef) as PDFRawStream;
    expect(image.dict.lookup(PDFName.of("ColorSpace"))).toBe(PDFName.of("DeviceGray"));

    // With a JPEG re-encoder (the browser's canvas in the app), nothing needs the blend layer.
    const withJpeg = await grayscalePdf(src, async () => TINY_JPEG);
    expect([withJpeg.images, withJpeg.overlaid]).toEqual([2, 0]);
  });

  it("undoes PNG predictors", () => {
    // Two rows of 2 RGB pixels: row 1 with Sub (1), row 2 with Up (2).
    const data = Uint8Array.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1]);
    expect(Array.from(unpredict(data, 2, 3)!)).toEqual([10, 20, 30, 15, 25, 35, 11, 21, 31, 16, 26, 36]);
  });
});
