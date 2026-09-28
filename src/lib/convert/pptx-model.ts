import { strFromU8, unzipSync } from "fflate";
import { ProcessingError } from "../errors";
import { resolveTarget } from "../scan/office-inspect";
import { attr, parseXml, textOf, type XmlElement, type XmlNode } from "../scan/xml-tree";
import { msg } from "@/i18n/msg";

/*
 * PowerPoint -> PDF, the reading half: a .pptx is read into a simple model of what each slide
 * shows (positions in points), with the inheritance PowerPoint applies worked out: placeholders
 * take their position and text styles from the slide layout and master, colours come from the
 * theme through the colour map, and master and layout decorations are drawn behind each slide.
 */

export interface Color {
  /** "#rrggbb" */
  rgb: string;
  alpha: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Line {
  color: Color;
  /** Points. */
  width: number;
  dash: boolean;
}

export interface Run {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Color;
  mono: boolean;
  script?: "super" | "sub";
  href?: string;
}

export interface Paragraph {
  runs: Run[];
  align: "left" | "center" | "right" | "justify";
  /** Left margin and first-line indent, points. */
  marginLeft: number;
  indent: number;
  bullet: string | null;
  /** Line spacing: a multiple of single spacing, or exact points. */
  lineSpacing: { percent: number } | { points: number };
  spaceBefore: number;
  spaceAfter: number;
  /** Size of an empty paragraph's line. */
  size: number;
}

export interface TextBody {
  insets: { left: number; top: number; right: number; bottom: number };
  anchor: "top" | "middle" | "bottom";
  wrap: boolean;
  /** Extra rotation of the text (vertical text), degrees clockwise. */
  rotate: number;
  paragraphs: Paragraph[];
}

export type Geometry = { preset: string; adjust: Record<string, number> } | { paths: { width: number; height: number; commands: PathCommand[]; fill: boolean; stroke: boolean }[] };
export type PathCommand = { op: "M" | "L"; x: number; y: number } | { op: "C"; points: number[] } | { op: "Z" };

interface Placed {
  box: Box;
  /** Degrees clockwise. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export type Shape =
  | (Placed & { kind: "shape"; geometry: Geometry; fill: Color | null; image: string | null; line: Line | null; text: TextBody | null })
  | (Placed & { kind: "picture"; image: string; crop: { left: number; top: number; right: number; bottom: number } })
  | { kind: "table"; box: Box; columns: number[]; rows: { height: number; cells: TableCell[] }[] };

export interface TableCell {
  /** Grid columns and rows it covers; 0 for cells merged into another. */
  colSpan: number;
  rowSpan: number;
  fill: Color | null;
  text: TextBody;
}

export interface Slide {
  number: number;
  hidden: boolean;
  background: { color: Color } | { image: string } | null;
  shapes: Shape[];
}

export interface Presentation {
  width: number;
  height: number;
  slides: Slide[];
  /** Pictures by part name. */
  media: Map<string, Uint8Array>;
  /** Charts, diagrams and other content that can't be drawn. */
  skipped: { charts: number; diagrams: number; media: number };
}

// ---------------------------------------------------------------------------- XML helpers

const EMU = 12700;
const pt = (emu: string | number | undefined, fallback = 0) => {
  const n = Number(emu);
  return Number.isFinite(n) && emu !== undefined && emu !== "" ? n / EMU : fallback;
};
const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
};
const kids = (el: XmlElement | undefined | null): XmlElement[] => (el ? el.children.filter((c): c is XmlElement => c.type === "element") : []);
const child = (el: XmlElement | undefined | null, name: string) => kids(el).find((c) => c.name === name);
const path = (el: XmlElement | undefined | null, ...names: string[]) => names.reduce<XmlElement | undefined>((at, name) => child(at, name), el ?? undefined);
const rootOf = (nodes: XmlNode[]) => nodes.find((n): n is XmlElement => n.type === "element");
const bool = (value: string | undefined) => value === "1" || value === "true";
/** An attribute of an element that may be missing. */
const at = (el: XmlElement | undefined, name: string) => (el ? attr(el, name) : undefined);
const schemeColor = (name: string): XmlElement => ({ type: "element", name: "a:schemeClr", attrs: ` val="${name}"`, children: [], selfClosing: true });

// ---------------------------------------------------------------------------- Colours

type Theme = Record<string, string>;
type ColorMap = Record<string, string>;

const PRESET_COLORS: Record<string, string> = { black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", gray: "808080", grey: "808080" };

function hsl(rgb: number[]): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): number[] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

interface Palette {
  theme: Theme;
  map: ColorMap;
  /** The colour "phClr" stands for (inside theme style references). */
  placeholder?: Color;
}

/** A DrawingML colour element (srgbClr, schemeClr, …) with its modifiers. */
function readColor(el: XmlElement | undefined, palette: Palette): Color | null {
  if (!el) return null;
  let hex: string | undefined;
  let alpha = 1;
  switch (el.name) {
    case "a:srgbClr":
      hex = attr(el, "val");
      break;
    case "a:sysClr":
      hex = attr(el, "lastClr") ?? (attr(el, "val") === "window" ? "ffffff" : "000000");
      break;
    case "a:prstClr":
      hex = PRESET_COLORS[attr(el, "val") ?? ""] ?? "000000";
      break;
    case "a:scrgbClr":
      hex = ["r", "g", "b"].map((k) => Math.round(Math.min(1, num(attr(el, k), 0) / 100000) * 255).toString(16).padStart(2, "0")).join("");
      break;
    case "a:schemeClr": {
      const name = attr(el, "val") ?? "tx1";
      if (name === "phClr") {
        if (!palette.placeholder) return null;
        hex = palette.placeholder.rgb.slice(1);
        alpha = palette.placeholder.alpha;
      } else {
        hex = palette.theme[palette.map[name] ?? name];
      }
      break;
    }
    default:
      return null;
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) hex = "000000";
  let rgb = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16) / 255);
  for (const mod of kids(el)) {
    const v = num(attr(mod, "val"), 100000) / 100000;
    if (mod.name === "a:alpha") alpha *= v;
    else if (mod.name === "a:lumMod" || mod.name === "a:lumOff") {
      const [h, s, l] = hsl(rgb);
      rgb = fromHsl([h, s, Math.min(1, Math.max(0, mod.name === "a:lumMod" ? l * v : l + v))]);
    } else if (mod.name === "a:tint") rgb = rgb.map((c) => c * v + (1 - v));
    else if (mod.name === "a:shade") rgb = rgb.map((c) => c * v);
  }
  return { rgb: `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")}`, alpha };
}

/** The colour inside a fill-like element (solidFill, a gradient's first stop, a pattern's foreground). */
function fillColor(el: XmlElement | undefined, palette: Palette): Color | null {
  if (!el) return null;
  if (el.name === "a:solidFill") return readColor(kids(el)[0], palette);
  if (el.name === "a:gradFill") {
    const stops = kids(child(el, "a:gsLst"));
    // The middle stop is closest to how the gradient looks overall.
    return readColor(kids(stops[Math.floor((stops.length - 1) / 2)])[0], palette);
  }
  if (el.name === "a:pattFill") return readColor(kids(child(el, "a:fgClr"))[0], palette);
  return null;
}

const FILLS = ["a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill", "a:grpFill"];
const fillOf = (spPr: XmlElement | undefined) => kids(spPr).find((c) => FILLS.includes(c.name));

// ---------------------------------------------------------------------------- Package

interface Part {
  path: string;
  root: XmlElement;
  rels: Map<string, { type: string; target: string; external: boolean }>;
}

class Package {
  files: Record<string, Uint8Array>;
  cache = new Map<string, Part | null>();
  constructor(bytes: Uint8Array) {
    try {
      this.files = unzipSync(bytes);
    } catch {
      throw new ProcessingError("This file couldn't be read as a PowerPoint presentation.", "corrupt");
    }
  }

  part(path: string): Part | null {
    if (this.cache.has(path)) return this.cache.get(path)!;
    const bytes = this.files[path];
    let part: Part | null = null;
    if (bytes) {
      const root = rootOf(parseXml(strFromU8(bytes)));
      if (root) {
        const dir = path.slice(0, path.lastIndexOf("/") + 1);
        const relsBytes = this.files[`${dir}_rels/${path.slice(dir.length)}.rels`];
        const rels = new Map<string, { type: string; target: string; external: boolean }>();
        if (relsBytes) {
          for (const rel of kids(rootOf(parseXml(strFromU8(relsBytes))))) {
            const external = attr(rel, "TargetMode") === "External";
            const target = attr(rel, "Target") ?? "";
            rels.set(attr(rel, "Id") ?? "", { type: (attr(rel, "Type") ?? "").split("/").pop()!, target: external ? target : resolveTarget(dir, target), external });
          }
        }
        part = { path, root, rels };
      }
    }
    this.cache.set(path, part);
    return part;
  }

  related(part: Part, type: string): Part | null {
    for (const rel of part.rels.values()) if (rel.type === type && !rel.external) return this.part(rel.target);
    return null;
  }
}

// ---------------------------------------------------------------------------- Text styles

/** Paragraph-level properties from a list style (lstStyle, txStyles/*Style, defaultTextStyle). */
type LevelSource = XmlElement | undefined;

interface TextContext {
  palette: Palette;
  /** List styles from the most specific to the most general. */
  styles: LevelSource[];
  /** Default text colour from the shape's style (fontRef). */
  fontColor: Color | null;
  rels: Part["rels"];
  slideNumber: number;
}

function levelChain(styles: LevelSource[], level: number, pPr: XmlElement | undefined): XmlElement[] {
  const chain: XmlElement[] = [];
  if (pPr) chain.push(pPr);
  for (const style of styles) {
    const lvl = child(style, `a:lvl${level + 1}pPr`);
    if (lvl) chain.push(lvl);
  }
  return chain;
}

const firstAttr = (chain: XmlElement[], name: string) => {
  for (const el of chain) {
    const v = attr(el, name);
    if (v !== undefined) return v;
  }
  return undefined;
};
const firstChild = (chain: XmlElement[], ...names: string[]) => {
  for (const el of chain) {
    const found = kids(el).find((c) => names.includes(c.name));
    if (found) return found;
  }
  return undefined;
};

const MONO = /courier|consolas|mono|menlo|lucida console/i;

function readRun(text: string, rPr: XmlElement | undefined, chain: XmlElement[], ctx: TextContext, fontScale: number): Run {
  const runChain = [...(rPr ? [rPr] : []), ...chain.map((p) => child(p, "a:defRPr")).filter((e): e is XmlElement => Boolean(e))];
  const size = (num(firstAttr(runChain, "sz"), 1800) / 100) * fontScale;
  const baseline = num(firstAttr(runChain, "baseline"), 0);
  const color = readColor(kids(firstChild(runChain, "a:solidFill", "a:gradFill"))[0], ctx.palette) ?? ctx.fontColor ?? readColor(schemeColor("tx1"), ctx.palette)!;
  const link = rPr ? at(child(rPr, "a:hlinkClick"), "r:id") : undefined;
  const target = link ? ctx.rels.get(link) : undefined;
  const typeface = at(firstChild(runChain, "a:latin"), "typeface") ?? "";
  return {
    text,
    size,
    bold: bool(firstAttr(runChain, "b")),
    italic: bool(firstAttr(runChain, "i")),
    underline: (firstAttr(runChain, "u") ?? "none") !== "none",
    strike: (firstAttr(runChain, "strike") ?? "noStrike") !== "noStrike",
    color: target?.external && /^(https?:|mailto:)/i.test(target.target) ? readColor(schemeColor("hlink"), ctx.palette)! : color,
    mono: MONO.test(typeface),
    script: baseline > 0 ? "super" : baseline < 0 ? "sub" : undefined,
    href: target?.external && /^(https?:|mailto:)/i.test(target.target) ? target.target : undefined,
  };
}

const AUTONUM: Record<string, (n: number) => string> = {
  arabicPeriod: (n) => `${n}.`,
  arabicParenR: (n) => `${n})`,
  arabicParenBoth: (n) => `(${n})`,
  arabicPlain: (n) => `${n}`,
  alphaLcPeriod: (n) => `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`,
  alphaUcPeriod: (n) => `${String.fromCharCode(64 + (((n - 1) % 26) + 1))}.`,
  alphaLcParenR: (n) => `${String.fromCharCode(96 + (((n - 1) % 26) + 1))})`,
  alphaUcParenR: (n) => `${String.fromCharCode(64 + (((n - 1) % 26) + 1))})`,
  romanLcPeriod: (n) => `${roman(n)}.`,
  romanUcPeriod: (n) => `${roman(n).toUpperCase()}.`,
};

function roman(n: number): string {
  const numerals: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, symbol] of numerals) for (; n >= value; n -= value) out += symbol;
  return out;
}

/** Symbol-font bullets drawn with a plain font: Wingdings' square, arrow and tick become ordinary marks. */
function bulletChar(char: string, font: string | undefined): string {
  if (/wingdings|symbol|webdings/i.test(font ?? "")) return { "§": "▪", n: "▪", q: "▫", "Ø": "›", "ü": "•", l: "•", "·": "•" }[char] ?? "•";
  return char || "•";
}

function spacing(el: XmlElement | undefined, size: number): number | null {
  if (!el) return null;
  const points = child(el, "a:spcPts");
  if (points) return num(attr(points, "val"), 0) / 100;
  const percent = child(el, "a:spcPct");
  if (percent) return (num(attr(percent, "val"), 0) / 100000) * size * 1.2;
  return null;
}

/** A text body with its list styles resolved. `bodyPrs`: the shape's bodyPr first, then inherited ones. */
function readTextBody(txBody: XmlElement, bodyPrs: (XmlElement | undefined)[], ctx: TextContext): TextBody | null {
  const chainBody = bodyPrs.filter((b): b is XmlElement => Boolean(b));
  const bodyAttr = (name: string) => firstAttr(chainBody, name);
  const autofit = firstChild(chainBody, "a:normAutofit", "a:noAutofit", "a:spAutoFit");
  const fontScale = autofit?.name === "a:normAutofit" ? num(attr(autofit, "fontScale"), 100000) / 100000 : 1;
  const lineReduction = autofit?.name === "a:normAutofit" ? num(attr(autofit, "lnSpcReduction"), 0) / 100000 : 0;
  const styles = [child(txBody, "a:lstStyle"), ...ctx.styles];
  const counters: number[] = [];

  const paragraphs: Paragraph[] = [];
  for (const p of kids(txBody).filter((c) => c.name === "a:p")) {
    const pPr = child(p, "a:pPr");
    const level = Math.min(8, num(at(pPr, "lvl"), 0));
    const chain = levelChain(styles, level, pPr);
    const runs: Run[] = [];
    for (const item of kids(p)) {
      if (item.name === "a:r" || item.name === "a:fld") {
        let text = textOf(child(item, "a:t") ?? item);
        if (item.name === "a:fld" && attr(item, "type") === "slidenum") text = String(ctx.slideNumber);
        if (text) runs.push(readRun(text, child(item, "a:rPr"), chain, ctx, fontScale));
      } else if (item.name === "a:br") {
        runs.push({ ...readRun("\n", child(item, "a:rPr"), chain, ctx, fontScale) });
      }
    }
    const empty = readRun("", child(p, "a:endParaRPr"), chain, ctx, fontScale);
    const size = runs.length ? Math.max(...runs.map((r) => r.size)) : empty.size;

    // Bullets: only on paragraphs with text.
    const bu = firstChild(chain, "a:buNone", "a:buChar", "a:buAutoNum", "a:buBlip");
    let bullet: string | null = null;
    counters.length = level + 1;
    if (runs.some((r) => r.text.trim()) && bu && bu.name !== "a:buNone") {
      if (bu.name === "a:buAutoNum") {
        const start = num(attr(bu, "startAt"), 1);
        counters[level] = (counters[level] ?? start - 1) + 1;
        bullet = (AUTONUM[attr(bu, "type") ?? ""] ?? AUTONUM.arabicPeriod)(counters[level]);
      } else {
        const font = at(firstChild(chain, "a:buFont"), "typeface");
        bullet = bu.name === "a:buChar" ? bulletChar(attr(bu, "char") ?? "•", font) : "•";
      }
    } else if (runs.some((r) => r.text.trim())) {
      counters[level] = 0;
    }

    const lnSpc = firstChild(chain, "a:lnSpc");
    const exact = lnSpc && child(lnSpc, "a:spcPts");
    const algn = firstAttr(chain, "algn");
    paragraphs.push({
      runs,
      align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" || algn === "dist" ? "justify" : "left",
      marginLeft: pt(firstAttr(chain, "marL")),
      indent: pt(firstAttr(chain, "indent")),
      bullet,
      lineSpacing: exact ? { points: num(attr(exact, "val"), 1200) / 100 } : { percent: Math.max(0.5, (lnSpc && child(lnSpc, "a:spcPct") ? num(attr(child(lnSpc, "a:spcPct")!, "val"), 100000) / 100000 : 1) - lineReduction) },
      spaceBefore: spacing(firstChild(chain, "a:spcBef"), size) ?? 0,
      spaceAfter: spacing(firstChild(chain, "a:spcAft"), size) ?? 0,
      size,
    });
  }
  if (!paragraphs.some((p) => p.runs.some((r) => r.text.trim()))) return null;
  const vert = bodyAttr("vert");
  const anchor = bodyAttr("anchor");
  return {
    insets: { left: pt(bodyAttr("lIns"), 7.2), top: pt(bodyAttr("tIns"), 3.6), right: pt(bodyAttr("rIns"), 7.2), bottom: pt(bodyAttr("bIns"), 3.6) },
    anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    wrap: bodyAttr("wrap") !== "none",
    rotate: vert === "vert" || vert === "eaVert" ? 90 : vert === "vert270" ? 270 : 0,
    paragraphs,
  };
}

// ---------------------------------------------------------------------------- Shapes

interface Placeholder {
  type: string;
  idx: string | undefined;
}

const placeholderOf = (nv: XmlElement | undefined): Placeholder | null => {
  const ph = path(nv, "p:nvPr", "p:ph");
  return ph ? { type: attr(ph, "type") ?? "body", idx: attr(ph, "idx") } : null;
};

/** How a layout or master shape matches a slide placeholder. */
function findPlaceholder(tree: XmlElement | undefined, want: Placeholder, byTypeOnly: boolean): XmlElement | undefined {
  const shapes = kids(tree).filter((s) => s.name === "p:sp");
  const phOf = (s: XmlElement) => placeholderOf(child(s, "p:nvSpPr"));
  const normal = (type: string) => (type === "ctrTitle" ? "title" : type === "subTitle" || type === "obj" ? "body" : type);
  if (!byTypeOnly && want.idx !== undefined) {
    const byIdx = shapes.find((s) => phOf(s)?.idx === want.idx);
    if (byIdx) return byIdx;
  }
  return shapes.find((s) => phOf(s)?.type === want.type) ?? shapes.find((s) => normal(phOf(s)?.type ?? "") === normal(want.type));
}

type Transform = (box: Box) => Box;
const identity: Transform = (b) => b;

function readXfrm(xfrm: XmlElement | undefined): Placed | null {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return null;
  return {
    box: { x: pt(attr(off, "x")), y: pt(attr(off, "y")), width: pt(attr(ext, "cx")), height: pt(attr(ext, "cy")) },
    rotation: num(attr(xfrm!, "rot"), 0) / 60000,
    flipH: bool(attr(xfrm!, "flipH")),
    flipV: bool(attr(xfrm!, "flipV")),
  };
}

function readGeometry(spPr: XmlElement | undefined): Geometry {
  const preset = child(spPr, "a:prstGeom");
  if (preset) {
    const adjust: Record<string, number> = {};
    for (const gd of kids(child(preset, "a:avLst"))) {
      const m = /^val\s+(-?\d+)/.exec(attr(gd, "fmla") ?? "");
      if (m) adjust[attr(gd, "name") ?? ""] = Number(m[1]);
    }
    return { preset: attr(preset, "prst") ?? "rect", adjust };
  }
  const custom = child(spPr, "a:custGeom");
  if (custom) {
    const paths = kids(child(custom, "a:pathLst")).map((p) => {
      const commands: PathCommand[] = [];
      let current = { x: 0, y: 0 };
      const point = (el: XmlElement | undefined) => ({ x: num(at(el, "x"), NaN), y: num(at(el, "y"), NaN) });
      for (const c of kids(p)) {
        if (c.name === "a:moveTo" || c.name === "a:lnTo") {
          current = point(child(c, "a:pt"));
          commands.push({ op: c.name === "a:moveTo" ? "M" : "L", ...current });
        } else if (c.name === "a:cubicBezTo" || c.name === "a:quadBezTo") {
          const pts = kids(c).map(point);
          const [a, b, e] = pts.length === 3 ? pts : [pts[0], pts[0], pts[1]];
          commands.push({ op: "C", points: [a.x, a.y, b.x, b.y, e.x, e.y] });
          current = e;
        } else if (c.name === "a:arcTo") {
          // An arc of an ellipse, from the current point: approximated with short lines.
          const [wR, hR] = [num(attr(c, "wR"), 0), num(attr(c, "hR"), 0)];
          const start = (num(attr(c, "stAng"), 0) / 60000) * (Math.PI / 180);
          const sweep = (num(attr(c, "swAng"), 0) / 60000) * (Math.PI / 180);
          const cx = current.x - wR * Math.cos(start);
          const cy = current.y - hR * Math.sin(start);
          const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
          for (let i = 1; i <= steps; i++) {
            const t = start + (sweep * i) / steps;
            current = { x: cx + wR * Math.cos(t), y: cy + hR * Math.sin(t) };
            commands.push({ op: "L", ...current });
          }
        } else if (c.name === "a:close") commands.push({ op: "Z" });
      }
      return { width: num(attr(p, "w"), 0), height: num(attr(p, "h"), 0), commands, fill: attr(p, "fill") !== "none", stroke: attr(p, "stroke") !== "0" };
    });
    // Paths with formulas instead of numbers can't be drawn.
    const valid = paths.filter((p) => p.commands.every((c) => (c.op === "C" ? c.points.every(Number.isFinite) : c.op === "Z" || (Number.isFinite(c.x) && Number.isFinite(c.y)))));
    return { paths: valid };
  }
  return { preset: "rect", adjust: {} };
}

interface Layer {
  part: Part;
  palette: Palette;
  theme: XmlElement | undefined;
}

class Reader {
  skipped = { charts: 0, diagrams: 0, media: 0 };
  media = new Map<string, Uint8Array>();
  constructor(private pkg: Package) {}

  image(part: Part, id: string | undefined): string | null {
    const rel = id ? part.rels.get(id) : undefined;
    if (!rel || rel.external) return null;
    const bytes = this.pkg.files[rel.target];
    if (!bytes) return null;
    this.media.set(rel.target, bytes);
    return rel.target;
  }

  /** Line style of a shape: its own a:ln, or the theme line its style refers to. */
  line(spPr: XmlElement | undefined, style: XmlElement | undefined, layer: Layer): Line | null {
    const ln = child(spPr, "a:ln");
    const lnRef = child(style, "a:lnRef");
    const themeLines = kids(path(layer.theme, "a:themeElements", "a:fmtScheme", "a:lnStyleLst"));
    const refIdx = lnRef ? num(attr(lnRef, "idx"), 0) : 0;
    const refColor = lnRef ? readColor(kids(lnRef)[0], layer.palette) : null;
    const themeLine = refIdx > 0 ? themeLines[refIdx - 1] : undefined;
    if (ln && child(ln, "a:noFill")) return null;
    const palette = { ...layer.palette, placeholder: refColor ?? undefined };
    const color = fillColor(kids(ln).find((c) => FILLS.includes(c.name)), palette) ?? (themeLine ? fillColor(kids(themeLine).find((c) => FILLS.includes(c.name)), palette) : null) ?? (ln && !themeLine ? null : refColor);
    if (!color) return null;
    const width = pt(at(ln, "w") ?? at(themeLine, "w"), 0.75);
    const dash = at(child(ln, "a:prstDash") ?? child(themeLine, "a:prstDash"), "val");
    return { color, width: Math.max(0.25, width), dash: Boolean(dash && dash !== "solid") };
  }

  shapes(tree: XmlElement | undefined, layer: Layer, ctx: { slideNumber: number; inherited: Layer[]; placeholders: boolean }, transform: Transform, out: Shape[]) {
    for (let el of kids(tree)) {
      if (el.name === "mc:AlternateContent") {
        const pick = child(el, "mc:Fallback") ?? child(el, "mc:Choice");
        if (pick) this.shapes(pick, layer, ctx, transform, out);
        continue;
      }
      if (el.name === "p:grpSp") {
        const xfrm = path(el, "p:grpSpPr", "a:xfrm");
        const placed = readXfrm(xfrm);
        const chOff = child(xfrm, "a:chOff");
        const chExt = child(xfrm, "a:chExt");
        let inner = transform;
        if (placed && chOff && chExt) {
          const [cx, cy, cw, ch] = [pt(attr(chOff, "x")), pt(attr(chOff, "y")), pt(attr(chExt, "cx")), pt(attr(chExt, "cy"))];
          const sx = cw ? placed.box.width / cw : 1;
          const sy = ch ? placed.box.height / ch : 1;
          inner = (b) => transform({ x: placed.box.x + (b.x - cx) * sx, y: placed.box.y + (b.y - cy) * sy, width: b.width * sx, height: b.height * sy });
        }
        this.shapes(el, layer, ctx, inner, out);
        continue;
      }
      if (el.name === "p:graphicFrame") {
        this.graphicFrame(el, layer, ctx, transform, out);
        continue;
      }
      if (el.name !== "p:sp" && el.name !== "p:pic" && el.name !== "p:cxnSp") continue;
      if (el.name === "p:pic" && (path(el, "p:nvPicPr", "p:nvPr", "a:videoFile") || path(el, "p:nvPicPr", "p:nvPr", "a:audioFile"))) this.skipped.media++;
      const nv = child(el, el.name === "p:sp" ? "p:nvSpPr" : el.name === "p:pic" ? "p:nvPicPr" : "p:nvCxnSpPr");
      if (bool(at(child(nv, "p:cNvPr"), "hidden"))) continue;
      const ph = placeholderOf(nv);
      // Placeholders on layouts and masters are prompts, only shown while editing.
      if (ph && !ctx.placeholders) continue;
      el = el as XmlElement;

      // Inherited placeholder shapes, most specific first.
      const inheritedShapes: { shape: XmlElement; layer: Layer }[] = [];
      if (ph) {
        for (const [i, from] of ctx.inherited.entries()) {
          const found = findPlaceholder(path(from.part.root, "p:cSld", "p:spTree"), ph, i > 0 && ctx.inherited.length > 1);
          if (found) inheritedShapes.push({ shape: found, layer: from });
        }
      }
      const spPr = child(el, "p:spPr");
      const placed = readXfrm(child(spPr, "a:xfrm")) ?? inheritedShapes.map((s) => readXfrm(path(s.shape, "p:spPr", "a:xfrm"))).find(Boolean);
      if (!placed) continue;
      const box = transform(placed.box);
      const style = child(el, "p:style");

      if (el.name === "p:pic") {
        const blipFill = child(el, "p:blipFill");
        const image = this.image(layer.part, at(child(blipFill, "a:blip"), "r:embed"));
        if (!image) continue;
        const src = child(blipFill, "a:srcRect");
        const crop = { left: num(at(src, "l"), 0) / 100000, top: num(at(src, "t"), 0) / 100000, right: num(at(src, "r"), 0) / 100000, bottom: num(at(src, "b"), 0) / 100000 };
        out.push({ kind: "picture", ...placed, box, image, crop: src ? crop : { left: 0, top: 0, right: 0, bottom: 0 } });
        continue;
      }

      // Fill: the shape's own, an inherited placeholder's, or the theme fill its style refers to.
      const fillEl = fillOf(spPr) ?? inheritedShapes.map((s) => fillOf(path(s.shape, "p:spPr"))).find(Boolean);
      const fillRef = child(style, "a:fillRef");
      const refColor = fillRef ? readColor(kids(fillRef)[0], layer.palette) : null;
      let fill: Color | null = null;
      let image: string | null = null;
      if (fillEl?.name === "a:blipFill") image = this.image(layer.part, at(child(fillEl, "a:blip"), "r:embed"));
      else if (fillEl) fill = fillColor(fillEl, layer.palette);
      else if (fillRef && num(attr(fillRef, "idx"), 0) > 0) fill = refColor;
      const line = this.line(spPr, style, layer);

      let text: TextBody | null = null;
      const txBody = child(el, "p:txBody");
      if (txBody) {
        const fontRef = child(style, "a:fontRef");
        const master = ctx.inherited.at(-1) ?? layer;
        const txStyles = path(master.part.root, "p:txStyles");
        const kind = ph ? (/title/i.test(ph.type) ? "p:titleStyle" : /^(body|subTitle|obj)$/.test(ph.type) ? "p:bodyStyle" : "p:otherStyle") : "p:otherStyle";
        text = readTextBody(
          txBody,
          [child(txBody, "a:bodyPr"), ...inheritedShapes.map((s) => path(s.shape, "p:txBody", "a:bodyPr"))],
          {
            palette: layer.palette,
            styles: [...inheritedShapes.map((s) => path(s.shape, "p:txBody", "a:lstStyle")), child(txStyles, kind), this.defaultTextStyle],
            fontColor: fontRef ? readColor(kids(fontRef)[0], layer.palette) : null,
            rels: layer.part.rels,
            slideNumber: ctx.slideNumber,
          },
        );
      }
      if (!fill && !image && !line && !text) continue;
      out.push({ kind: "shape", ...placed, box, geometry: el.name === "p:cxnSp" ? { preset: "line", adjust: {} } : readGeometry(spPr), fill, image, line, text });
    }
  }

  graphicFrame(el: XmlElement, layer: Layer, ctx: { slideNumber: number }, transform: Transform, out: Shape[]) {
    const data = path(el, "a:graphic", "a:graphicData");
    const uri = at(data, "uri") ?? "";
    const placed = readXfrm(child(el, "p:xfrm"));
    if (!placed) return;
    if (uri.endsWith("/table")) {
      const table = child(data, "a:tbl");
      const columns = kids(child(table, "a:tblGrid")).map((c) => pt(attr(c, "w")));
      const rows = kids(table)
        .filter((r) => r.name === "a:tr")
        .map((tr) => ({
          height: pt(attr(tr, "h")),
          cells: kids(tr)
            .filter((c) => c.name === "a:tc")
            .map((tc): TableCell => {
              const tcPr = child(tc, "a:tcPr");
              const merged = bool(attr(tc, "hMerge")) || bool(attr(tc, "vMerge"));
              const txBody = child(tc, "a:txBody");
              const body = txBody
                ? readTextBody(txBody, [child(txBody, "a:bodyPr")], { palette: layer.palette, styles: [this.defaultTextStyle], fontColor: null, rels: layer.part.rels, slideNumber: ctx.slideNumber })
                : null;
              const anchor = at(tcPr, "anchor");
              return {
                colSpan: merged ? 0 : num(attr(tc, "gridSpan"), 1),
                rowSpan: merged ? 0 : num(attr(tc, "rowSpan"), 1),
                fill: fillColor(kids(tcPr).find((c) => FILLS.includes(c.name)), layer.palette),
                text: {
                  ...(body ?? { wrap: true, rotate: 0, paragraphs: [] }),
                  insets: { left: pt(at(tcPr, "marL"), 7.2), right: pt(at(tcPr, "marR"), 7.2), top: pt(at(tcPr, "marT"), 3.6), bottom: pt(at(tcPr, "marB"), 3.6) },
                  anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
                },
              };
            }),
        }));
      out.push({ kind: "table", box: transform(placed.box), columns, rows });
      return;
    }
    // OLE objects and others often carry a picture of themselves.
    const fallback = [...kidsDeep(data)].find((e) => e.name === "p:pic");
    if (fallback) {
      const image = this.image(layer.part, at(path(fallback, "p:blipFill", "a:blip"), "r:embed"));
      if (image) {
        out.push({ kind: "picture", ...placed, box: transform(placed.box), image, crop: { left: 0, top: 0, right: 0, bottom: 0 } });
        return;
      }
    }
    if (uri.endsWith("/chart") || uri.includes("chart")) this.skipped.charts++;
    else if (uri.endsWith("/diagram")) this.skipped.diagrams++;
    else this.skipped.media++;
  }

  defaultTextStyle: XmlElement | undefined;

  background(layers: Layer[]): Slide["background"] {
    for (const layer of layers) {
      const bg = path(layer.part.root, "p:cSld", "p:bg");
      if (!bg) continue;
      const bgPr = child(bg, "p:bgPr");
      if (bgPr) {
        const fill = kids(bgPr).find((c) => FILLS.includes(c.name));
        if (fill?.name === "a:blipFill") {
          const image = this.image(layer.part, at(child(fill, "a:blip"), "r:embed"));
          if (image) return { image };
        }
        const color = fillColor(fill, layer.palette);
        if (color) return { color };
      }
      const bgRef = child(bg, "p:bgRef");
      if (bgRef) {
        const color = readColor(kids(bgRef)[0], layer.palette);
        const idx = num(attr(bgRef, "idx"), 0);
        const styles = kids(path(layer.theme, "a:themeElements", "a:fmtScheme", "a:bgFillStyleLst"));
        const style = idx > 1000 ? styles[idx - 1001] : undefined;
        const resolved = style ? fillColor(style, { ...layer.palette, placeholder: color ?? undefined }) : color;
        if (resolved) return { color: resolved };
      }
      return null;
    }
    return null;
  }
}

function* kidsDeep(el: XmlElement | undefined): Generator<XmlElement> {
  for (const c of kids(el)) {
    yield c;
    yield* kidsDeep(c);
  }
}

function themeColors(theme: XmlElement | undefined): Theme {
  const colors: Theme = {};
  for (const c of kids(path(theme, "a:themeElements", "a:clrScheme"))) {
    const value = kids(c)[0];
    const name = c.name.replace(/^a:/, "");
    colors[name] = (value && (attr(value, "val") && value.name === "a:srgbClr" ? attr(value, "val") : attr(value, "lastClr"))) ?? "000000";
  }
  return colors;
}

function colorMap(el: XmlElement | undefined): ColorMap {
  const map: ColorMap = {};
  const m = el ? el.attrs.matchAll(/\s([\w]+)="(\w+)"/g) : [];
  for (const [, key, value] of m) map[key] = value;
  return map;
}

/** Read a .pptx into slides ready to draw. */
export function readPresentation(bytes: Uint8Array, name = msg("This file")): Presentation {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new ProcessingError(`“${name}” is password-protected or in the old .ppt format. Save it as an unprotected .pptx first.`, "unsupported");
  }
  const pkg = new Package(bytes);
  const rootRels = pkg.files["_rels/.rels"] ? kids(rootOf(parseXml(strFromU8(pkg.files["_rels/.rels"])))) : [];
  const mainPath = rootRels.map((r) => attr(r, "Target") ?? "").find((t) => /presentation\.xml$/.test(t))?.replace(/^\//, "") ?? "ppt/presentation.xml";
  const presentation = pkg.part(mainPath);
  if (!presentation || presentation.root.name !== "p:presentation") throw new ProcessingError(`“${name}” couldn't be read as a PowerPoint presentation.`, "corrupt");

  const size = child(presentation.root, "p:sldSz");
  const width = pt(at(size, "cx"), 720);
  const height = pt(at(size, "cy"), 540);
  const reader = new Reader(pkg);
  reader.defaultTextStyle = child(presentation.root, "p:defaultTextStyle");

  const slides: Slide[] = [];
  const ids = kids(child(presentation.root, "p:sldIdLst"));
  ids.forEach((id, index) => {
    const rel = presentation.rels.get(attr(id, "r:id") ?? "");
    const slidePart = rel ? pkg.part(rel.target) : null;
    if (!slidePart) return;
    const layoutPart = pkg.related(slidePart, "slideLayout");
    const masterPart = layoutPart ? pkg.related(layoutPart, "slideMaster") : null;
    const themePart = masterPart ? pkg.related(masterPart, "theme") : null;
    const theme = themePart?.root;
    const colors = themeColors(theme);
    const masterMap = colorMap(child(masterPart?.root, "p:clrMap"));
    const override = (part: Part | null) => {
      const o = path(part?.root, "p:clrMapOvr", "a:overrideClrMapping");
      return o ? colorMap(o) : null;
    };
    const layoutMap = override(layoutPart) ?? masterMap;
    const slideMap = override(slidePart) ?? layoutMap;
    const layerOf = (part: Part, map: ColorMap): Layer => ({ part, palette: { theme: colors, map }, theme });
    const slideLayer = layerOf(slidePart, slideMap);
    const layoutLayer = layoutPart ? layerOf(layoutPart, layoutMap) : null;
    const masterLayer = masterPart ? layerOf(masterPart, masterMap) : null;

    const number = index + 1;
    const shapes: Shape[] = [];
    const showMaster = attr(slidePart.root, "showMasterSp") !== "0";
    const layoutShowsMaster = at(layoutPart?.root, "showMasterSp") !== "0";
    if (showMaster && layoutShowsMaster && masterLayer) reader.shapes(path(masterPart!.root, "p:cSld", "p:spTree"), masterLayer, { slideNumber: number, inherited: [], placeholders: false }, identity, shapes);
    if (showMaster && layoutLayer) reader.shapes(path(layoutPart!.root, "p:cSld", "p:spTree"), layoutLayer, { slideNumber: number, inherited: masterLayer ? [masterLayer] : [], placeholders: false }, identity, shapes);
    reader.shapes(
      path(slidePart.root, "p:cSld", "p:spTree"),
      slideLayer,
      { slideNumber: number, inherited: [layoutLayer, masterLayer].filter((l): l is Layer => Boolean(l)), placeholders: true },
      identity,
      shapes,
    );
    slides.push({
      number,
      hidden: attr(slidePart.root, "show") === "0",
      background: reader.background([slideLayer, layoutLayer, masterLayer].filter((l): l is Layer => Boolean(l))),
      shapes,
    });
  });
  if (!slides.length) throw new ProcessingError(`“${name}” has no slides.`, "invalid");
  return { width, height, slides, media: reader.media, skipped: reader.skipped };
}
