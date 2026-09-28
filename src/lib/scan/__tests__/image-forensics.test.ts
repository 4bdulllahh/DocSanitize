import { describe, expect, it } from "vitest";
import { addJpegMetadata, addPngMetadata, SAMPLE_XMP, TINY_JPEG, tinyPng } from "../../metadata/__tests__/fixtures";
import { errorLevels, grayDifference } from "../ela";
import { inspectImage, jpegQuality } from "../image-forensics";

const ids = async (bytes: Uint8Array) => (await inspectImage(bytes)).findings.map((f) => f.id);

describe("image forensics", () => {
  it("estimates JPEG quality from the quantization table", () => {
    // TINY_JPEG's table is all ones: the highest quality.
    expect(jpegQuality(TINY_JPEG)).toBe(100);
    expect(jpegQuality(tinyPng())).toBeNull();
  });

  it("reports the camera, location and editing software", async () => {
    const photo = addJpegMetadata(TINY_JPEG, { exif: { make: "Apple", model: "iPhone 15 Pro", gps: { lat: 25.2, lon: 55.27 } }, xmp: SAMPLE_XMP });
    const { findings } = await inspectImage(photo);
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    expect(byId.camera.title).toBe("Taken with Apple iPhone 15 Pro");
    expect(byId.location.detail).toMatch(/^GPS position 25\.2/);
    expect(byId.edited.title).toBe("Edited with Adobe Photoshop 26.1 (Macintosh)");
    expect(byId.quality.title).toBe("JPEG quality about 100%");
  });

  it("recognises AI generator labels and Content Credentials", async () => {
    const sd = addPngMetadata(tinyPng(), { text: { parameters: "a cat astronaut, Steps: 20, Sampler: Euler a", Software: "ComfyUI" } });
    const { findings } = await inspectImage(sd);
    const ai = findings.find((f) => f.id === "ai")!;
    expect(ai.items).toEqual(["Generator settings (“parameters”): a cat astronaut, Steps: 20, Sampler: Euler a", "Software: ComfyUI"]);
    const xmp = SAMPLE_XMP.replace('photoshop:City="Dubai"', 'photoshop:City="Dubai" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"');
    const labelled = addJpegMetadata(TINY_JPEG, { xmp, comment: "jumb c2pa.claim" });
    expect(await ids(labelled)).toEqual(expect.arrayContaining(["ai", "c2pa"]));
    expect(await ids(TINY_JPEG)).toEqual(["no-camera", "quality"]);
  });

  it("compares pictures pixel by pixel", () => {
    const gray = (v: number) => new Uint8ClampedArray([v, v, v, 255, v, v, v, 255]);
    expect(grayDifference(gray(10), gray(40))).toBeCloseTo(30);
    expect(Array.from(errorLevels(gray(100), gray(103), 20))).toEqual([60, 60, 60, 255, 60, 60, 60, 255]);
  });
});
