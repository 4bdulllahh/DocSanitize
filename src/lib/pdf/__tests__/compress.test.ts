import { unzlibSync } from "fflate";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDict } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { sizedJpeg } from "../../metadata/__tests__/fixtures";
import { compressPdf, COMPRESS_PRESETS, type CompressOptions, type JpegReencoder } from "../compress";
import { savePdf } from "../load";

const balanced: CompressOptions = { ...COMPRESS_PRESETS.balanced, removeMetadata: false };

/** Pretends to re-encode: returns a small JPEG with the size a real encoder would produce. */
function stubEncoder(sourceSizes: Map<number, [number, number]>, outputBytes = 5_000) {
  const calls: { maxSide: number; quality: number }[] = [];
  const encode: JpegReencoder = async (jpeg, maxSide, quality) => {
    calls.push({ maxSide, quality });
    const [w, h] = sourceSizes.get(jpeg.length)!;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const [width, height] = [Math.round(w * scale), Math.round(h * scale)];
    return { bytes: sizedJpeg(width, height, { bytes: outputBytes }), width, height };
  };
  return { encode, calls };
}

interface Fixture {
  bytes: Uint8Array;
  sizes: Map<number, [number, number]>;
  refs: Record<string, PDFRef>;
}

/** A Letter page drawing: a big RGB photo, a CMYK photo, a colour-keyed photo and a small icon. */
async function photoPdf(): Promise<Fixture> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("Jane Doe");
  const page = doc.addPage([612, 792]);
  const sizes = new Map<number, [number, number]>();
  const refs: Record<string, PDFRef> = {};
  const add = async (key: string, jpeg: Uint8Array, w: number, h: number) => {
    sizes.set(jpeg.length, [w, h]);
    const image = await doc.embedJpg(jpeg);
    page.drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
    refs[key] = image.ref;
    return image;
  };
  await add("photo", sizedJpeg(3300, 2550, { bytes: 200_000 }), 3300, 2550);
  await add("cmyk", sizedJpeg(3300, 2550, { components: 4, bytes: 200_001 }), 3300, 2550);
  const keyed = await add("keyed", sizedJpeg(3300, 2550, { bytes: 200_002 }), 3300, 2550);
  await add("icon", sizedJpeg(64, 64, { bytes: 2_000 }), 64, 64);
  // Colour-key masking relies on exact sample values.
  await doc.save(); // flushes embedded images into the context
  (doc.context.lookup(keyed.ref) as PDFRawStream).dict.set(PDFName.of("Mask"), doc.context.obj([0, 10, 0, 10, 0, 10]));
  return { bytes: await doc.save(), sizes, refs };
}

const imageDict = async (bytes: Uint8Array, ref: PDFRef) => ((await PDFDocument.load(bytes)).context.lookup(ref) as PDFRawStream).dict;
const num = (dict: PDFDict, key: string) => (dict.lookup(PDFName.of(key)) as PDFNumber).asNumber();

describe("compress PDF", () => {
  it("downscales plain JPEGs to the target DPI for their page and leaves the rest alone", async () => {
    const { bytes, sizes, refs } = await photoPdf();
    const { encode, calls } = stubEncoder(sizes);
    const result = await compressPdf(bytes, balanced, encode);

    // Letter is 11 in tall: 11 × 150 DPI = 1650 px on the longest side. CMYK, masked and small images are skipped.
    expect(calls).toEqual([{ maxSide: 1650, quality: COMPRESS_PRESETS.balanced.quality }]);
    expect(result).toMatchObject({ images: 4, recompressed: 1, keptOriginal: false });
    expect(result.bytes.length).toBeLessThan(bytes.length - 190_000);

    const photo = await imageDict(result.bytes, refs.photo);
    expect([num(photo, "Width"), num(photo, "Height")]).toEqual([1650, 1275]);
    expect(num(await imageDict(result.bytes, refs.cmyk), "Width")).toBe(3300);
    expect(num(await imageDict(result.bytes, refs.keyed), "Width")).toBe(3300);
    // Metadata is untouched unless asked for.
    expect((await PDFDocument.load(result.bytes)).getAuthor()).toBe("Jane Doe");
  });

  it("uses a lower target for stronger presets", async () => {
    const { bytes, sizes } = await photoPdf();
    const { encode, calls } = stubEncoder(sizes);
    await compressPdf(bytes, { ...COMPRESS_PRESETS.strong, removeMetadata: false }, encode);
    expect(calls[0].maxSide).toBe(1100);
  });

  it("keeps an image when re-encoding doesn't make it meaningfully smaller", async () => {
    const { bytes, sizes, refs } = await photoPdf();
    const { encode } = stubEncoder(sizes, 190_000);
    const result = await compressPdf(bytes, balanced, encode);
    expect(result.recompressed).toBe(0);
    if (!result.keptOriginal) expect(num(await imageDict(result.bytes, refs.photo), "Width")).toBe(3300);
  });

  it("returns the original file when nothing was gained", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([200, 200]).drawText("hello", { x: 10, y: 10 });
    const bytes = await savePdf(doc);
    const result = await compressPdf(bytes.slice(), balanced, stubEncoder(new Map()).encode);
    expect(result.keptOriginal).toBe(true);
    expect(result.bytes).toEqual(bytes);
  });

  it("can strip metadata at the same time", async () => {
    const { bytes, sizes } = await photoPdf();
    const result = await compressPdf(bytes, { ...balanced, removeMetadata: true }, stubEncoder(sizes).encode);
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(out.getAuthor()).toBeUndefined();
    expect(new TextDecoder("latin1").decode(result.bytes)).not.toContain("Jane Doe");
  });

  it("deflates streams that were stored uncompressed", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([200, 200]);
    const data = new TextEncoder().encode("0 0 m 100 100 l S\n".repeat(500));
    const ref = doc.context.register(doc.context.stream(data));
    doc.catalog.set(PDFName.of("TestData"), ref);
    const result = await compressPdf(await doc.save(), balanced, stubEncoder(new Map()).encode);

    const stream = (await PDFDocument.load(result.bytes)).context.lookup(ref) as PDFRawStream;
    expect(stream.dict.lookup(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
    expect(unzlibSync(stream.contents)).toEqual(data);
  });

  it("refuses password-protected files", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "pw", ownerPassword: "owner" });
    await expect(compressPdf(await doc.save(), balanced, stubEncoder(new Map()).encode)).rejects.toMatchObject({ code: "encrypted" });
  });
});
