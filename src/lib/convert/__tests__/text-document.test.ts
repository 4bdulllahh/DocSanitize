import { Window } from "happy-dom";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { liberationSans } from "../../office/__tests__/fixtures";
import type { Block, ParagraphBlock, TableBlock } from "../../office/flow";
import { cssColor, type ImageLoader } from "../html-blocks";
import { dataUrlBytes, decodeText, hasContent, markdownToHtml, readTextDocument, textFormatOf } from "../text-document";
import { blocksToPdf } from "../text-to-pdf";

const window = new Window();
const parseHtml = (html: string) => new window.DOMParser().parseFromString(html, "text/html") as unknown as Document;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const loaded: string[] = [];
const loadImage: ImageLoader = async (url) => {
  loaded.push(url);
  return url.startsWith("data:image/png") ? { bytes: PNG, format: "png" } : null;
};
const read = (text: string, format: "markdown" | "html" | "text", mono = false) => readTextDocument(text, format, { mono, parseHtml, loadImage });

const paragraphs = (blocks: Block[]) => blocks.filter((b): b is ParagraphBlock => b.type === "paragraph");
const textOf = (p: ParagraphBlock) => p.runs.map((r) => r.text).join("");

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? " " : "") : "")).join("").replace(/\s+/g, " "));
  }
  await task.destroy();
  return texts;
}

const MARKDOWN = `---
title: Front matter is dropped
---
# Release notes

Some **bold** and *italic* text with \`code\` and a [link](https://example.com/docs).

- First
- Second
  1. Nested one
  2. Nested two

- [x] Done task
- [ ] Open task

> Quoted words

\`\`\`
const a = 1;
	indented();
\`\`\`

| Name | Size |
| --- | --- |
| a.txt | 12 |

![Remote](https://example.com/cat.png)
![Inline](data:image/png;base64,iVBORw0KGgo=)

---

Last line.
`;

describe("Markdown to blocks", () => {
  it("keeps headings, styles, lists, quotes, code, tables and embedded pictures", async () => {
    const { blocks, linkedImages, skippedImages } = await read(MARKDOWN, "markdown");
    const ps = paragraphs(blocks);
    expect(ps.some((p) => textOf(p).includes("Front matter"))).toBe(false);
    const heading = ps.find((p) => textOf(p) === "Release notes")!;
    expect(heading.size).toBe(22);
    expect(heading.runs[0].bold).toBe(true);
    expect(blocks[blocks.indexOf(heading) + 1].type).toBe("rule");

    const body = ps.find((p) => textOf(p).startsWith("Some bold"))!;
    expect(body.runs.find((r) => r.text === "bold")?.bold).toBe(true);
    expect(body.runs.find((r) => r.text === "italic")?.italic).toBe(true);
    expect(body.runs.find((r) => r.text === "code")?.mono).toBe(true);
    expect(body.runs.find((r) => r.text === "link")?.href).toBe("https://example.com/docs");

    expect(ps.filter((p) => p.marker).map((p) => [p.marker, textOf(p), p.indent])).toEqual([
      ["•", "First", 22],
      ["•", "Second", 22],
      ["1.", "Nested one", 44],
      ["2.", "Nested two", 44],
      ["•", "[x] Done task", 22],
      ["•", "[ ] Open task", 22],
    ]);
    const quote = ps.find((p) => textOf(p) === "Quoted words")!;
    expect(quote.quote).toBe(true);

    const code = ps.filter((p) => p.shade);
    expect(code.map(textOf)).toEqual(["const a = 1;", "    indented();"]);
    expect(code.every((p) => p.runs[0].mono)).toBe(true);

    const table = blocks.find((b): b is TableBlock => b.type === "table")!;
    expect(table.rows.map((r) => [r.header, r.cells.map((c) => c.paragraphs.map(textOf).join(""))])).toEqual([
      [true, ["Name", "Size"]],
      [false, ["a.txt", "12"]],
    ]);
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(1);
    expect(linkedImages).toBe(1);
    expect(skippedImages).toBe(0);
    // Remote pictures are never handed to the loader (so never fetched).
    expect(loaded.some((u) => u.startsWith("http"))).toBe(false);
    expect(blocks.filter((b) => b.type === "rule")).toHaveLength(2);
  });

  it("typesets into a PDF with the text readable", async () => {
    const { blocks } = await read(MARKDOWN, "markdown");
    const result = await blocksToPdf(blocks, { pageSize: "a4", margins: "normal" }, liberationSans());
    expect(result.pages).toBe(1);
    const [text] = await pageTexts(result.bytes);
    expect(text).toContain("Release notes");
    expect(text).toContain("const a = 1;");
    expect(text).toContain("a.txt");
    expect(result.warnings).toEqual([]);
  });
});

describe("HTML to blocks", () => {
  it("skips scripts, styles and hidden parts, and reads colours and alignment", async () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <script>alert(1)</script>
      <p style="text-align:center">Centred &amp; <span style="color:#c00">red</span></p>
      <div hidden>Secret</div><p style="display: none">Also secret</p>
      <p>Line one<br>Line two</p>
      <ol start="3" type="a"><li>third</li><li>fourth</li></ol>
      <table><tr><th>H</th></tr><tr><td><img src="data:image/png;base64,AA=="> cell</td></tr></table>
      <img src="pictures/local.png" alt="Local picture">
    </body></html>`;
    const { blocks, linkedImages, skippedImages } = await read(html, "html");
    const texts = paragraphs(blocks).map(textOf);
    expect(texts.join("|")).not.toMatch(/alert|Secret|p\{\}|^T\|/);
    const centred = paragraphs(blocks).find((p) => textOf(p) === "Centred & red")!;
    expect(centred.align).toBe("center");
    expect(centred.runs.find((r) => r.text === "red")?.color).toBe("#cc0000");
    expect(texts).toContain("Line one");
    expect(texts).toContain("Line two");
    expect(paragraphs(blocks).find((p) => textOf(p) === "Line one")?.spaceAfter).toBe(0);
    expect(paragraphs(blocks).filter((p) => p.marker).map((p) => p.marker)).toEqual(["c.", "d."]);
    expect(texts).toContain("[Local picture]");
    expect(linkedImages).toBe(1);
    expect(skippedImages).toBe(1); // pictures can't go in table cells
  });

  it("parses CSS colours", () => {
    expect(cssColor("#abc")).toBe("#aabbcc");
    expect(cssColor("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(cssColor("red")).toBeUndefined();
  });
});

describe("plain text", () => {
  it("keeps every line, and columns in the fixed-width font", async () => {
    const { blocks } = await read("Name\tSize\r\n\r\nb.txt\t3\n", "text", true);
    expect(paragraphs(blocks).map(textOf)).toEqual(["Name    Size", " ", "b.txt   3"]);
    expect(paragraphs(blocks).every((p) => p.runs[0].mono)).toBe(true);
    expect(hasContent(blocks)).toBe(true);
    expect(hasContent((await read("\n\n", "text")).blocks)).toBe(false);
  });

  it("decodes UTF-8, UTF-16 and older Windows text", () => {
    expect(decodeText(new TextEncoder().encode("café"))).toBe("café");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });

  it("knows formats by extension and reads data URLs", () => {
    expect(textFormatOf("README.md")).toBe("markdown");
    expect(textFormatOf("page.HTM")).toBe("html");
    expect(textFormatOf("notes.txt")).toBe("text");
    expect(dataUrlBytes("data:image/png;base64,AAEC")).toEqual({ type: "image/png", bytes: new Uint8Array([0, 1, 2]) });
    expect(dataUrlBytes("https://example.com/a.png")).toBeNull();
    expect(markdownToHtml("~~gone~~")).toContain("<del>gone</del>");
  });
});
