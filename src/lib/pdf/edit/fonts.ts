import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFObject, type PDFPage } from "@cantoo/pdf-lib";
import { Encodings, Font, type IFontNames } from "@cantoo/pdf-lib/standard-fonts";
import type { FontMetrics } from "./content";

/*
 * Glyph widths for the fonts a page's content uses, so the text remover can follow the text
 * position exactly. Simple fonts use /Widths (or the standard 14 metrics), composite fonts with
 * Identity encoding use /W; anything else is reported as unknown and left alone.
 */

const STANDARD: Record<string, IFontNames> = {
  helvetica: "Helvetica",
  "helvetica-bold": "Helvetica-Bold",
  "helvetica-oblique": "Helvetica-Oblique",
  "helvetica-boldoblique": "Helvetica-BoldOblique",
  arial: "Helvetica",
  "arial,bold": "Helvetica-Bold",
  "arial,italic": "Helvetica-Oblique",
  "arial,bolditalic": "Helvetica-BoldOblique",
  arialmt: "Helvetica",
  "arial-boldmt": "Helvetica-Bold",
  "times-roman": "Times-Roman",
  "times-bold": "Times-Bold",
  "times-italic": "Times-Italic",
  "times-bolditalic": "Times-BoldItalic",
  timesnewroman: "Times-Roman",
  timesnewromanpsmt: "Times-Roman",
  "timesnewroman,bold": "Times-Bold",
  courier: "Courier",
  "courier-bold": "Courier-Bold",
  "courier-oblique": "Courier-Oblique",
  "courier-boldoblique": "Courier-BoldOblique",
  couriernew: "Courier",
  symbol: "Symbol",
  zapfdingbats: "ZapfDingbats",
};

let winAnsiNames: Map<number, string> | null = null;
/** Character code -> glyph name in WinAnsiEncoding (used for standard fonts without /Widths). */
function codeToName(): Map<number, string> {
  if (winAnsiNames) return winAnsiNames;
  winAnsiNames = new Map();
  for (const cp of Encodings.WinAnsi.supportedCodePoints) {
    const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
    if (!winAnsiNames.has(code)) winAnsiNames.set(code, name);
  }
  return winAnsiNames;
}

const numberOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

function simpleFont(dict: PDFDict): FontMetrics | null {
  const context = dict.context;
  const widths = dict.lookup(PDFName.of("Widths"));
  const first = numberOf(dict.lookup(PDFName.of("FirstChar"))) ?? 0;
  const descriptor = dict.lookup(PDFName.of("FontDescriptor"));
  const missing = descriptor instanceof PDFDict ? (numberOf(descriptor.lookup(PDFName.of("MissingWidth"))) ?? 0) : 0;
  // Type 3 widths are in glyph space; FontMatrix scales them to text space.
  const matrix = dict.lookup(PDFName.of("FontMatrix"));
  const unit = matrix instanceof PDFArray ? (numberOf(context.lookup(matrix.get(0))) ?? 0.001) * 1000 : 1;

  if (widths instanceof PDFArray) {
    const table = widths.asArray().map((w) => (numberOf(context.lookup(w)) ?? missing) * unit);
    return {
      glyphs: (bytes) => Array.from(bytes, (code) => ({ width: table[code - first] ?? missing * unit, space: code === 32 })),
    };
  }

  const base = dict.lookup(PDFName.of("BaseFont"));
  const name = base instanceof PDFName ? base.decodeText().replace(/^[A-Z]{6}\+/, "").toLowerCase() : "";
  const standard = STANDARD[name];
  if (!standard) return null;
  const font = Font.load(standard);
  const names = codeToName();
  const cache = new Map<number, number>();
  return {
    glyphs: (bytes) =>
      Array.from(bytes, (code) => {
        let width = cache.get(code);
        if (width === undefined) {
          const glyph = names.get(code);
          width = (glyph && font.getWidthOfGlyph(glyph)) || 0;
          cache.set(code, width);
        }
        return { width, space: code === 32 };
      }),
  };
}

function compositeFont(dict: PDFDict): FontMetrics | null {
  const encoding = dict.lookup(PDFName.of("Encoding"));
  if (!(encoding instanceof PDFName) || !["Identity-H", "Identity-V"].includes(encoding.decodeText())) return null;
  const descendants = dict.lookup(PDFName.of("DescendantFonts"));
  const cid = descendants instanceof PDFArray ? dict.context.lookup(descendants.get(0)) : undefined;
  if (!(cid instanceof PDFDict)) return null;
  const context = dict.context;
  const fallback = numberOf(cid.lookup(PDFName.of("DW"))) ?? 1000;
  const widths = new Map<number, number>();
  const w = cid.lookup(PDFName.of("W"));
  if (w instanceof PDFArray) {
    const items = w.asArray().map((o) => context.lookup(o));
    for (let i = 0; i < items.length; ) {
      const start = numberOf(items[i]);
      const next = items[i + 1];
      if (start === undefined) break;
      if (next instanceof PDFArray) {
        next.asArray().forEach((v, k) => widths.set(start + k, numberOf(context.lookup(v)) ?? fallback));
        i += 2;
      } else {
        const end = numberOf(next) ?? start;
        const value = numberOf(items[i + 2]) ?? fallback;
        for (let c = start; c <= end && c - start < 65536; c++) widths.set(c, value);
        i += 3;
      }
    }
  }
  return {
    glyphs: (bytes) => {
      const out: { width: number; space: boolean }[] = [];
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        out.push({ width: widths.get(code) ?? fallback, space: false });
      }
      return out;
    },
  };
}

/** Metrics lookup for the fonts named in a page's resources. */
export function pageFontMetrics(page: PDFPage): (name: string) => FontMetrics | null {
  page.node.normalize();
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of("Font"));
  const cache = new Map<string, FontMetrics | null>();
  return (name) => {
    if (cache.has(name)) return cache.get(name)!;
    const dict = fonts instanceof PDFDict ? fonts.lookup(PDFName.of(name)) : undefined;
    let metrics: FontMetrics | null = null;
    if (dict instanceof PDFDict) {
      const subtype = dict.lookup(PDFName.of("Subtype"));
      metrics = subtype instanceof PDFName && subtype.decodeText() === "Type0" ? compositeFont(dict) : simpleFont(dict);
    }
    cache.set(name, metrics);
    return metrics;
  };
}
