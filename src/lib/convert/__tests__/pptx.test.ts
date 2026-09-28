import { strFromU8, unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { liberationSans } from "../../office/__tests__/fixtures";
import { contentTypes, relationships, XML_HEADER, zipPackage } from "../../office/ooxml";
import { readPresentation } from "../pptx-model";
import { pptxToPdf } from "../pptx-to-pdf";
import { writePptx } from "../pptx-write";

const fonts = liberationSans();
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const T = "application/vnd.openxmlformats-officedocument.presentationml";
// A 1 × 1 red PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${x * 12700}" y="${y * 12700}"/><a:ext cx="${w * 12700}" cy="${h * 12700}"/></a:xfrm>`;
const tree = (content: string) => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree>`;
const para = (text: string, rPr = "") => `<a:p><a:r><a:rPr lang="en-US"${rPr}/><a:t>${text}</a:t></a:r></a:p>`;
const placeholder = (type: string, body: string, pos = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${type}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${type === "body" ? ' idx="1"' : ""}/></p:nvPr></p:nvSpPr><p:spPr>${pos}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;

function samplePptx(): Uint8Array {
  const theme = `${XML_HEADER}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements><a:clrScheme name="C"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fmtScheme name="F"><a:fillStyleLst/><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const master =
    `${XML_HEADER}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef></p:bg>` +
    tree(
      placeholder("title", "", xfrm(40, 20, 640, 60)) +
        placeholder("body", "", xfrm(40, 100, 640, 380)) +
        // A decoration on every slide: a filled bar with a footer word.
        `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 500, 720, 40)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${para("Confidential")}</p:txBody></p:sp>`,
    ) +
    `</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `${XML_HEADER}<p:sldLayout ${NS}><p:cSld>${tree(placeholder("title", "", ""))}</p:cSld></p:sldLayout>`;
  const slide1 =
    `${XML_HEADER}<p:sld ${NS}><p:cSld>` +
    tree(
      placeholder("title", para("Quarterly results")) +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${para("Revenue up")}${para("Costs down")}<a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rIdLink"/></a:rPr><a:t>Details online</a:t></a:r></a:p></p:txBody></p:sp>` +
        `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${400 * 12700}" y="${300 * 12700}"/><a:ext cx="${200 * 12700}" cy="${100 * 12700}"/><a:chOff x="0" y="0"/><a:chExt cx="${100 * 12700}" cy="${50 * 12700}"/></a:xfrm></p:grpSpPr>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Oval"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 50)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent2"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent6"/></a:fillRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400"/><a:t>Grouped</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>` +
        `<p:pic><p:nvPicPr><p:cNvPr id="6" name="Pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/><a:srcRect l="10000"/></p:blipFill><p:spPr>${xfrm(600, 20, 80, 80)}</p:spPr></p:pic>` +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${40 * 12700}" y="${380 * 12700}"/><a:ext cx="${300 * 12700}" cy="${60 * 12700}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="${150 * 12700}"/><a:gridCol w="${150 * 12700}"/></a:tblGrid>` +
        `<a:tr h="${30 * 12700}"><a:tc><a:txBody><a:bodyPr/>${para("Region", ' sz="1200"')}</a:txBody><a:tcPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/>${para("Sales", ' sz="1200"')}</a:txBody><a:tcPr/></a:tc></a:tr>` +
        `<a:tr h="${30 * 12700}"><a:tc gridSpan="2"><a:txBody><a:bodyPr/>${para("All regions together", ' sz="1200"')}</a:txBody><a:tcPr/></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="12700" cy="12700"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`,
    ) +
    `</p:cSld></p:sld>`;
  const slide2 = `${XML_HEADER}<p:sld ${NS} show="0"><p:cSld>${tree(placeholder("title", para("Hidden backup slide")))}</p:cSld></p:sld>`;
  const rel = (id: string, type: string, target: string, external = false) => ({ id, type, target, external });
  return zipPackage({
    "[Content_Types].xml": contentTypes(
      { rels: "application/vnd.openxmlformats-package.relationships+xml", xml: "application/xml", png: "image/png" },
      { "/ppt/presentation.xml": `${T}.presentation.main+xml`, "/ppt/slides/slide1.xml": `${T}.slide+xml`, "/ppt/slides/slide2.xml": `${T}.slide+xml` },
    ),
    "_rels/.rels": relationships([rel("rId1", "officeDocument", "ppt/presentation.xml")]),
    "ppt/presentation.xml": `${XML_HEADER}<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="${720 * 12700}" cy="${540 * 12700}"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relationships([rel("rId2", "slide", "slides/slide1.xml"), rel("rId3", "slide", "slides/slide2.xml")]),
    "ppt/slides/slide1.xml": slide1,
    "ppt/slides/_rels/slide1.xml.rels": relationships([rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), rel("rIdImg", "image", "../media/red.png"), rel("rIdLink", "hyperlink", "https://example.com/q3", true)]),
    "ppt/slides/slide2.xml": slide2,
    "ppt/slides/_rels/slide2.xml.rels": relationships([rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]),
    "ppt/slideLayouts/slideLayout1.xml": layout,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]),
    "ppt/slideMasters/slideMaster1.xml": master,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), rel("rId2", "theme", "../theme/theme1.xml")]),
    "ppt/theme/theme1.xml": theme,
    "ppt/media/red.png": PNG,
  });
}

async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const doc = await task.promise;
  const pages: { width: number; height: number; items: { str: string; x: number; y: number; size: number }[] }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: viewport.width,
      height: viewport.height,
      items: content.items.filter((it) => "str" in it && it.str.trim()).map((it) => {
        const item = it as { str: string; transform: number[] };
        return { str: item.str, x: item.transform[4], y: viewport.height - item.transform[5], size: Math.hypot(item.transform[2], item.transform[3]) };
      }),
    });
  }
  await task.destroy();
  return pages;
}

describe("PowerPoint model", () => {
  it("resolves placeholders, theme colours, bullets, groups and tables", () => {
    const presentation = readPresentation(samplePptx());
    expect([presentation.width, presentation.height]).toEqual([720, 540]);
    const [slide, hidden] = presentation.slides;
    expect(hidden.hidden).toBe(true);
    expect(slide.background).toEqual({ color: { rgb: "#e7e6e6", alpha: 1 } });

    const shapes = slide.shapes;
    // The master's bar is drawn first, behind the slide's own shapes.
    const bar = shapes[0];
    expect(bar.kind === "shape" && bar.fill?.rgb).toBe("#4472c4");
    const title = shapes.find((s) => s.kind === "shape" && s.text?.paragraphs[0].runs[0]?.text === "Quarterly results");
    expect(title?.kind === "shape" && title.box).toEqual({ x: 40, y: 20, width: 640, height: 60 });
    const run = title?.kind === "shape" ? title.text!.paragraphs[0].runs[0] : null;
    expect([run?.size, run?.bold, run?.color.rgb]).toEqual([40, true, "#1f3864"]);
    expect(title?.kind === "shape" && title.text?.paragraphs[0].align).toBe("center");

    const body = shapes.find((s) => s.kind === "shape" && s.text?.paragraphs[0].runs[0]?.text === "Revenue up");
    const paragraphs = body?.kind === "shape" ? body.text!.paragraphs : [];
    expect(paragraphs.map((p) => [p.bullet, p.marginLeft, p.runs[0].size])).toEqual([
      ["•", 18, 24],
      ["•", 18, 24],
      ["•", 18, 24],
    ]);
    expect(paragraphs[2].runs[0].href).toBe("https://example.com/q3");

    const oval = shapes.find((s) => s.kind === "shape" && "preset" in s.geometry && s.geometry.preset === "ellipse");
    expect(oval?.kind === "shape" && [oval.box, oval.fill?.rgb, oval.line?.color.rgb, oval.text?.paragraphs[0].runs[0].color.rgb]).toEqual([
      { x: 400, y: 300, width: 200, height: 100 },
      "#70ad47",
      "#ed7d31",
      "#ffffff",
    ]);
    const picture = shapes.find((s) => s.kind === "picture");
    expect(picture?.kind === "picture" && [picture.image, picture.crop.left]).toEqual(["ppt/media/red.png", 0.1]);
    const table = shapes.find((s) => s.kind === "table");
    expect(table?.kind === "table" && table.rows.map((r) => r.cells.map((c) => c.colSpan))).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(presentation.skipped.charts).toBe(1);
  });
});

describe("PowerPoint to PDF", () => {
  it("draws each visible slide at the slide size with its text", async () => {
    const result = await pptxToPdf(samplePptx(), { hiddenSlides: false }, fonts);
    expect(result.pages).toBe(1);
    expect(result.warnings).toEqual(["1 hidden slide was left out.", "1 chart can't be drawn and is left out."]);
    const [page] = await pdfText(result.bytes);
    expect([page.width, page.height]).toEqual([720, 540]);
    const text = page.items.map((i) => i.str).join(" ");
    for (const words of ["Quarterly results", "Revenue up", "Costs down", "Details online", "Grouped", "Region", "All regions together", "Confidential"]) expect(text).toContain(words);
    const title = page.items.find((i) => i.str === "Quarterly results")!;
    expect(title.size).toBeCloseTo(40);
    // Centred in its 640 pt box starting at 40.
    expect(Math.abs(title.x + (title.str.length * 40 * 0.55) / 2 - 360)).toBeLessThan(60);
    // The bullet hangs in the margin (marL 18, indent -18); pdf.js reads it with its text.
    const bullet = page.items.find((i) => i.str === "• Revenue up")!;
    expect(bullet.x).toBeCloseTo(40 + 7.2, 0);
    const withHidden = await pptxToPdf(samplePptx(), { hiddenSlides: true }, fonts);
    expect(withHidden.pages).toBe(2);
  });

  it("rejects old and protected files clearly", async () => {
    await expect(pptxToPdf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), { hiddenSlides: false }, fonts, undefined, "old.ppt")).rejects.toThrow(/old \.ppt format/);
  });
});

describe("PDF to PowerPoint", () => {
  it("writes a package PowerPoint can open, with no document properties", () => {
    const bytes = writePptx([
      { width: 612, height: 792, picture: { bytes: PNG, format: "png" }, texts: [{ x: 72, y: 72, width: 200, height: 30, pitch: 14, color: "#112233", lines: [{ text: "Hello & welcome", size: 12, bold: true, italic: false, font: "sans" }] }] },
      { width: 612, height: 792, picture: null, texts: [] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)[0]).toBe("[Content_Types].xml");
    expect(Object.keys(files).some((f) => f.startsWith("docProps"))).toBe(false);
    expect(Object.keys(files)).toContain("ppt/media/page1.png");
    const slide = strFromU8(files["ppt/slides/slide1.xml"]);
    expect(slide).toContain("<a:t>Hello &amp; welcome</a:t>");
    expect(slide).toContain('sz="1200" b="1"');
    expect(strFromU8(files["ppt/presentation.xml"])).toContain(`<p:sldSz cx="${612 * 12700}" cy="${792 * 12700}"/>`);
  });

  it("reads back through PowerPoint to PDF with the text where it was", async () => {
    const pptx = writePptx([{ width: 612, height: 792, picture: { bytes: PNG, format: "png" }, texts: [{ x: 72, y: 100, width: 300, height: 40, pitch: 16, color: "#000000", lines: [{ text: "First line", size: 14, bold: false, italic: false, font: "sans" }, { text: "Second line", size: 14, bold: false, italic: true, font: "serif" }] }] }]);
    const result = await pptxToPdf(pptx, { hiddenSlides: false }, fonts);
    const [page] = await pdfText(result.bytes);
    expect([page.width, page.height]).toEqual([612, 792]);
    const first = page.items.find((i) => i.str === "First line")!;
    const second = page.items.find((i) => i.str === "Second line")!;
    expect(first.x).toBeCloseTo(72, 0);
    expect(second.y - first.y).toBeCloseTo(16, 0);
    expect(first.y).toBeGreaterThan(100);
    expect(first.y).toBeLessThan(120);
  });
});
