// Test documents for the office converters. Relative imports only, so Node can load this file
// directly (the e2e suites import it too).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import type { FontFiles } from "../flow";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const p = (runs: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
const r = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const listItem = (text: string, numId: number, level = 0) => p(r(text), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`);
const cell = (text: string, span = 1) => `<w:tc>${span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ""}${p(r(text))}</w:tc>`;

const image = (relId: string) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Photo" descr="A photo"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="photo.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** A .docx with headings, styled runs, a link, lists, a table, a photo, a footnote and a page break. */
export function sampleDocx(photo: Uint8Array, extraParagraphs = 0): Uint8Array {
  const body = [
    p(r("Quarterly Plan"), '<w:pStyle w:val="Title"/>'),
    p(r("Goals"), '<w:pStyle w:val="Heading1"/>'),
    p(r("Plain, ") + r("bold", "<w:b/>") + r(", ") + r("italic", "<w:i/>") + r(" and ") + r("underlined", '<w:u w:val="single"/>') + r(" text.")),
    p(`<w:hyperlink r:id="rIdLink">${r("Visit the project")}</w:hyperlink>` + r(" for details.")),
    p(r("Centred line"), '<w:jc w:val="center"/>'),
    listItem("First bullet", 1),
    listItem("Nested bullet", 1, 1),
    listItem("Step one", 2),
    listItem("Step two", 2),
    p(r("Budget"), '<w:pStyle w:val="Heading2"/>'),
    `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("Item")}${cell("Q1")}${cell("Q2")}</w:tr>` +
      `<w:tr>${cell("Hosting")}${cell("120")}${cell("140")}</w:tr>` +
      `<w:tr>${cell("Merged total: 260", 3)}</w:tr></w:tbl>`,
    p(r("Languages: Привет, Ελληνικά, 你好") + `<w:r><w:footnoteReference w:id="1"/></w:r>`),
    p(image("rIdImg")),
    ...Array.from({ length: extraParagraphs }, (_, i) => p(r(`Filler paragraph ${i + 1}. `.repeat(8)))),
    p(`<w:r><w:br w:type="page"/></w:r>` + r("Appendix on its own page")),
  ].join("");

  const numbering =
    `<w:numbering ${W}>` +
    `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const styles =
    `<w:styles ${W}>` +
    ["Title", "Heading1", "Heading2"].map((id) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id.replace(/(\d)/, " $1").replace("Heading", "heading")}"/></w:style>`).join("") +
    "</w:styles>";
  const footnotes = `<w:footnotes ${W}><w:footnote w:id="1">${p(r("Translations were checked by hand."))}</w:footnote></w:footnotes>`;

  const enc = (s: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`);
  const rel = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
  return zipSync({
    "[Content_Types].xml": enc(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "word/document.xml")}</Relationships>`),
    "word/_rels/document.xml.rels": enc(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rIdStyles", "styles", "styles.xml")}${rel("rIdNum", "numbering", "numbering.xml")}${rel("rIdNotes", "footnotes", "footnotes.xml")}${rel("rIdImg", "image", "media/photo.jpeg")}${rel("rIdLink", "hyperlink", "https://example.org/plan", true)}</Relationships>`,
    ),
    "word/document.xml": enc(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/styles.xml": enc(styles),
    "word/numbering.xml": enc(numbering),
    "word/footnotes.xml": enc(footnotes),
    "word/media/photo.jpeg": photo,
  });
}

/** Liberation Sans from pdfjs-dist, as the app serves it from /pdfjs/standard_fonts. */
export function liberationSans(): FontFiles {
  const dir = fileURLToPath(new URL("../../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url));
  const read = (style: string) => new Uint8Array(readFileSync(`${dir}LiberationSans-${style}.ttf`));
  return { regular: read("Regular"), bold: read("Bold"), italic: read("Italic"), boldItalic: read("BoldItalic") };
}
