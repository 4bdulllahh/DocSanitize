// The unencrypted source for the encrypted fixtures: text, document info and a link.
import { writeFileSync } from "node:fs";
import { PDFDocument, PDFString, StandardFonts } from "@cantoo/pdf-lib";

const doc = await PDFDocument.create({ updateMetadata: false });
doc.setAuthor("Jane Doe");
doc.setTitle("Merger plan — confidential");
const page = doc.addPage([300, 300]);
page.drawText("SECRET TEXT 42", { x: 20, y: 150, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
const link = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [20, 140, 200, 170], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.org/merger") } });
page.node.addAnnot(doc.context.register(link));
writeFileSync(new URL("base.pdf", import.meta.url), await doc.save({ useObjectStreams: false }));
