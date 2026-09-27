import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { TINY_JPEG } from "../../metadata/__tests__/fixtures";
import type { TextItem } from "../../office/text-layout";
import { applyRedactions } from "../redact";
import { findAnnotationBoxes, findTextBoxes } from "../redact-search";

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("Jane Doe");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 300]);
  first.setRotation(degrees(90));
  first.drawText("Name: Jane Doe", { x: 20, y: 250, size: 14, font });
  first.drawText("Email: jane@example.org", { x: 20, y: 220, size: 14, font });
  const second = doc.addPage([400, 300]);
  second.drawText("Public page", { x: 20, y: 250, size: 14, font });
  const form = doc.getForm();
  const name = form.createTextField("name");
  name.setText("Jane Doe");
  name.addToPage(first, { x: 20, y: 100, width: 150, height: 20 });
  const city = form.createTextField("city");
  city.setText("Dubai");
  city.addToPage(second, { x: 20, y: 100, width: 150, height: 20 });
  // A tagged-PDF structure element repeating the text.
  doc.catalog.set(PDFName.of("StructTreeRoot"), doc.context.register(doc.context.obj({ Type: "StructTreeRoot", K: { S: "P", ActualText: "Jane Doe" } })));
  return doc.save({ useObjectStreams: false });
}

/**
 * All text a determined reader could get at: every string object (decoded), every stream (decoded),
 * and hex-encoded text operands inside content streams. `skip` leaves out one object, e.g. Info.
 */
async function everything(bytes: Uint8Array, skip?: PDFRef): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  const walk = (obj: PDFObject | undefined): void => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) parts.push(obj.decodeText());
    else if (obj instanceof PDFArray) obj.asArray().forEach(walk);
    else if (obj instanceof PDFDict) for (const [, value] of obj.entries()) walk(value);
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (ref === skip) continue;
    walk(obj instanceof PDFRawStream ? obj.dict : obj);
    if (!(obj instanceof PDFRawStream)) continue;
    try {
      const content = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
      parts.push(content, ...[...content.matchAll(/<([0-9a-f]+)>/gi)].map((m) => Buffer.from(m[1], "hex").toString("latin1")));
    } catch {
      // Image data we can't decode here can't hold text either.
    }
  }
  return parts.join("\n");
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(""));
  await task.destroy();
  return texts;
}

describe("apply redactions", () => {
  it("flattens the page to an image and purges its text, fonts, fields and tags", async () => {
    const out = await applyRedactions(await sourcePdf(), [{ index: 0, image: TINY_JPEG, width: 300, height: 400 }], { removeMetadata: false });
    expect(await pageTexts(out)).toEqual(["", "Public page"]);

    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getForm().getFields().map((f) => f.getName())).toEqual(["city"]);
    expect(doc.catalog.has(PDFName.of("StructTreeRoot"))).toBe(false);
    expect(doc.getAuthor()).toBe("Jane Doe"); // metadata only goes when asked

    // Apart from the document info (kept on purpose), the name and email are gone from the whole file.
    const contents = await everything(out, doc.context.trailerInfo.Info as PDFRef);
    expect(contents).not.toContain("Jane Doe");
    expect(contents).not.toContain("jane@example.org");
    expect(contents).toContain("Dubai"); // the other page's form field is untouched
  });

  it("can remove metadata in the same pass", async () => {
    const out = await applyRedactions(await sourcePdf(), [{ index: 0, image: TINY_JPEG, width: 300, height: 400 }], { removeMetadata: true });
    expect(await everything(out)).not.toContain("Jane Doe");
  });

  it("needs at least one page", async () => {
    await expect(applyRedactions(await sourcePdf(), [], { removeMetadata: false })).rejects.toThrow(/at least one area/);
  });
});

describe("text search", () => {
  const item = (text: string, x: number, y = 100, size = 10): TextItem => ({ text, x, y, width: text.length * 5, size });
  const page = { width: 200, height: 400, items: [item("Contact:", 10), item("Jane", 55), item("Doe", 80), item("or", 10, 130), item("JANE DOE", 25, 130)] };

  it("finds every occurrence, case-insensitively, across items", () => {
    const boxes = findTextBoxes(page, "jane  doe");
    expect(boxes).toHaveLength(3);
    // "Jane" at x 55..75 -> (55-1)/200; top = baseline 100 - 9 - 1 = 90 -> 90/400.
    expect(boxes[0].x).toBeCloseTo(54 / 200);
    expect(boxes[0].y).toBeCloseTo(90 / 400);
    expect(boxes[0].width).toBeCloseTo(22 / 200);
    expect(boxes[2].width).toBeCloseTo(42 / 200);
  });

  it("covers only the matching part of an item", () => {
    const [box] = findTextBoxes({ width: 200, height: 400, items: [item("Email: jane@example.org", 0)] }, "jane@example.org");
    expect(box.x).toBeCloseTo((7 * 5 - 1) / 200);
    expect(box.width).toBeCloseTo((16 * 5 + 2) / 200);
  });

  it("boxes whole annotations (form values, comments) that show the text", () => {
    const annotations = [
      { text: "Jane   Doe", rect: [20, 300, 170, 324] as [number, number, number, number] },
      { text: "Approved", rect: [20, 200, 100, 220] as [number, number, number, number] },
    ];
    expect(findAnnotationBoxes(annotations, "jane doe", 200, 400)).toEqual([{ x: 19 / 200, y: 299 / 400, width: 152 / 200, height: 26 / 400 }]);
    expect(findAnnotationBoxes(annotations, "", 200, 400)).toEqual([]);
  });

  it("returns nothing for blank or absent text", () => {
    expect(findTextBoxes(page, "  ")).toEqual([]);
    expect(findTextBoxes(page, "Smith")).toEqual([]);
  });
});
