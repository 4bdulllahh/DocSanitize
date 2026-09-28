import type { Align, Block, ImageBlock, InlineRun, ParagraphBlock, TableBlock } from "../office/flow";

/*
 * HTML (and Markdown, via HTML) -> flow blocks for Text to PDF. Walks a parsed document: a
 * DOMParser document is inert (no scripts run, nothing is fetched), so only pictures stored in the
 * file itself (data: URLs) are used; pictures on the web or next to the file are left out.
 */

export interface LoadedImage {
  bytes: Uint8Array;
  format: "jpeg" | "png";
}

/** Turns a data: URL into JPEG or PNG bytes; null when it can't. */
export type ImageLoader = (dataUrl: string) => Promise<LoadedImage | null>;

export interface DocumentBlocks {
  blocks: Block[];
  /** Pictures on the web or in other files: never fetched. */
  linkedImages: number;
  /** Pictures in the file that couldn't be decoded, or sit where pictures can't go (table cells). */
  skippedImages: number;
}

export const BODY_SIZE = 11;
const HEADING_SIZES = [22, 17, 14, 12, 11, 11];
const CODE_SIZE = 9.5;
const CODE_SHADE = "#f2f2f2";
const MUTED = "#555555";
const LIST_INDENT = 22;
const BULLETS = ["•", "◦", "▪"];

const SKIP = new Set(["head", "script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "canvas", "video", "audio", "select", "textarea", "button", "map", "title", "meta", "link"]);
const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "body", "center", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "li", "main", "nav", "ol", "p", "pre", "section",
  "summary", "table", "ul", "img", "legend", "caption",
]);

type RunStyle = Omit<InlineRun, "text">;

interface Context {
  indent: number;
  quote?: boolean;
  align?: Align;
  color?: string;
  /** Inside a table cell: pictures and page-level blocks aren't possible. */
  cell?: boolean;
}

/** Paragraph settings waiting for the text that follows (a heading, a list item's marker). */
interface Pending {
  size?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  keepWithNext?: number;
  marker?: string;
}

const NBSP = String.fromCharCode(160);

/** CSS colour values we understand: #rgb, #rrggbb, rgb(r, g, b). */
export function cssColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${[...m[1]].map((c) => c + c).join("")}`;
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return v;
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(v);
  if (m) return `#${m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  return undefined;
}

const styleValue = (el: Element, property: string) => {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(el.getAttribute("style") ?? "");
  return match?.[1].trim();
};

const isHidden = (el: Element) => el.hasAttribute("hidden") || /^none/i.test(styleValue(el, "display") ?? "") || /^hidden/i.test(styleValue(el, "visibility") ?? "");

function alignOf(el: Element, fallback?: Align): Align | undefined {
  const value = (styleValue(el, "text-align") ?? el.getAttribute("align") ?? "").toLowerCase();
  if (el.tagName.toLowerCase() === "center" || value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "justify") return "justify";
  if (value === "left" || value === "start") return undefined;
  return fallback;
}

function roman(n: number): string {
  const numerals: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, symbol] of numerals) for (; n >= value; n -= value) out += symbol;
  return out;
}

function orderedMarker(n: number, type: string | null): string {
  if (type === "a") return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`;
  if (type === "A") return `${String.fromCharCode(64 + (((n - 1) % 26) + 1))}.`;
  if (type === "i") return `${roman(n)}.`;
  if (type === "I") return `${roman(n).toUpperCase()}.`;
  return `${n}.`;
}

class Builder {
  blocks: Block[] = [];
  runs: InlineRun[] = [];
  pending: Pending = {};
  linkedImages = 0;
  skippedImages = 0;
  constructor(private loadImage: ImageLoader) {}

  /** Add inline text; whitespace collapses as a browser would show it. */
  text(raw: string, style: RunStyle) {
    let text = raw.replace(/[\t\n\r\f ]+/g, " ");
    const last = this.runs.at(-1);
    if ((!last || /[ \n]$/.test(last.text)) && text.startsWith(" ")) text = text.slice(1);
    if (text) this.runs.push({ ...style, text });
  }

  /** End the current paragraph (if it has text). `lineBreak`: a <br>, so no space after it. */
  flush(ctx: Context, lineBreak = false) {
    const runs = this.runs;
    this.runs = [];
    // Trim the paragraph's edges.
    while (runs.length && !runs[0].text.trim()) runs.shift();
    while (runs.length && !runs.at(-1)!.text.trim()) runs.pop();
    if (runs.length) {
      runs[0] = { ...runs[0], text: runs[0].text.trimStart() };
      runs[runs.length - 1] = { ...runs.at(-1)!, text: runs.at(-1)!.text.trimEnd() };
    }
    if (!runs.length && !lineBreak) return;
    const p = this.pending;
    this.blocks.push({
      type: "paragraph",
      runs: runs.map((r) => ({ ...r, text: r.text.replaceAll(NBSP, " ") })),
      size: p.size,
      indent: ctx.indent || undefined,
      marker: p.marker,
      align: ctx.align,
      color: ctx.color,
      quote: ctx.quote,
      spaceBefore: p.spaceBefore,
      spaceAfter: lineBreak ? 0 : (p.spaceAfter ?? 6),
      keepWithNext: p.keepWithNext,
    });
    // A line break continues the same paragraph: same size, no second marker.
    this.pending = lineBreak ? { size: p.size, spaceAfter: p.spaceAfter, keepWithNext: p.keepWithNext } : {};
  }

  async children(parent: Node, ctx: Context, style: RunStyle) {
    for (const node of Array.from(parent.childNodes)) await this.node(node, ctx, style);
  }

  async node(node: Node, ctx: Context, style: RunStyle) {
    if (node.nodeType === 3) {
      this.text(node.textContent ?? "", style);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || isHidden(el)) return;
    if (BLOCKS.has(tag)) await this.block(el, tag, ctx, style);
    else await this.inline(el, tag, ctx, style);
  }

  async inline(el: Element, tag: string, ctx: Context, style: RunStyle) {
    const next: RunStyle = { ...style };
    const color = cssColor(styleValue(el, "color") ?? el.getAttribute("color"));
    if (color) next.color = color;
    if (/^(700|800|900|bold|bolder)$/.test(styleValue(el, "font-weight") ?? "")) next.bold = true;
    if (/^italic/.test(styleValue(el, "font-style") ?? "")) next.italic = true;
    switch (tag) {
      case "br":
        this.flush(ctx, true);
        return;
      case "strong":
      case "b":
        next.bold = true;
        break;
      case "em":
      case "i":
      case "cite":
      case "var":
      case "dfn":
        next.italic = true;
        break;
      case "u":
      case "ins":
        next.underline = true;
        break;
      case "s":
      case "del":
      case "strike":
        next.strike = true;
        break;
      case "sub":
        next.script = "sub";
        break;
      case "sup":
        next.script = "super";
        break;
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        next.mono = true;
        break;
      case "small":
        next.size = (style.size ?? this.pending.size ?? BODY_SIZE) * 0.85;
        break;
      case "a": {
        const href = el.getAttribute("href");
        if (href && /^(https?:|mailto:)/i.test(href)) next.href = href;
        break;
      }
      case "input":
        if (el.getAttribute("type")?.toLowerCase() === "checkbox") this.text(el.hasAttribute("checked") ? "[x] " : "[ ] ", style);
        return;
      case "q":
        this.text("“", style);
        await this.children(el, ctx, next);
        this.text("”", style);
        return;
    }
    await this.children(el, ctx, next);
  }

  async block(el: Element, tag: string, ctx: Context, style: RunStyle) {
    this.flush(ctx);
    const inner: Context = { ...ctx, align: alignOf(el, ctx.align), color: cssColor(styleValue(el, "color")) ?? ctx.color };
    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(tag[1]);
        this.pending = { size: HEADING_SIZES[level - 1], spaceBefore: level <= 2 ? 16 : 12, spaceAfter: level <= 2 ? 8 : 5, keepWithNext: 36 };
        await this.children(el, inner, { ...style, bold: true, italic: style.italic || level === 6 });
        this.flush(inner);
        if (level === 1 && !ctx.cell) this.blocks.push({ type: "rule" });
        return;
      }
      case "p":
        this.pending = { ...this.pending, spaceAfter: 8 };
        await this.children(el, inner, style);
        this.flush(inner);
        return;
      case "hr":
        if (!ctx.cell) this.blocks.push({ type: "rule" });
        return;
      case "pre":
        this.pre(el, ctx);
        return;
      case "blockquote":
        await this.children(el, { ...inner, indent: ctx.indent + 18, quote: true, color: inner.color ?? MUTED }, style);
        this.flush({ ...inner, indent: ctx.indent + 18, quote: true, color: inner.color ?? MUTED });
        return;
      case "ul":
      case "ol":
        await this.list(el, tag === "ol", inner, style);
        return;
      case "li":
        // A list item outside a list: treat it as a bulleted one.
        this.pending = { marker: BULLETS[0], spaceAfter: 3 };
        await this.children(el, { ...inner, indent: ctx.indent + LIST_INDENT }, style);
        this.flush({ ...inner, indent: ctx.indent + LIST_INDENT });
        return;
      case "dt":
        await this.children(el, inner, { ...style, bold: true });
        this.pending.spaceAfter = 2;
        this.flush(inner);
        return;
      case "dd":
        await this.children(el, { ...inner, indent: ctx.indent + LIST_INDENT }, style);
        this.flush({ ...inner, indent: ctx.indent + LIST_INDENT });
        return;
      case "figcaption":
      case "caption":
        this.pending = { size: BODY_SIZE * 0.9, spaceAfter: 8 };
        await this.children(el, { ...inner, align: inner.align ?? "center" }, { ...style, italic: true });
        this.flush({ ...inner, align: inner.align ?? "center" });
        return;
      case "table":
        if (ctx.cell) await this.flattenTable(el, inner, style);
        else await this.table(el, inner);
        return;
      case "img":
        await this.image(el, inner);
        return;
      default:
        await this.children(el, inner, style);
        this.flush(inner);
    }
  }

  pre(el: Element, ctx: Context) {
    const text = (el.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      this.blocks.push({
        type: "paragraph",
        runs: [{ text: expandTabs(line) || " ", mono: true }],
        size: CODE_SIZE,
        indent: ctx.indent + 6,
        shade: CODE_SHADE,
        color: ctx.color,
        quote: ctx.quote,
        spaceBefore: i === 0 ? 2 : 0,
        spaceAfter: i === lines.length - 1 ? 10 : 0,
      });
    });
  }

  async list(el: Element, ordered: boolean, ctx: Context, style: RunStyle) {
    const depth = Math.round(ctx.indent / LIST_INDENT);
    const indent = ctx.indent + LIST_INDENT;
    let n = Number(el.getAttribute("start") ?? 1);
    if (!Number.isFinite(n)) n = 1;
    const type = el.getAttribute("type");
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() !== "li" || isHidden(child)) {
        await this.node(child, ctx, style);
        continue;
      }
      const value = Number(child.getAttribute("value"));
      if (ordered && Number.isFinite(value) && child.hasAttribute("value")) n = value;
      this.flush(ctx);
      this.pending = { marker: ordered ? orderedMarker(n++, type) : BULLETS[depth % BULLETS.length], spaceAfter: 3 };
      const itemCtx = { ...ctx, indent };
      await this.children(child, itemCtx, style);
      this.flush(itemCtx);
      this.pending = {};
    }
    // Space after the whole list.
    const last = this.blocks.at(-1);
    if (last?.type === "paragraph" && depth === 0) last.spaceAfter = Math.max(last.spaceAfter ?? 0, 8);
  }

  async table(el: Element, ctx: Context) {
    const rows: TableBlock["rows"] = [];
    const rowElements = Array.from(el.querySelectorAll("tr")).filter((tr) => tr.closest("table") === el);
    for (const tr of rowElements) {
      if (isHidden(tr)) continue;
      const cells: TableBlock["rows"][number]["cells"] = [];
      const cellElements = Array.from(tr.children).filter((c) => /^t[dh]$/i.test(c.tagName));
      for (const cell of cellElements) {
        const sub = new Builder(this.loadImage);
        const header = cell.tagName.toLowerCase() === "th";
        const cellCtx: Context = { indent: 0, cell: true, align: alignOf(cell), color: cssColor(styleValue(cell, "color")) };
        await sub.children(cell, cellCtx, header ? { bold: true } : {});
        sub.flush(cellCtx);
        this.linkedImages += sub.linkedImages;
        this.skippedImages += sub.skippedImages;
        const paragraphs = sub.blocks.filter((b): b is ParagraphBlock => b.type === "paragraph").map((p) => ({ ...p, spaceBefore: 0, spaceAfter: 2, keepWithNext: undefined }));
        cells.push({ paragraphs, colSpan: Math.max(1, Number(cell.getAttribute("colspan")) || 1) });
      }
      if (!cells.length) continue;
      const inHead = tr.parentElement?.tagName.toLowerCase() === "thead";
      rows.push({ cells, header: inHead || cellElements.every((c) => c.tagName.toLowerCase() === "th") });
    }
    // Header rows only count at the top of the table.
    let top = true;
    for (const row of rows) {
      if (!row.header) top = false;
      else if (!top) row.header = false;
    }
    const caption = el.querySelector(":scope > caption");
    if (caption) await this.block(caption, "caption", ctx, {});
    if (rows.length) this.blocks.push({ type: "table", rows, repeatHeader: true, headerFill: "#ededed" });
    const last = this.blocks.at(-1);
    if (last?.type === "table") this.blocks.push({ type: "paragraph", runs: [], spaceAfter: 4 });
  }

  /** A table inside a table cell: its cells' text, one paragraph per row. */
  async flattenTable(el: Element, ctx: Context, style: RunStyle) {
    for (const tr of Array.from(el.querySelectorAll("tr"))) {
      for (const cell of Array.from(tr.children)) {
        await this.children(cell, ctx, style);
        this.text(" ", style);
      }
      this.flush(ctx);
    }
  }

  async image(el: Element, ctx: Context) {
    const src = el.getAttribute("src") ?? "";
    const alt = el.getAttribute("alt")?.trim();
    let image: LoadedImage | null = null;
    if (!/^data:/i.test(src)) {
      if (src) this.linkedImages++;
    } else if (ctx.cell) {
      this.skippedImages++;
    } else {
      image = await this.loadImage(src).catch(() => null);
      if (!image) this.skippedImages++;
    }
    if (image) {
      const block: ImageBlock = { type: "image", ...image, align: ctx.align === "justify" ? undefined : ctx.align };
      this.blocks.push(block);
    } else if (alt) {
      this.blocks.push({ type: "paragraph", runs: [{ text: `[${alt}]`, italic: true }], indent: ctx.indent || undefined, color: MUTED, align: ctx.align, spaceAfter: 6 });
    }
  }
}

/** Tabs to spaces, with stops every 4 columns (code). */
export function expandTabs(line: string): string {
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(4 - (out.length % 4)) : ch;
  return out;
}

/** Turn a parsed HTML document (or element) into flow blocks. */
export async function htmlToBlocks(root: Document | Element, loadImage: ImageLoader): Promise<DocumentBlocks> {
  const builder = new Builder(loadImage);
  const start = "body" in root && root.body ? root.body : root;
  const ctx: Context = { indent: 0 };
  await builder.children(start, ctx, {});
  builder.flush(ctx);
  // Drop trailing empty paragraphs.
  while (builder.blocks.at(-1)?.type === "paragraph" && !(builder.blocks.at(-1) as ParagraphBlock).runs.length) builder.blocks.pop();
  return { blocks: builder.blocks, linkedImages: builder.linkedImages, skippedImages: builder.skippedImages };
}

/** Plain text -> one paragraph per line (blank lines keep their space). */
export function textToBlocks(text: string, mono: boolean): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((line) => ({
    type: "paragraph",
    runs: [{ text: mono ? expandTabs(line) || " " : line.replace(/\t/g, "    ") || " ", mono }],
    size: mono ? 10 : BODY_SIZE,
    spaceAfter: 0,
  }));
}
