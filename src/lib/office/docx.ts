import { contentTypes, OFFICE_DOCUMENT_REL, relationships, XML_HEADER, xmlText, zipPackage } from "./ooxml";

export interface DocRun {
  /** May contain tabs ("\t"). */
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Font size in points. */
  size?: number;
}

export type DocStyle = "Heading1" | "Heading2" | "Heading3" | "ListParagraph";

export interface DocParagraph {
  runs: DocRun[];
  style?: DocStyle;
  align?: "left" | "center" | "right";
  /** Left indent in points. */
  indent?: number;
  pageBreakBefore?: boolean;
}

export interface DocxPage {
  /** Page size in points. */
  width: number;
  height: number;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const twips = (points: number) => Math.round(points * 20);
const BODY_FONT = "Calibri";

function runXml(run: DocRun): string {
  const props =
    (run.bold ? "<w:b/>" : "") +
    (run.italic ? "<w:i/>" : "") +
    (run.size ? `<w:sz w:val="${Math.round(run.size * 2)}"/><w:szCs w:val="${Math.round(run.size * 2)}"/>` : "");
  const content = run.text
    .split("\t")
    .map((part) => (part ? `<w:t xml:space="preserve">${xmlText(part)}</w:t>` : ""))
    .join("<w:tab/>");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${content}</w:r>`;
}

function paragraphXml(p: DocParagraph): string {
  // Child order follows the schema: pStyle, pageBreakBefore, ind, jc.
  const props =
    (p.style ? `<w:pStyle w:val="${p.style}"/>` : "") +
    (p.pageBreakBefore ? "<w:pageBreakBefore/>" : "") +
    (p.indent ? `<w:ind w:left="${twips(p.indent)}"/>` : "") +
    (p.align && p.align !== "left" ? `<w:jc w:val="${p.align}"/>` : "");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${p.runs.map(runXml).join("")}</w:p>`;
}

function headingStyle(level: 1 | 2 | 3, size: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr></w:style>`
  );
}

const STYLES =
  XML_HEADER +
  `<w:styles ${W}>` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${BODY_FONT}" w:hAnsi="${BODY_FONT}" w:eastAsia="${BODY_FONT}" w:cs="${BODY_FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  headingStyle(1, 20) +
  headingStyle(2, 16) +
  headingStyle(3, 13) +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>` +
  "</w:styles>";

/** A minimal .docx: document, styles, relationships. No docProps, so no author or dates. */
export function writeDocx(paragraphs: DocParagraph[], page: DocxPage): Uint8Array {
  const landscape = page.width > page.height;
  const margin = twips(Math.min(72, page.width / 8, page.height / 8));
  const body =
    paragraphs.map(paragraphXml).join("") +
    `<w:sectPr><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"${landscape ? ' w:orient="landscape"' : ""}/>` +
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  return zipPackage({
    "[Content_Types].xml": contentTypes(
      { rels: "application/vnd.openxmlformats-package.relationships+xml", xml: "application/xml" },
      {
        "/word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "/word/styles.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
      },
    ),
    "_rels/.rels": relationships([{ ...OFFICE_DOCUMENT_REL, target: "word/document.xml" }]),
    "word/_rels/document.xml.rels": relationships([{ id: "rId1", type: "styles", target: "styles.xml" }]),
    "word/document.xml": `${XML_HEADER}<w:document ${W}><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": STYLES,
  });
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
