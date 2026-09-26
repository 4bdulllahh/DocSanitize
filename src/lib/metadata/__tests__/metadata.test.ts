import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { classify } from "../classify";
import { auditMetadata, DEFAULT_STRIP_OPTIONS, detectFormat, MetadataError, stripMetadata, type MetadataReport } from "../index";
import { readXmpProperties } from "../xmp";
import {
  addJpegMetadata,
  addPngMetadata,
  addWebpMetadata,
  leakyPdf,
  SAMPLE_XMP,
  TINY_JPEG,
  tinyPng,
  tinyWebp,
} from "./fixtures";

const find = (report: MetadataReport, label: string | RegExp) =>
  report.entries.find((e) => (typeof label === "string" ? e.label === label : label.test(e.label)));

const values = (report: MetadataReport) => report.entries.map((e) => `${e.label}: ${e.value}`).join("\n");

describe("XMP reader", () => {
  it("reads attributes, simple elements and rdf lists, decoding entities", () => {
    const props = readXmpProperties(SAMPLE_XMP);
    expect(props.get("xmp:CreatorTool")).toEqual(["Adobe Photoshop 26.1 (Macintosh)"]);
    expect(props.get("photoshop:City")).toEqual(["Dubai"]);
    expect(props.get("dc:creator")).toEqual(["Jane Doe"]);
    expect(props.get("dc:title")).toEqual(["Q3 & Q4 plan"]);
    expect(props.get("xmpMM:DocumentID")?.[0]).toMatch(/^xmp\.did:/);
    // Namespace declarations and rdf:about are structure, not data.
    expect([...props.keys()].some((k) => k.startsWith("xmlns"))).toBe(false);
  });
});

describe("sensitivity", () => {
  it("flags people, places and devices as high", () => {
    for (const key of ["GPSLatitude", "Artist", "Author", "dc:creator", "BodySerialNumber", "photoshop:City", "CameraOwnerName"]) {
      expect(classify(key), key).toBe("high");
    }
  });
  it("treats software and dates as medium, technical tags as low", () => {
    expect(classify("xmp:CreatorTool")).toBe("medium");
    expect(classify("Software")).toBe("medium");
    expect(classify("DateTimeOriginal")).toBe("medium");
    expect(classify("ExposureTime")).toBe("low");
    expect(classify("ImageWidth")).toBe("low");
    expect(classify("Orientation")).toBe("low");
  });
});

describe("format detection", () => {
  it("uses file contents, not names", () => {
    expect(detectFormat(TINY_JPEG)).toBe("jpeg");
    expect(detectFormat(tinyPng())).toBe("png");
    expect(detectFormat(tinyWebp())).toBe("webp");
    expect(() => detectFormat(new TextEncoder().encode("hello"))).toThrow(MetadataError);
  });
});

describe("JPEG", () => {
  const leaky = addJpegMetadata(TINY_JPEG, {
    exif: { artist: "Jane Doe", make: "Apple", model: "iPhone 17 Pro", serial: "SN-12345", orientation: 6, gps: { lat: 25.2048, lon: 55.2708 } },
    xmp: SAMPLE_XMP,
    comment: "Edited by Jane",
    icc: true,
    trailer: new Uint8Array(4096).fill(7),
  });

  it("audits EXIF, GPS, XMP, comments, ICC and trailing data", async () => {
    const report = await auditMetadata(leaky);
    expect(report.format).toBe("jpeg");
    expect(find(report, "Artist")).toMatchObject({ value: "Jane Doe", sensitivity: "high" });
    expect(find(report, "Serial Number")).toMatchObject({ value: "SN-12345", sensitivity: "high" });
    expect(find(report, "Make")).toMatchObject({ value: "Apple", sensitivity: "medium" });
    expect(find(report, /GPS Latitude$/)?.sensitivity).toBe("high");
    expect(report.location?.latitude).toBeCloseTo(25.2048, 3);
    expect(report.location?.longitude).toBeCloseTo(55.2708, 3);
    expect(find(report, "Creator")).toMatchObject({ value: "Jane Doe", group: "XMP" });
    expect(find(report, "Comment")?.value).toBe("Edited by Jane");
    expect(find(report, "ICC color profile")).toBeDefined();
    expect(find(report, "Data after end of image")?.sensitivity).toBe("high");
    expect(report.kept.map((k) => k.label)).toEqual(["Orientation"]);
    expect(find(report, "Orientation")).toBeUndefined();
  });

  it("strips everything but orientation, losslessly", async () => {
    const { bytes, verification } = await stripMetadata(leaky, DEFAULT_STRIP_OPTIONS);
    expect(verification.entries, values(verification)).toEqual([]);
    expect(verification.kept.map((k) => k.label)).toEqual(["Orientation"]);
    // Image data (SOS .. EOI) is byte-identical to the original.
    const sos = (b: Uint8Array) => b.findIndex((v, i) => v === 0xff && b[i + 1] === 0xda);
    const scan = (b: Uint8Array) => b.subarray(sos(b), b.lastIndexOf(0xd9) + 1);
    expect(scan(bytes)).toEqual(scan(TINY_JPEG));
    expect(bytes.at(-1)).toBe(0xd9);
    expect(bytes.length).toBeLessThan(leaky.length);
  });

  it("can keep the colour profile", async () => {
    const { verification } = await stripMetadata(leaky, { ...DEFAULT_STRIP_OPTIONS, keepColorProfile: true });
    expect(verification.entries.map((e) => e.label)).toEqual(["ICC color profile"]);
  });

  it("drops orientation when it is already upright", async () => {
    const upright = addJpegMetadata(TINY_JPEG, { exif: { artist: "x", orientation: 1 } });
    const { bytes, verification } = await stripMetadata(upright, DEFAULT_STRIP_OPTIONS);
    expect(verification.kept).toEqual([]);
    expect(bytes).toEqual(TINY_JPEG);
  });
});

describe("PNG", () => {
  const leaky = addPngMetadata(tinyPng(), {
    text: { Author: "Jane Doe", Software: "GIMP 3.0" },
    compressedText: { Comment: "internal draft" },
    xmp: SAMPLE_XMP,
    exif: { artist: "Jane Doe", gps: { lat: -33.8688, lon: 151.2093 } },
    time: new Date("2026-03-04T05:06:07Z"),
    icc: true,
    privateChunk: true,
  });

  it("audits text, compressed text, XMP, eXIf, tIME, ICC and private chunks", async () => {
    const report = await auditMetadata(leaky);
    expect(find(report, "Author")).toMatchObject({ value: "Jane Doe", group: "PNG text", sensitivity: "high" });
    expect(find(report, "Comment")?.value).toBe("internal draft");
    expect(find(report, "Creator")?.value).toBe("Jane Doe");
    expect(find(report, "Artist")?.value).toBe("Jane Doe");
    expect(report.location?.latitude).toBeCloseTo(-33.8688, 3);
    expect(find(report, "Last modified")?.value).toBe("2026-03-04 05:06:07 UTC");
    expect(find(report, "ICC color profile")?.value).toBe("Display P3");
    expect(find(report, "iDOT chunk")).toBeDefined();
  });

  it("strips to rendering chunks only", async () => {
    const { bytes, verification } = await stripMetadata(leaky, DEFAULT_STRIP_OPTIONS);
    expect(verification.entries, values(verification)).toEqual([]);
    expect(bytes).toEqual(tinyPng());
  });
});

describe("WebP", () => {
  const leaky = addWebpMetadata(tinyWebp(), {
    exif: { artist: "Jane Doe", gps: { lat: 51.5, lon: -0.12 } },
    xmp: SAMPLE_XMP,
    icc: true,
    width: 1,
    height: 1,
  });

  it("audits EXIF, XMP and ICC chunks", async () => {
    const report = await auditMetadata(leaky);
    expect(find(report, "Artist")?.value).toBe("Jane Doe");
    expect(report.location?.longitude).toBeCloseTo(-0.12, 2);
    expect(find(report, "City")?.value).toBe("Dubai");
    expect(find(report, "ICC color profile")).toBeDefined();
  });

  it("strips chunks, clears VP8X flags and fixes the RIFF size", async () => {
    const { bytes, verification } = await stripMetadata(leaky, DEFAULT_STRIP_OPTIONS);
    expect(verification.entries, values(verification)).toEqual([]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("VP8X");
    expect(bytes[20] & (0x20 | 0x08 | 0x04)).toBe(0);
  });
});

describe("PDF", () => {
  it("audits info, XMP, IDs, comments, attachments, scripts, embedded photos and revisions", async () => {
    const report = await auditMetadata(await leakyPdf());
    expect(report.format).toBe("pdf");
    expect(find(report, "Author")).toMatchObject({ value: "Jane Doe", sensitivity: "high" });
    expect(find(report, "Title")?.value).toBe("Merger memo (final)");
    expect(find(report, "Creator application")).toMatchObject({ value: "Microsoft Word for Microsoft 365", sensitivity: "medium" });
    expect(find(report, "Created")?.value).toBe("2026-01-15 09:30:00 UTC");
    expect(find(report, "Creator")).toMatchObject({ group: "XMP metadata", value: "Jane Doe" });
    expect(find(report, "Comment authors")).toMatchObject({ value: "Bob Reviewer", sensitivity: "high" });
    expect(find(report, "Attached files")?.value).toBe("salaries.csv");
    expect(find(report, "Document JavaScript")).toBeDefined();
    expect(find(report, "Previous revisions")?.sensitivity).toBe("high");
    const photo = report.entries.filter((e) => e.group === "Embedded photo 1");
    expect(photo.map((e) => e.label)).toEqual(expect.arrayContaining(["Artist", "GPS Latitude"]));
    expect(report.location?.latitude).toBeCloseTo(25.2048, 3);
  });

  it("strips everything and keeps the document intact", async () => {
    const original = await leakyPdf();
    const { bytes, verification } = await stripMetadata(original, DEFAULT_STRIP_OPTIONS);
    expect(verification.entries, values(verification)).toEqual([]);

    const text = new TextDecoder("latin1").decode(bytes);
    for (const secret of ["Jane Doe", "Bob Reviewer", "salaries.csv", "Project Falcon", "Distiller", "app.alert"]) {
      expect(text.includes(secret), secret).toBe(false);
    }
    expect(text.match(/%%EOF/g)).toHaveLength(1);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // The comment itself survives; only its author and timestamps are removed.
    expect(text).not.toContain("/T (");
  });

  it("can keep attachments and scripts when asked", async () => {
    const { verification } = await stripMetadata(await leakyPdf(), {
      ...DEFAULT_STRIP_OPTIONS,
      removeAttachments: false,
      removeJavaScript: false,
      anonymizeAnnotations: false,
    });
    expect(verification.entries.map((e) => e.label).sort()).toEqual(
      ["Attached files", "Comment authors", "Comment timestamps", "Document JavaScript"].sort(),
    );
  });

  it("rejects password-protected PDFs with a clear error", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "secret", ownerPassword: "owner" });
    const encrypted = await doc.save();
    await expect(auditMetadata(encrypted)).rejects.toMatchObject({ code: "encrypted" });
  });
});
