import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { cleanPdf, inspectPdf } from "../pdf-inspect";
import { classify, hiddenRuns, mergeHidden, regionStats } from "../pdf-visibility";

async function riskyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("Jane Doe");
  const page = doc.addPage([600, 800]);
  page.drawText("Hello", { x: 50, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  const page2 = doc.addPage([600, 800]);
  const { context } = doc;
  doc.addJavaScript("init", "app.alert('hi')");
  await doc.attach(new Uint8Array([77, 90]), "update.exe", { mimeType: "application/octet-stream" });
  const annots = [
    context.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30], T: PDFHexString.fromText("Reviewer Ray"), Contents: PDFHexString.fromText("Remove the salary table before sending") }),
    context.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 50, 150, 70], A: { S: "Launch", F: PDFString.of("cmd.exe") } }),
    context.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 90, 150, 110], A: { S: "URI", URI: PDFString.of("https://example.com/page") } }),
  ].map((a) => context.register(a));
  page.node.set(PDFName.of("Annots"), context.obj(annots));
  const form = doc.getForm();
  form.createTextField("name").addToPage(page2, { x: 50, y: 700, width: 200, height: 20 });
  form.getTextField("name").setText("Jane");
  // A hidden layer, a stored thumbnail, and an image nothing uses any more.
  const layer = context.register(context.obj({ Type: "OCG", Name: PDFHexString.fromText("Internal notes") }));
  doc.catalog.set(PDFName.of("OCProperties"), context.obj({ OCGs: [layer], D: { OFF: [layer] } }));
  page2.node.set(PDFName.of("Thumb"), context.register(context.stream(new Uint8Array(3), { Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8 })));
  context.register(context.stream(new Uint8Array(3), { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
  const bytes = await doc.save({ useObjectStreams: false });
  // Stand-in for an incremental save: another revision's end marker.
  return new Uint8Array([...bytes, ...new TextEncoder().encode("\n%%EOF\n")]);
}

describe("PDF inspection", () => {
  it("reports what's hidden in the file", async () => {
    const { findings, removable } = await inspectPdf(await riskyPdf());
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    expect(byId.revisions.title).toBe("1 earlier version saved inside the file");
    expect(byId.leftovers.severity).toBe("high");
    expect(byId.javascript.items).toEqual(["Document script “init”"]);
    expect(byId.launch.items).toEqual(["cmd.exe (page 1)"]);
    expect(byId.links.items).toEqual(["example.com"]);
    expect(byId.attachments.items).toEqual(["update.exe"]);
    expect(byId.attachments.detail).toMatch(/program or script/);
    expect(byId.comments.detail).toMatch(/Reviewer Ray/);
    expect(byId.comments.items).toEqual(["Page 1: “Remove the salary table before sending”"]);
    expect(byId.form.title).toBe("A form with 1 field");
    expect(byId.form.detail).toMatch(/^1 field is filled in/);
    expect(byId.layers.items).toEqual(["Internal notes"]);
    expect(byId.thumbnails.title).toBe("1 stored page thumbnail");
    expect(byId.metadata.items).toEqual(["Author: Jane Doe"]);
    expect(byId.summary.title).toMatch(/^2 pages, PDF 1\.\d$/);
    expect(removable).toEqual({ javascript: true, attachments: true, comments: true, metadata: true, thumbnails: true });
  });

  it("cleans the file and keeps pages, links and forms", async () => {
    const clean = await cleanPdf(await riskyPdf(), { javascript: true, attachments: true, comments: true, metadata: true, thumbnails: true });
    const { findings } = await inspectPdf(clean);
    expect(findings.map((f) => f.id).sort()).toEqual(["form", "layers", "links", "summary"]);
    const doc = await PDFDocument.load(clean, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getForm().getTextField("name").getText()).toBe("Jane");
  });
});

describe("hidden text by pixels", () => {
  const image = (w: number, h: number, fill: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([fill(x, y), fill(x, y), fill(x, y), 255], (y * w + x) * 4);
    return data;
  };
  const rect = { x0: 0, y0: 0, x1: 10, y1: 10 };

  it("tells covered, invisible and visible text apart", () => {
    expect(classify(regionStats(image(10, 10, () => 0), 10, rect))).toBe("covered");
    expect(classify(regionStats(image(10, 10, () => 255), 10, rect))).toBe("invisible");
    expect(classify(regionStats(image(10, 10, (x) => (x % 3 ? 255 : 20)), 10, rect))).toBeNull();
  });

  it("finds the covered part of a run of text", () => {
    const chars = Array.from("Client: John Smith.");
    const kinds = chars.map((ch, i) => (i >= 8 && i < 18 && ch !== " " ? ("covered" as const) : null));
    expect(hiddenRuns(chars, kinds)).toEqual([{ kind: "covered", from: 8, to: 18, text: "John Smith" }]);
    // A lone punctuation mark doesn't count.
    expect(hiddenRuns(["a", "."], [null, "invisible"])).toEqual([]);
  });

  it("joins neighbouring words on a line", () => {
    const at = (x: number, y: number, text: string) => ({ kind: "covered" as const, page: 0, text, box: { x, y, width: 30, height: 12 } });
    expect(mergeHidden([at(10, 100, "John"), at(44, 100, "Smith"), at(10, 140, "Other")]).map((h) => [h.text, h.box.width])).toEqual([
      ["John Smith", 64],
      ["Other", 30],
    ]);
  });
});
