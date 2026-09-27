import { degrees, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPages, mergePdfs, rearrangePages } from "../assemble";
import { chunkPages, formatPageRanges, parsePageRanges } from "../ranges";
import { rasterSize } from "../rasterize";

/** A PDF whose pages are identifiable by width: page i (0-based) is `base + i` points wide. */
async function numberedPdf(pages: number, base = 100, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("Original Author");
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([base + i, 500]);
    page.drawText(`page ${i + 1}`, { x: 10, y: 10, size: 8 });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

describe("page ranges", () => {
  it("parses single pages, ranges and open ends into 0-based groups", () => {
    expect(parsePageRanges("1-3, 5, 8-", 10)).toEqual({ ok: true, groups: [[0, 1, 2], [4], [7, 8, 9]] });
    expect(parsePageRanges("-2", 5)).toEqual({ ok: true, groups: [[0, 1]] });
    expect(parsePageRanges(" 2 to 3 ; 4 ", 5)).toEqual({ ok: true, groups: [[1, 2], [3]] });
  });

  it("explains invalid input", () => {
    expect(parsePageRanges("", 5)).toMatchObject({ ok: false, error: expect.stringContaining("at least one") });
    expect(parsePageRanges("7", 5)).toMatchObject({ ok: false, error: expect.stringContaining("5 pages") });
    expect(parsePageRanges("4-2", 5)).toMatchObject({ ok: false, error: expect.stringContaining("2-4") });
    expect(parsePageRanges("abc", 5)).toMatchObject({ ok: false });
    expect(parsePageRanges("0", 5)).toMatchObject({ ok: false });
  });

  it("formats indices back into compact ranges", () => {
    expect(formatPageRanges([0, 1, 2, 4, 6, 7])).toBe("1-3, 5, 7-8");
    expect(formatPageRanges([])).toBe("");
  });

  it("chunks pages", () => {
    expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });
});

describe("merge", () => {
  it("concatenates documents in order without adding metadata", async () => {
    const merged = await mergePdfs([
      { name: "a.pdf", bytes: await numberedPdf(2, 100) },
      { name: "b.pdf", bytes: await numberedPdf(3, 200) },
    ]);
    expect(await widths(merged)).toEqual([100, 101, 200, 201, 202]);
    const doc = await PDFDocument.load(merged, { updateMetadata: false });
    expect(doc.getProducer()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
  });

  it("names the file that is password-protected", async () => {
    const locked = await PDFDocument.create();
    locked.addPage();
    locked.encrypt({ userPassword: "x", ownerPassword: "y" });
    await expect(
      mergePdfs([{ name: "ok.pdf", bytes: await numberedPdf(1) }, { name: "secret.pdf", bytes: await locked.save() }]),
    ).rejects.toMatchObject({ code: "encrypted", message: expect.stringContaining("secret.pdf") });
  });

  it("needs two files", async () => {
    await expect(mergePdfs([{ name: "a.pdf", bytes: await numberedPdf(1) }])).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("extract", () => {
  it("creates one document per group", async () => {
    const parts = await extractPages(await numberedPdf(6), [[0, 1], [4], [5, 2]]);
    expect(await Promise.all(parts.map(widths))).toEqual([[100, 101], [104], [105, 102]]);
  });

  it("doesn't copy pages that links on the extracted pages point to", async () => {
    // Before 2.0 a link from page 1 to page 3 made copyPages bring page 3 (content and all) along as a hidden object.
    const doc = await PDFDocument.load(await numberedPdf(3));
    const [first, , third] = doc.getPages();
    const link = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [third.ref, PDFName.of("Fit")] }));
    first.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    const [out] = await extractPages(await doc.save(), [[0]]);
    const result = await PDFDocument.load(out);
    const pageObjects = result.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Page"));
    expect(result.getPageCount()).toBe(1);
    // The link's target survives only as an empty page object, with no content or resources.
    const inTree = new Set(result.getPages().map((p) => p.ref.toString()));
    const stray = pageObjects.filter(([ref]) => !inTree.has(ref.toString())).map(([, o]) => o as PDFDict);
    expect(stray.every((o) => o.keys().length === 1)).toBe(true);
    expect(result.context.enumerateIndirectObjects().length).toBeLessThan((await PDFDocument.load(await doc.save())).context.enumerateIndirectObjects().length);
  });

  it("rejects out-of-range pages", async () => {
    await expect(extractPages(await numberedPdf(2), [[5]])).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("rearrange", () => {
  it("reorders, rotates and deletes pages while keeping document metadata", async () => {
    const out = await rearrangePages(await numberedPdf(4), [
      { index: 3, rotate: 0 },
      { index: 0, rotate: 90 },
      { index: 1, rotate: -90 },
    ]);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([103, 100, 101]);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 270]);
    expect(doc.getAuthor()).toBe("Original Author");
  });

  it("adds to an existing rotation", async () => {
    const out = await rearrangePages(await numberedPdf(1, 100, 270), [{ index: 0, rotate: 180 }]);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });

  it("purges deleted pages from the file, not just from the page list", async () => {
    const src = await PDFDocument.load(await numberedPdf(3));
    // Tag page 2 with a marker we can search for after deletion.
    src.getPage(1).node.set(PDFName.of("SecretMarker"), PDFString.of("delete-me"));
    const out = await rearrangePages(await src.save(), [{ index: 0, rotate: 0 }, { index: 2, rotate: 0 }]);
    const reloaded = await PDFDocument.load(out);
    const leftovers = reloaded.context
      .enumerateIndirectObjects()
      .filter(([, obj]) => obj instanceof PDFDict && obj.has(PDFName.of("SecretMarker")));
    expect(leftovers).toHaveLength(0);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("flattens nested page trees without losing inherited page sizes", async () => {
    const doc = await PDFDocument.load(await numberedPdf(4));
    const { context } = doc;
    const pagesRef = doc.catalog.get(PDFName.of("Pages")) as PDFRef;
    const pages = doc.getPages();
    // Two intermediate nodes that each hold a MediaBox their pages inherit.
    const group = (members: typeof pages, width: number) => {
      const ref = context.register(
        context.obj({ Type: "Pages", Parent: pagesRef, Kids: members.map((p) => p.ref), Count: members.length, MediaBox: [0, 0, width, 500] }),
      );
      for (const p of members) {
        p.node.set(PDFName.of("Parent"), ref);
        p.node.delete(PDFName.of("MediaBox"));
      }
      return ref;
    };
    const root = doc.catalog.Pages();
    root.set(PDFName.of("Kids"), context.obj([group(pages.slice(0, 2), 700), group(pages.slice(2), 900)]));

    const out = await rearrangePages(await doc.save(), [{ index: 3, rotate: 0 }, { index: 0, rotate: 0 }]);
    expect(await widths(out)).toEqual([900, 700]);
  });

  it("refuses to delete every page or repeat a page", async () => {
    const bytes = await numberedPdf(2);
    await expect(rearrangePages(bytes, [])).rejects.toMatchObject({ code: "invalid" });
    await expect(rearrangePages(bytes, [{ index: 0, rotate: 0 }, { index: 0, rotate: 0 }])).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("raster size", () => {
  it("scales pages to the chosen DPI", () => {
    expect(rasterSize(612, 792, 150)).toEqual({ scale: 150 / 72, width: 1275, height: 1650, capped: false });
    expect(rasterSize(595.28, 841.89, 72)).toMatchObject({ width: 595, height: 842, capped: false });
  });

  it("stays within what browsers can allocate for a canvas", () => {
    const poster = rasterSize(14_400, 14_400, 300);
    expect(poster.capped).toBe(true);
    expect(poster.width * poster.height).toBeLessThanOrEqual(16_000_000);
    const strip = rasterSize(14_400, 200, 300);
    expect(strip.capped).toBe(true);
    expect(strip.width).toBeLessThanOrEqual(10_000);
  });
});
