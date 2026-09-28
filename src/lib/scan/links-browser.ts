import jsQR from "jsqr";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { withRenderSlot } from "../pdf/render";

/*
 * Finding links and QR codes (on the page: rendering and QR decoding need a canvas). What's
 * found is judged by `links.ts`.
 */

export interface FoundLink {
  kind: "link" | "text" | "qr";
  /** 0-based page, for PDFs. */
  page?: number;
  /** The link's target, or the QR code's contents. */
  value: string;
  /** For links: the text they sit on. */
  shown?: string;
}

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const trimUrl = (url: string) => url.replace(/[.,;:!?)\]}'"]+$/, "");

/** Up to this many codes per picture: each one found is painted over and the picture read again. */
const MAX_CODES = 8;

/** Every QR code in an RGBA picture. The pixels are modified. */
export function readQrCodes(data: Uint8ClampedArray, width: number, height: number): string[] {
  const found: string[] = [];
  for (let n = 0; n < MAX_CODES; n++) {
    const code = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
    if (!code) break;
    if (code.data) found.push(code.data);
    const { topLeftCorner: a, topRightCorner: b, bottomLeftCorner: c, bottomRightCorner: d } = code.location;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x, d.x)) - 4);
    const x1 = Math.min(width, Math.ceil(Math.max(a.x, b.x, c.x, d.x)) + 4);
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y, d.y)) - 4);
    const y1 = Math.min(height, Math.ceil(Math.max(a.y, b.y, c.y, d.y)) + 4);
    for (let y = y0; y < y1; y++) data.fill(255, (y * width + x0) * 4, (y * width + x1) * 4);
  }
  return found;
}

/** QR codes in a picture, shrunk to a size jsQR handles quickly. */
export function qrCodesInBitmap(bitmap: ImageBitmap): string[] {
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const [width, height] = [Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale))];
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return readQrCodes(ctx.getImageData(0, 0, width, height).data, width, height);
}

/** "https://www.Example.com/" and "example.com" alike, for spotting the same address twice. */
const normalUrl = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");

/**
 * The text a link sits on: the characters of text runs on the link's line whose middle falls
 * inside its rectangle (user space; character widths taken as equal).
 */
function textInRect(items: TextItem[], rect: number[]): string {
  const [x1, y1, x2, y2] = rect;
  const [left, right, bottom, top] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
  const parts: string[] = [];
  for (const item of items) {
    const [x, y] = [item.transform[4], item.transform[5]];
    if (y < bottom - 2 || y > top + 2 || !item.str) continue;
    const chars = Array.from(item.str);
    const step = item.width / chars.length;
    const inside = chars.filter((_, i) => {
      const middle = x + (i + 0.5) * step;
      return middle >= left && middle <= right;
    });
    if (inside.length) parts.push(inside.join(""));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

interface LinkAnnotation {
  subtype?: string;
  url?: string;
  unsafeUrl?: string;
  rect: number[];
}

/** Links, addresses written in the text, and QR codes on every page. */
export async function findLinksInPdf(doc: PDFDocumentProxy, onPage?: (done: number) => void, signal?: AbortSignal): Promise<FoundLink[]> {
  const found: FoundLink[] = [];
  for (let p = 0; p < doc.numPages && !signal?.aborted; p++) {
    const page = await doc.getPage(p + 1);
    const viewport = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter((i): i is TextItem => "str" in i);
    const linked = new Set<string>();
    for (const annotation of (await page.getAnnotations()) as LinkAnnotation[]) {
      const target = annotation.unsafeUrl ?? annotation.url;
      if (annotation.subtype !== "Link" || !target) continue;
      const shown = textInRect(items, annotation.rect);
      found.push({ kind: "link", page: p, value: target, shown: shown || undefined });
      for (const url of [target, shown]) if (url) linked.add(normalUrl(url));
    }
    const text = items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join("");
    for (const m of text.matchAll(URL_IN_TEXT)) {
      const url = trimUrl(m[0]);
      if (!linked.has(normalUrl(url))) found.push({ kind: "text", page: p, value: url });
    }
    const codes = await withRenderSlot(async () => {
      const scaled = page.getViewport({ scale: Math.min(2.5, 2400 / Math.max(viewport.width, viewport.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaled.width);
      canvas.height = Math.ceil(scaled.height);
      await page.render({ canvas, viewport: scaled, background: "#ffffff" }).promise;
      const data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
      const result = readQrCodes(data, canvas.width, canvas.height);
      canvas.width = canvas.height = 0;
      return result;
    });
    for (const value of codes) found.push({ kind: "qr", page: p, value });
    page.cleanup();
    onPage?.(p + 1);
  }
  return found;
}
