import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { stripText } from "../strip-text";

type Item = { str: string; transform: number[]; width: number; height: number };

async function items(bytes: Uint8Array): Promise<Item[][]> {
  const task = getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const pages: Item[][] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.flatMap((it) => ("str" in it && it.str.trim() ? [it as Item] : [])));
  await task.destroy();
  return pages;
}

describe("PDF to PowerPoint: text taken out of the page picture", () => {
  it("removes the lines that become text boxes and keeps the rest", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 400]);
    page.drawText("Becomes a text box", { x: 40, y: 300, size: 14, font });
    page.drawText("Stays in the picture", { x: 40, y: 200, size: 14, font });
    const bytes = await doc.save();

    const [found] = await items(bytes);
    const line = found.find((i) => i.str === "Becomes a text box")!;
    const result = await stripText(bytes, [[[{ transform: line.transform, width: line.width, height: line.height, str: line.str }]]]);
    expect(result.removed).toEqual([[true]]);
    expect((await items(result.bytes))[0].map((i) => i.str)).toEqual(["Stays in the picture"]);
  });
});
