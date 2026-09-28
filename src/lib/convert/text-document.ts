import { Marked } from "marked";
import type { Block } from "../office/flow";
import { htmlToBlocks, textToBlocks, type DocumentBlocks, type ImageLoader } from "./html-blocks";

/*
 * Text to PDF, the reading half (runs on the page, where DOMParser is): a text, Markdown or HTML
 * file -> flow blocks. The office worker typesets the blocks.
 */

export type TextFormat = "markdown" | "html" | "text";

export function textFormatOf(name: string): TextFormat {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  return "text";
}

/** Bytes -> text: UTF-8 (the usual case, with or without a BOM), UTF-16 with a BOM, else Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const marked = new Marked({ gfm: true, breaks: false, async: false });

/** Markdown -> HTML (GitHub flavour: tables, task lists, strikethrough). A leading YAML front matter block is dropped. */
export function markdownToHtml(markdown: string): string {
  const body = markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return marked.parse(body) as string;
}

export interface ReadOptions {
  /** Plain text only: a fixed-width font, keeping columns lined up. */
  mono: boolean;
  /** Parse HTML into an inert document (DOMParser on the page, happy-dom in tests). */
  parseHtml: (html: string) => Document;
  loadImage: ImageLoader;
}

export async function readTextDocument(text: string, format: TextFormat, options: ReadOptions): Promise<DocumentBlocks> {
  if (format === "text") return { blocks: textToBlocks(text, options.mono), linkedImages: 0, skippedImages: 0 };
  const html = format === "markdown" ? markdownToHtml(text) : text;
  return htmlToBlocks(options.parseHtml(html), options.loadImage);
}

/** Whether there's anything to print. */
export const hasContent = (blocks: Block[]) =>
  blocks.some((b) => b.type !== "paragraph" || b.runs.some((r) => r.text.trim()));

/** Decode a base64 data: URL; null for anything else. */
export function dataUrlBytes(url: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i.exec(url.trim());
  if (!m) return null;
  const type = m[1].toLowerCase();
  try {
    if (/;base64/i.test(m[2])) {
      const binary = atob(m[3].replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { type, bytes };
    }
    return { type, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  } catch {
    return null;
  }
}
