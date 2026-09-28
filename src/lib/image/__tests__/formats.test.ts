import { describe, expect, it } from "vitest";
import { encodeBmp, encodeIco, encodeTiff, targetSize } from "../formats";

// 2 × 2: red, green / blue, half-transparent black.
const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 128]);

describe("BMP", () => {
  it("writes bottom-up 24-bit rows, padded, with transparency flattened", () => {
    const bmp = encodeBmp(pixels, 2, 2);
    const view = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
    expect(view.getUint32(2, true)).toBe(bmp.length);
    expect(view.getInt32(18, true)).toBe(2);
    expect(view.getUint16(28, true)).toBe(24);
    // Rows are 8 bytes (6 + 2 padding); the bottom row (blue, grey) comes first, as BGR.
    expect([...bmp.subarray(54, 60)]).toEqual([255, 0, 0, 127, 127, 127]);
    expect([...bmp.subarray(62, 68)]).toEqual([0, 0, 255, 0, 255, 0]);
    expect(bmp.length).toBe(54 + 16);
  });
});

describe("TIFF", () => {
  const tag = (tiff: Uint8Array, id: number) => {
    const view = new DataView(tiff.buffer);
    const at = view.getUint32(4, true);
    for (let n = 0; n < view.getUint16(at, true); n++) {
      const e = at + 2 + n * 12;
      if (view.getUint16(e, true) === id) return view.getUint16(e + 2, true) === 3 && view.getUint32(e + 4, true) === 1 ? view.getUint16(e + 8, true) : view.getUint32(e + 8, true);
    }
    return null;
  };

  it("writes RGBA with an alpha tag when the picture has transparency", () => {
    const tiff = encodeTiff(pixels, 2, 2);
    expect(String.fromCharCode(tiff[0], tiff[1])).toBe("II");
    expect(tag(tiff, 256)).toBe(2);
    expect(tag(tiff, 277)).toBe(4);
    expect(tag(tiff, 338)).toBe(2);
    const data = tag(tiff, 273)!;
    expect([...tiff.subarray(data, data + 4)]).toEqual([255, 0, 0, 255]);
    expect(tiff.length).toBe(data + 16);
  });

  it("writes RGB for opaque pictures", () => {
    const opaque = pixels.slice();
    opaque[15] = 255;
    const tiff = encodeTiff(opaque, 2, 2);
    expect(tag(tiff, 277)).toBe(3);
    expect(tag(tiff, 338)).toBeNull();
    const data = tag(tiff, 273)!;
    expect([...tiff.subarray(data, data + 6)]).toEqual([255, 0, 0, 0, 255, 0]);
  });
});

describe("ICO", () => {
  it("lists each PNG with its size (256 written as 0)", () => {
    const ico = encodeIco([
      { size: 16, png: new Uint8Array([1, 2, 3]) },
      { size: 256, png: new Uint8Array([4, 5]) },
    ]);
    const view = new DataView(ico.buffer);
    expect([view.getUint16(2, true), view.getUint16(4, true)]).toEqual([1, 2]);
    expect([ico[6], ico[22]]).toEqual([16, 0]);
    expect(view.getUint32(6 + 12, true)).toBe(38);
    expect([...ico.subarray(38)]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("resize", () => {
  it("scales, fits without enlarging, or sets an exact size", () => {
    expect(targetSize(4000, 3000, { mode: "none" })).toEqual({ width: 4000, height: 3000 });
    expect(targetSize(4000, 3000, { mode: "percent", percent: 25 })).toEqual({ width: 1000, height: 750 });
    expect(targetSize(4000, 3000, { mode: "fit", width: 1920, height: 1080 })).toEqual({ width: 1440, height: 1080 });
    expect(targetSize(400, 300, { mode: "fit", width: 1920, height: 1080 })).toEqual({ width: 400, height: 300 });
    expect(targetSize(400, 300, { mode: "fit", width: 200, height: 0 })).toEqual({ width: 200, height: 150 });
    expect(targetSize(400, 300, { mode: "exact", width: 64, height: 64 })).toEqual({ width: 64, height: 64 });
  });
});
