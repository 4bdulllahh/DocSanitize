import { decodePDFRawStream, degrees, PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument, OPS, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { tinyPng } from "../../metadata/__tests__/fixtures";
import { liberationSans } from "../../office/__tests__/fixtures";
import { addPageNumbers, addWatermark, applySignatures, pageLabels, type WatermarkOptions } from "../markup";
import { anchorBox, displaySize, pageGeometry, toUserSpace } from "../stamp";

const fonts = liberationSans();
const ROTATIONS = [0, 90, 180, 270];

/** Four 600 × 800 pages cropped to 500 × 720 at (50, 40), rotated 0/90/180/270. */
async function rotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const angle of ROTATIONS) {
    const page = doc.addPage([600, 800]);
    page.setCropBox(50, 40, 500, 720);
    page.setRotation(degrees(angle));
    page.drawText(`Body of page rotated ${angle}`, { x: 100, y: 400, size: 12, font });
  }
  return doc.save();
}

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

const multiply = (m: number[], n: number[]) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Text items as the reader sees them: start point, reading direction (degrees CCW), width. */
async function displayedText(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  return items.flatMap((item) => {
    if (!("str" in item) || !item.str.trim()) return [];
    const [a, b, , , u, v] = multiply(viewport.transform, item.transform);
    const angle = (Math.atan2(-b, a) * 180) / Math.PI;
    const rad = (angle * Math.PI) / 180;
    return [{ text: item.str, u, v, angle, width: item.width, center: { u: u + (item.width / 2) * Math.cos(rad), v: v - (item.width / 2) * Math.sin(rad) } }];
  });
}

/** Rectangles (displayed) where images are painted, from pdf.js's operator list. */
async function displayedImages(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 1 });
  const { fnArray, argsArray } = await page.getOperatorList();
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const rects: { u: number; v: number; width: number; height: number }[] = [];
  fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, argsArray[i] as number[]);
    else if (fn === OPS.paintImageXObject) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => viewport.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
      const us = corners.map((c) => c[0]);
      const vs = corners.map((c) => c[1]);
      rects.push({ u: Math.min(...us), v: Math.min(...vs), width: Math.max(...us) - Math.min(...us), height: Math.max(...vs) - Math.min(...vs) });
    }
  });
  return rects;
}

describe("page geometry", () => {
  it("maps displayed points to user space exactly as PDF readers do, for every rotation", async () => {
    const bytes = await rotatedPdf();
    const doc = await PDFDocument.load(bytes);
    await withPdfjs(bytes, async (pages) => {
      pages.forEach((pdfjsPage, i) => {
        const geometry = pageGeometry(doc.getPage(i));
        const viewport = pdfjsPage.getViewport({ scale: 1 });
        expect(displaySize(geometry)).toEqual({ width: viewport.width, height: viewport.height });
        for (const [u, v] of [[0, 0], [123, 45], [viewport.width, viewport.height]]) {
          const [x, y] = viewport.convertToPdfPoint(u, v);
          const ours = toUserSpace(geometry, u, v);
          expect(ours.x).toBeCloseTo(x, 6);
          expect(ours.y).toBeCloseTo(y, 6);
        }
      });
    });
  });

  it("pins boxes to the nine anchor points", () => {
    const page = { width: 500, height: 700 };
    const size = { width: 100, height: 20 };
    expect(anchorBox("top-left", page, size, 30)).toEqual({ u: 30, v: 30 });
    expect(anchorBox("bottom-right", page, size, 30)).toEqual({ u: 370, v: 650 });
    expect(anchorBox("center", page, size, 30)).toEqual({ u: 200, v: 340 });
    expect(anchorBox("bottom-center", page, size, 30)).toEqual({ u: 200, v: 650 });
  });
});

describe("page numbers", () => {
  it("sits upright at the bottom centre of every page, whatever its rotation", async () => {
    const out = await addPageNumbers(await rotatedPdf(), { format: "Page {n} of {total}", position: "bottom-center", margin: 30, size: 10, color: "#333333", start: 1 }, fonts);
    await withPdfjs(out, async (pages) => {
      for (const [i, page] of pages.entries()) {
        const { width, height } = page.getViewport({ scale: 1 });
        const label = (await displayedText(page)).find((t) => t.text.startsWith("Page "))!;
        expect(label.text).toBe(`Page ${i + 1} of 4`);
        expect(label.angle).toBeCloseTo(0, 3);
        expect(label.center.u).toBeCloseTo(width / 2, 0);
        // Baseline inside the bottom margin band: above the 30 pt margin, below the text height.
        expect(label.v).toBeLessThan(height - 30);
        expect(label.v).toBeGreaterThan(height - 30 - 10);
      }
    });
  });

  it("numbers only chosen pages, from a chosen start", async () => {
    const out = await addPageNumbers(await rotatedPdf(), { format: "{n}", position: "top-right", margin: 20, size: 9, color: "#000000", start: 5, pages: [1, 2] }, fonts);
    await withPdfjs(out, async (pages) => {
      const numbers = await Promise.all(pages.map(async (p) => (await displayedText(p)).filter((t) => /^\d+$/.test(t.text)).map((t) => t.text)));
      expect(numbers).toEqual([[], ["5"], ["6"], []]);
    });
  });

  it("labels only the chosen pages, with {total} as the last number", () => {
    const style = { position: "bottom-center" as const, margin: 20, size: 9, color: "#000000" };
    expect(pageLabels({ ...style, format: "Page {n} of {total}", start: 1, pages: [1, 2, 3] }, 5)).toEqual([null, "Page 1 of 3", "Page 2 of 3", "Page 3 of 3", null]);
    expect(pageLabels({ ...style, format: "{n}", start: 10 }, 3)).toEqual(["10", "11", "12"]);
  });

  it("needs a {n} placeholder", async () => {
    await expect(addPageNumbers(await rotatedPdf(), { format: "Page", position: "bottom-center", margin: 20, size: 9, color: "#000", start: 1 }, fonts)).rejects.toThrow(/\{n\}/);
  });
});

describe("watermark", () => {
  const base: WatermarkOptions = { kind: "text", text: "Конфиденциально", bold: true, size: 48, color: "#cc0000", opacity: 0.3, angle: 45, position: "center", imageScale: 0.4, behind: false };

  it("centres rotated text on every page, drawn with Unicode text and transparency", async () => {
    const out = await addWatermark(await rotatedPdf(), base, fonts);
    await withPdfjs(out, async (pages) => {
      for (const page of pages) {
        const { width, height } = page.getViewport({ scale: 1 });
        const mark = (await displayedText(page)).find((t) => t.text === "Конфиденциально")!;
        expect(mark.angle).toBeCloseTo(45, 1);
        // The text's midpoint, raised half its cap height, is the page centre.
        expect(mark.center.u).toBeGreaterThan(width / 2 - 20);
        expect(mark.center.u).toBeLessThan(width / 2 + 20);
        expect(mark.center.v).toBeGreaterThan(height / 2 - 20);
        expect(mark.center.v).toBeLessThan(height / 2 + 20);
      }
    });
    expect(new TextDecoder("latin1").decode(out)).toMatch(/\/ca 0\.3/);
  });

  it("tiles across the page and can go behind the content", async () => {
    const out = await addWatermark(await rotatedPdf(), { ...base, text: "DRAFT", size: 28, position: "tile", behind: true, pages: [0] }, fonts);
    await withPdfjs(out, async (pages) => {
      const tiles = (await displayedText(pages[0])).reduce((n, t) => n + t.text.split("DRAFT").length - 1, 0);
      expect(tiles).toBeGreaterThanOrEqual(6);
      expect((await displayedText(pages[1])).some((t) => t.text === "DRAFT")).toBe(false);
    });
    // Behind: the watermark stream comes before the page's own content.
    const doc = await PDFDocument.load(out);
    const contents = doc.getPage(0).node.lookup(PDFName.of("Contents"), PDFArray);
    const first = new TextDecoder().decode(decodePDFRawStream(contents.lookup(0) as PDFRawStream).decode());
    expect(first).toMatch(/BT[\s\S]*Tj|TJ/);
  });

  it("stamps an image scaled to the page width", async () => {
    const out = await addWatermark(await rotatedPdf(), { ...base, kind: "image", image: { bytes: tinyPng(), format: "png" }, imageScale: 0.5, angle: 0, position: "bottom-right" }, fonts);
    await withPdfjs(out, async (pages) => {
      for (const page of pages) {
        const { width, height } = page.getViewport({ scale: 1 });
        const [rect] = await displayedImages(page);
        expect(rect.width).toBeCloseTo(width / 2, 1);
        expect(rect.u + rect.width).toBeCloseTo(width - Math.min(36, width / 12), 1);
        expect(rect.v + rect.height).toBeCloseTo(height - Math.min(36, width / 12), 1);
      }
    });
  });
});

describe("signatures", () => {
  it("places images and text where they were put on the displayed page, upright", async () => {
    const out = await applySignatures(
      await rotatedPdf(),
      ROTATIONS.flatMap((_, page) => [
        { page, kind: "image" as const, image: "sig", x: 0.6, y: 0.8, width: 0.3, height: 0.1 },
        { page, kind: "text" as const, text: "27/09/2026", x: 0.1, y: 0.85, width: 0.25, height: 0.04 },
      ]),
      { sig: tinyPng() },
      fonts,
    );
    await withPdfjs(out, async (pages) => {
      for (const page of pages) {
        const { width, height } = page.getViewport({ scale: 1 });
        const [rect] = await displayedImages(page);
        expect(rect.u).toBeCloseTo(0.6 * width, 1);
        expect(rect.v).toBeCloseTo(0.8 * height, 1);
        expect(rect.width).toBeCloseTo(0.3 * width, 1);
        expect(rect.height).toBeCloseTo(0.1 * height, 1);
        const date = (await displayedText(page)).find((t) => t.text === "27/09/2026")!;
        expect(date.angle).toBeCloseTo(0, 3);
        expect(date.u).toBeCloseTo(0.1 * width, 1);
        expect(date.v).toBeGreaterThan(0.85 * height);
        expect(date.v).toBeLessThan(0.89 * height);
      }
    });
  });

  it("needs something to place", async () => {
    await expect(applySignatures(await rotatedPdf(), [], {}, fonts)).rejects.toThrow(/Place a signature/);
  });
});
