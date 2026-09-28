import { contentTypes, relationships, XML_HEADER, xmlText, zipPackage } from "../office/ooxml";
import type { FontFamily } from "../pdf/edit/types";

/*
 * PDF -> PowerPoint, the writing half: a hand-written .pptx with one slide per page. Each slide
 * has a picture of the page (with its text taken out, in "editable" mode) and text boxes where
 * the text was. Like the other Office writers, no docProps: no author, company or dates.
 */

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface SlideLine {
  text: string;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  font: FontFamily;
}

export interface SlideText {
  /** Top-left and size of the text, in points on the page. */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: SlideLine[];
  /** Baseline to baseline, points. */
  pitch: number;
  color: string;
}

export interface SlideInput {
  /** Page size in points. */
  width: number;
  height: number;
  picture: { bytes: Uint8Array; format: "jpeg" | "png" } | null;
  texts: SlideText[];
}

const EMU = 12700; // per point
const emu = (points: number) => Math.round(points * EMU);
// PowerPoint's limits: 1 to 56 inches.
const clampSlide = (n: number) => Math.min(51206400, Math.max(914400, n));
const TYPEFACES: Record<FontFamily, string> = { sans: "Arial", serif: "Times New Roman", mono: "Courier New" };

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const TYPE = "application/vnd.openxmlformats-officedocument.presentationml";

const THEME =
  `${XML_HEADER}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements>` +
  `<a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="263A81"/></a:accent1><a:accent2><a:srgbClr val="C2410C"/></a:accent2><a:accent3><a:srgbClr val="15803D"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="0E7490"/></a:accent5><a:accent6><a:srgbClr val="B45309"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="1D4ED8"/></a:hlink><a:folHlink><a:srgbClr val="6D28D9"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Office"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst>` +
  `<a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join("")}</a:lnStyleLst>` +
  `<a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst>` +
  `<a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme>` +
  `</a:themeElements></a:theme>`;

const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const COLOR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const MASTER =
  `${XML_HEADER}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
  `<p:clrMap ${COLOR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${XML_HEADER}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function textBox(text: SlideText, id: number, scale: number, dx: number, dy: number): string {
  const color = text.color.replace("#", "").toUpperCase();
  const paragraphs = text.lines
    .map((line) => {
      const size = Math.max(100, Math.min(400000, Math.round(line.size * scale * 100)));
      const props = `lang="en-US" sz="${size}" b="${line.bold ? 1 : 0}" i="${line.italic ? 1 : 0}" dirty="0"`;
      return (
        `<a:p><a:pPr><a:lnSpc><a:spcPts val="${Math.max(100, Math.round(text.pitch * scale * 100))}"/></a:lnSpc></a:pPr>` +
        `<a:r><a:rPr ${props}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${TYPEFACES[line.font]}"/><a:cs typeface="${TYPEFACES[line.font]}"/></a:rPr><a:t>${xmlText(line.text)}</a:t></a:r></a:p>`
      );
    })
    .join("");
  // Text boxes don't wrap, so lines break where they did on the page.
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id - 2}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${emu(dx + text.x * scale)}" y="${emu(dy + text.y * scale)}"/><a:ext cx="${Math.max(1, emu(text.width * scale))}" cy="${Math.max(1, emu(text.height * scale))}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

function slideXml(slide: SlideInput, size: { cx: number; cy: number }): string {
  // Pages of another size are scaled to fit the slide, centred.
  const scale = Math.min(size.cx / emu(slide.width), size.cy / emu(slide.height));
  const [w, h] = [slide.width * scale, slide.height * scale];
  const [dx, dy] = [(size.cx / EMU - w) / 2, (size.cy / EMU - h) / 2];
  const picture = slide.picture
    ? `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page" descr=""/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${emu(dx)}" y="${emu(dy)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    : "";
  const texts = slide.texts.map((t, i) => textBox(t, i + 3, scale, dx, dy)).join("");
  return `${XML_HEADER}<p:sld ${NS}><p:cSld><p:spTree>${EMPTY_TREE}${picture}${texts}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/** Write the slides as a .pptx. The slide size is the first page's. */
export function writePptx(slides: SlideInput[]): Uint8Array {
  const first = slides[0] ?? { width: 720, height: 405 };
  const size = { cx: clampSlide(emu(first.width)), cy: clampSlide(emu(first.height)) };
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: Record<string, string> = {
    "/ppt/presentation.xml": `${TYPE}.presentation.main+xml`,
    "/ppt/slideMasters/slideMaster1.xml": `${TYPE}.slideMaster+xml`,
    "/ppt/slideLayouts/slideLayout1.xml": `${TYPE}.slideLayout+xml`,
    "/ppt/theme/theme1.xml": "application/vnd.openxmlformats-officedocument.theme+xml",
    "/ppt/presProps.xml": `${TYPE}.presProps+xml`,
    "/ppt/viewProps.xml": `${TYPE}.viewProps+xml`,
    "/ppt/tableStyles.xml": `${TYPE}.tableStyles+xml`,
  };
  slides.forEach((slide, i) => {
    const n = i + 1;
    overrides[`/ppt/slides/slide${n}.xml`] = `${TYPE}.slide+xml`;
    parts[`ppt/slides/slide${n}.xml`] = slideXml(slide, size);
    const rels = [{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }];
    if (slide.picture) {
      const name = `page${n}.${slide.picture.format === "jpeg" ? "jpeg" : "png"}`;
      parts[`ppt/media/${name}`] = slide.picture.bytes;
      rels.push({ id: "rId2", type: "image", target: `../media/${name}` });
    }
    parts[`ppt/slides/_rels/slide${n}.xml.rels`] = relationships(rels);
  });

  const presentationRels = [
    { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    { id: "rId2", type: "theme", target: "theme/theme1.xml" },
    { id: "rId3", type: "presProps", target: "presProps.xml" },
    { id: "rId4", type: "viewProps", target: "viewProps.xml" },
    { id: "rId5", type: "tableStyles", target: "tableStyles.xml" },
    ...slides.map((_, i) => ({ id: `rId${10 + i}`, type: "slide", target: `slides/slide${i + 1}.xml` })),
  ];
  const ordered: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": contentTypes({ rels: "application/vnd.openxmlformats-package.relationships+xml", xml: "application/xml", jpeg: "image/jpeg", png: "image/png" }, overrides),
    "_rels/.rels": relationships([{ id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" }]),
    "ppt/presentation.xml":
      `${XML_HEADER}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join("")}</p:sldIdLst>` +
      `<p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relationships(presentationRels),
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
    "ppt/theme/theme1.xml": THEME,
    "ppt/presProps.xml": `${XML_HEADER}<p:presentationPr ${NS}/>`,
    "ppt/viewProps.xml": `${XML_HEADER}<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
    "ppt/tableStyles.xml": `${XML_HEADER}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    ...parts,
  };
  return zipPackage(ordered);
}

