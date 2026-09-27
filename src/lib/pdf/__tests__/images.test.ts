import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { prepareImage } from "../../image/prepare";
import { auditMetadata } from "../../metadata";
import { addJpegMetadata, addPngMetadata, sizedJpeg, tinyPng } from "../../metadata/__tests__/fixtures";
import { DEFAULT_IMAGES_TO_PDF, displayedSize, imagesToPdf, layoutPage, PAGE_SIZES, unitTransform, type ImagesToPdfOptions } from "../images";

const options = (patch: Partial<ImagesToPdfOptions> = {}): ImagesToPdfOptions => ({ ...DEFAULT_IMAGES_TO_PDF, ...patch });

/** Where the stored image's corners land on screen, as [s, t] in the displayed unit square. */
const corners = (orientation: number, rotate = 0) => {
  const [a, b, c, d, e, f] = unitTransform(orientation, rotate);
  // Stored top-left, top-right, bottom-left.
  return [[0, 1], [1, 1], [0, 0]].map(([u, v]) => [a * u + c * v + e, b * u + d * v + f]);
};

async function pageContent(bytes: Uint8Array, index = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join("\n");
}

const matrixOf = (content: string) => content.match(/([-\d.\s]+) cm/)![1].trim().split(/\s+/).map(Number);

describe("image orientation", () => {
  it("matches the EXIF definitions", () => {
    // Orientation 6 means "rotate 90° clockwise to display": the stored top-left ends up top-right.
    expect(corners(6)[0]).toEqual([1, 1]);
    // 8 is 90° counter-clockwise: stored top-left ends up bottom-left.
    expect(corners(8)[0]).toEqual([0, 0]);
    expect(corners(3)[0]).toEqual([1, 0]);
    // Mirrors: 2 flips left-right, 4 flips top-bottom.
    expect(corners(2)[0]).toEqual([1, 1]);
    expect(corners(4)[0]).toEqual([0, 0]);
  });

  it("composes EXIF orientation with extra clockwise rotation", () => {
    expect(unitTransform(1, 90)).toEqual(unitTransform(6, 0));
    expect(unitTransform(1, 180)).toEqual(unitTransform(3, 0));
    expect(unitTransform(1, 270)).toEqual(unitTransform(8, 0));
    expect(unitTransform(1, -90)).toEqual(unitTransform(8, 0));
    // exiftool: 7 = "mirror horizontal and rotate 90 CW", 5 = "mirror horizontal and rotate 270 CW".
    expect(unitTransform(2, 90)).toEqual(unitTransform(7, 0));
    expect(unitTransform(2, 270)).toEqual(unitTransform(5, 0));
    expect(unitTransform(6, 270)).toEqual(unitTransform(1, 0));
  });

  it("swaps width and height for quarter turns", () => {
    expect(displayedSize(400, 300, 1, 0)).toEqual([400, 300]);
    expect(displayedSize(400, 300, 6, 0)).toEqual([300, 400]);
    expect(displayedSize(400, 300, 6, 90)).toEqual([400, 300]);
    expect(displayedSize(400, 300, 1, 270)).toEqual([300, 400]);
  });
});

describe("page layout", () => {
  it("fits the page to the image at 96 DPI", () => {
    const layout = layoutPage(800, 600, options({ pageSize: "fit" }));
    expect([layout.width, layout.height]).toEqual([600, 450]);
    expect(layout.image).toEqual({ x: 0, y: 0, width: 600, height: 450 });
    const margined = layoutPage(800, 600, options({ pageSize: "fit", margin: 20 }));
    expect([margined.width, margined.height]).toEqual([640, 490]);
  });

  it("caps fitted pages at the PDF maximum of 200 inches", () => {
    const layout = layoutPage(40_000, 10_000, options({ pageSize: "fit" }));
    expect(layout.width).toBeCloseTo(14_400);
    expect(layout.height).toBeCloseTo(3_600);
  });

  it("picks the orientation from the image in auto mode", () => {
    const [w, h] = PAGE_SIZES.a4;
    expect(layoutPage(300, 400, options())).toMatchObject({ width: w, height: h });
    expect(layoutPage(400, 300, options())).toMatchObject({ width: h, height: w });
    expect(layoutPage(400, 300, options({ orientation: "portrait" }))).toMatchObject({ width: w, height: h });
    expect(layoutPage(300, 400, options({ pageSize: "letter", orientation: "landscape" }))).toMatchObject({ width: 792, height: 612 });
  });

  it("centres the image inside the margins (contain) or fills and clips (cover)", () => {
    const contain = layoutPage(100, 100, options({ pageSize: "letter", margin: 36 }));
    expect(contain.image.width).toBeCloseTo(540);
    expect(contain.image.x).toBeCloseTo(36);
    expect(contain.image.y).toBeCloseTo((792 - 540) / 2);
    expect(contain.clip).toBeNull();

    const cover = layoutPage(100, 100, options({ pageSize: "letter", margin: 36, fit: "cover" }));
    expect(cover.image.height).toBeCloseTo(720);
    expect(cover.image.x).toBeCloseTo(36 - (720 - 540) / 2);
    expect(cover.clip).toEqual({ x: 36, y: 36, width: 540, height: 720 });
  });
});

describe("images to PDF", () => {
  it("strips EXIF/GPS from JPEGs and applies their orientation when drawing", async () => {
    const photo = addJpegMetadata(sizedJpeg(4000, 3000), { exif: { orientation: 6, artist: "Jane Doe", serial: "SN-4242", gps: { lat: 25.2, lon: 55.27 } } });
    const prepared = await prepareImage({ name: "photo.jpg", bytes: photo, rotate: 0 });
    expect(prepared).toMatchObject({ format: "jpeg", orientation: 6 });
    expect((await auditMetadata(prepared.bytes)).entries).toEqual([]);

    const pdf = await imagesToPdf([prepared], options());
    const text = new TextDecoder("latin1").decode(pdf);
    for (const leak of ["Jane Doe", "SN-4242", "Exif", "Producer", "CreationDate"]) expect(text).not.toContain(leak);

    // Stored landscape, displayed portrait: A4 portrait, full width, centred vertically.
    const [pageWidth, pageHeight] = PAGE_SIZES.a4;
    const page = (await PDFDocument.load(pdf)).getPage(0);
    expect(page.getWidth()).toBeCloseTo(pageWidth);
    expect(page.getHeight()).toBeCloseTo(pageHeight);
    const drawnHeight = (pageWidth / 3000) * 4000;
    const y = (pageHeight - drawnHeight) / 2;
    // Orientation 6: [0, -H, W, 0, x, y + H].
    const matrix = matrixOf(await pageContent(pdf));
    [0, -drawnHeight, pageWidth, 0, 0, y + drawnHeight].forEach((n, i) => expect(matrix[i]).toBeCloseTo(n, 1));
  });

  it("embeds PNGs from their pixels, so text chunks never reach the PDF", async () => {
    const png = addPngMetadata(tinyPng(), { text: { Author: "Jane Doe", Comment: "secret" } });
    const prepared = await prepareImage({ name: "shot.png", bytes: png, rotate: 90 });
    const pdf = await imagesToPdf([prepared], options({ pageSize: "fit" }));
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text).not.toContain("Jane Doe");
    expect(text).not.toContain("secret");
  });

  it("makes one page per image, in order, with a clip path in cover mode", async () => {
    const images = await Promise.all([
      prepareImage({ name: "wide.jpg", bytes: sizedJpeg(1600, 900), rotate: 0 }),
      prepareImage({ name: "tall.jpg", bytes: sizedJpeg(900, 1600), rotate: 0 }),
      prepareImage({ name: "turned.jpg", bytes: sizedJpeg(900, 1600), rotate: 90 }),
    ]);
    const pdf = await imagesToPdf(images, options({ pageSize: "letter", fit: "cover", margin: 20 }));
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[792, 612], [612, 792], [792, 612]]);
    expect(await pageContent(pdf, 0)).toMatch(/20 20 752 572 re\s+W\s+n/);
    expect(doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"))).toBeDefined();
  });

  it("rejects unsupported and damaged files by name", async () => {
    await expect(prepareImage({ name: "notes.txt", bytes: new TextEncoder().encode("hello"), rotate: 0 })).rejects.toThrow(/notes\.txt/);
    await expect(imagesToPdf([], options())).rejects.toThrow(/at least one/);
  });
});
