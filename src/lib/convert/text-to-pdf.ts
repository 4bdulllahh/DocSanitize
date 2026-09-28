import { renderFlow, type Block, type FontFiles } from "../office/flow";
import { missingCharactersWarning } from "../office/word";
import { PAGE_SIZES } from "../pdf/images";
import { BODY_SIZE } from "./html-blocks";

/* Text to PDF, the writing half (office worker): typeset the blocks read from the file. */

export interface TextToPdfOptions {
  pageSize: "a4" | "letter";
  margins: "normal" | "narrow";
}

export interface TextPdfResult {
  bytes: Uint8Array;
  pages: number;
  warnings: string[];
}

export async function blocksToPdf(blocks: Block[], options: TextToPdfOptions, fonts: FontFiles): Promise<TextPdfResult> {
  const [width, height] = PAGE_SIZES[options.pageSize];
  const result = await renderFlow(blocks, { pageWidth: width, pageHeight: height, margin: options.margins === "narrow" ? 40 : 72, fonts, size: BODY_SIZE });
  return { bytes: result.bytes, pages: result.pages, warnings: result.missingCharacters ? [missingCharactersWarning(result.missingCharacters)] : [] };
}
