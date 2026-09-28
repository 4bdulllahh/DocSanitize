import { ProcessingError } from "../errors";
import type { FileKind } from "../files";
import { replaceExtension } from "../zip";
import type { BatchItem, Operations, StepContext } from "./run";
import { pagesToDelete, type BatchStep, type StepOf } from "./steps";

/*
 * Each step done by the same code as its own tool. Modules are loaded when a step first needs
 * them, so opening Batch Process doesn't download every tool.
 */

const pdf = (item: BatchItem, blob: Blob, name = item.name): BatchItem => ({ name, blob, kind: "pdf" });
const asPdfName = (name: string) => replaceExtension(name, ".pdf");
const MARGIN = 30;

export interface Certificate {
  file: Uint8Array;
  password: string;
}

export function createOperations(options: { certificate: Certificate | null; date: string }): Operations {
  return {
    one: (step, item, context) => one(step, item, context, options),
    all: async (step, items) => {
      if (step.type === "bates") return bates(step, items);
      if (step.type === "merge") {
        const { mergeFiles } = await import("../pdf/client");
        const name = /\.pdf$/i.test(step.name.trim()) ? step.name.trim() : `${step.name.trim()}.pdf`;
        return [{ name, kind: "pdf", blob: await mergeFiles(items.map((i) => ({ name: i.name, file: i.blob }))) }];
      }
      throw new Error(`${step.type} doesn't work on files together.`);
    },
  };
}

async function bates(step: StepOf<"bates">, items: BatchItem[]): Promise<BatchItem[]> {
  const { batesFiles } = await import("../pdf/client");
  const results = await batesFiles(
    items.map((i) => i.blob),
    { prefix: step.prefix, suffix: "", start: step.start, digits: step.digits, position: step.position, margin: MARGIN, size: 10, color: "#111111" },
  );
  return results.map((r, i) => pdf(items[i], r.blob));
}

async function one(step: BatchStep, item: BatchItem, context: StepContext, options: { certificate: Certificate | null; date: string }): Promise<BatchItem> {
  const client = () => import("../pdf/client");
  switch (step.type) {
    case "sanitize": {
      const [{ stripFile }, { DEFAULT_STRIP_OPTIONS }] = await Promise.all([import("../metadata/client"), import("../metadata/types")]);
      const { bytes } = await stripFile(item.blob, { ...DEFAULT_STRIP_OPTIONS, keepTechnical: step.keepTechnical, keepColorProfile: step.keepTechnical });
      return { ...item, blob: new Blob([bytes as BlobPart], { type: item.blob.type }) };
    }
    case "to-pdf":
      return toPdf(step, item);
    case "rotate": {
      const { countPages, rotateFile } = await client();
      const count = await countPages(item.blob);
      return pdf(
        item,
        await rotateFile(
          item.blob,
          Array.from({ length: count }, (_, i) => i),
          step.angle,
        ),
      );
    }
    case "delete-pages": {
      const { countPages, deletePagesOfFile } = await client();
      const pages = pagesToDelete(step.pages, await countPages(item.blob));
      // A file too short to have any of these pages is left as it is.
      return pages.length ? pdf(item, await deletePagesOfFile(item.blob, pages)) : item;
    }
    case "resize":
      return pdf(item, await (await client()).resizeFile(item.blob, { size: step.size, orientation: "auto" }));
    case "watermark": {
      const { watermarkFile } = await client();
      const { text, size, color, opacity, angle, position, behind } = step;
      return pdf(item, await watermarkFile(item.blob, { kind: "text", text, bold: true, size, color, opacity, angle, position, behind, imageScale: 0.4 }));
    }
    case "page-numbers": {
      const { numberPagesOfFile } = await client();
      return pdf(item, await numberPagesOfFile(item.blob, { format: step.format, position: step.position, margin: MARGIN, size: step.size, color: "#111111", start: step.start }));
    }
    case "header-footer": {
      const { headerFooterFile } = await client();
      const slots = { [`top-${step.align}`]: step.header, [`bottom-${step.align}`]: step.footer };
      return pdf(item, await headerFooterFile(item.blob, { slots, size: step.size, color: "#111111", margin: MARGIN, start: 1, date: options.date, file: item.name }));
    }
    case "grayscale":
      return pdf(item, (await (await client()).grayscaleFile(item.blob)).blob);
    case "flatten":
      return pdf(item, (await (await client()).flattenFile(item.blob, { forms: step.forms, annotations: step.annotations })).blob);
    case "compress": {
      const [{ compressFile }, { COMPRESS_PRESETS }] = await Promise.all([client(), import("../pdf/compress")]);
      return pdf(item, (await compressFile(item.blob, { ...COMPRESS_PRESETS[step.preset], removeMetadata: false })).blob);
    }
    case "ocr":
      return ocr(step, item, context);
    case "protect": {
      const { protectFile } = await client();
      const { password, allowPrinting, allowCopying, allowModifying } = step;
      return pdf(item, await protectFile(item.blob, { userPassword: password, allowPrinting, allowCopying, allowModifying }));
    }
    case "sign": {
      if (!options.certificate) throw new ProcessingError("Open a certificate to sign with first.", "invalid");
      const [{ signPdfFile }, { countPages }] = await Promise.all([import("../sign/client"), client()]);
      const appearance = step.visible ? { page: (await countPages(item.blob)) - 1, anchor: step.anchor } : null;
      const blob = await signPdfFile(item.blob, {
        certificate: options.certificate.file,
        password: options.certificate.password,
        reason: step.reason,
        location: step.location,
        contact: "",
        certify: step.certify ? step.certify : null,
        appearance,
      });
      return pdf(item, blob);
    }
    case "convert-image": {
      const { convertImageTo, TARGET_TYPES } = await import("../image/convert");
      const result = await convertImageTo(new Uint8Array(await item.blob.arrayBuffer()), item.blob.type, {
        format: step.format,
        quality: step.quality,
        resize: step.maxSide ? { mode: "fit", width: step.maxSide, height: step.maxSide } : { mode: "none" },
        background: null,
        iconSizes: [],
      });
      const target = TARGET_TYPES[step.format];
      return { kind: "image", name: replaceExtension(item.name, target.extension), blob: new Blob([result.bytes as BlobPart], { type: target.mime }) };
    }
    case "clean-media":
    case "convert-audio":
      return media(step, item, context);
    case "bates":
    case "merge":
      throw new Error(`${step.type} works on all the files together.`);
  }
}

async function toPdf(step: StepOf<"to-pdf">, item: BatchItem): Promise<BatchItem> {
  const name = asPdfName(item.name);
  const kind: FileKind = item.kind;
  switch (kind) {
    case "image": {
      const [{ imagesToPdfFile }, { DEFAULT_IMAGES_TO_PDF }] = await Promise.all([import("../pdf/client"), import("../pdf/images")]);
      const blob = await imagesToPdfFile([{ name: item.name, file: item.blob, rotate: 0 }], { ...DEFAULT_IMAGES_TO_PDF, pageSize: step.photoPages === "fit" ? "fit" : step.pageSize });
      return pdf(item, blob, name);
    }
    case "word": {
      const { wordToPdf } = await import("../office/client");
      return pdf(item, (await wordToPdf(item.blob, item.name, { pageSize: step.pageSize })).blob, name);
    }
    case "excel": {
      const { inspectSpreadsheet, spreadsheetToPdf } = await import("../office/client");
      const sheets = await inspectSpreadsheet(item.blob, item.name);
      const shown = sheets.filter((s) => !s.hidden && s.rows > 0);
      const names = (shown.length ? shown : sheets).map((s) => s.name);
      return pdf(item, (await spreadsheetToPdf(item.blob, item.name, { sheets: names, pageSize: step.pageSize, orientation: "auto", headerRow: false })).blob, name);
    }
    case "powerpoint": {
      const { powerPointToPdf } = await import("../convert/client");
      return pdf(item, (await powerPointToPdf(item.blob, item.name, { hiddenSlides: false })).blob, name);
    }
    case "text": {
      const { textFileToPdf } = await import("../convert/client");
      return pdf(item, (await textFileToPdf(item.blob, item.name, { pageSize: step.pageSize, margins: "normal", mono: false })).blob, name);
    }
    default:
      throw new ProcessingError("This kind of file can't be converted to PDF.", "unsupported");
  }
}

async function ocr(step: StepOf<"ocr">, item: BatchItem, context: StepContext): Promise<BatchItem> {
  const [{ openPdfForRendering }, { pagesWithText, recognizePages }, { addOcrTextToFile }] = await Promise.all([import("../pdf/render"), import("../ocr/engine"), import("../pdf/client")]);
  const { doc, destroy } = await openPdfForRendering(item.blob);
  try {
    const withText = step.skipText ? await pagesWithText(doc) : new Set<number>();
    const pages = Array.from({ length: doc.numPages }, (_, i) => i).filter((i) => !withText.has(i));
    // Every page already has text: nothing to add.
    if (!pages.length) return item;
    const results = await recognizePages(doc, pages, {
      languages: step.languages,
      signal: context.signal,
      onProgress: (p) => p.stage === "reading" && context.report((p.done + p.fraction) / p.total),
    });
    return pdf(item, await addOcrTextToFile(item.blob, results));
  } finally {
    destroy();
  }
}

async function media(step: StepOf<"clean-media"> | StepOf<"convert-audio">, item: BatchItem, context: StepContext): Promise<BatchItem> {
  const [{ mediaInputPath, probeMedia, runMedia }, { cleanJob, convertAudioJob }] = await Promise.all([import("../media/engine"), import("../media/jobs")]);
  const file = new File([item.blob], item.name, { type: item.blob.type });
  const onProgress = (p: { stage: string; fraction?: number | null }) => typeof p.fraction === "number" && p.stage === "working" && context.report(p.fraction);
  const run = { signal: context.signal, onProgress };
  const info = await probeMedia(file, run);
  const input = mediaInputPath(file);
  const job =
    step.type === "clean-media"
      ? cleanJob(info, input, item.name, { keepCover: step.keepCover })
      : convertAudioJob(info, input, { target: step.target, bitrate: step.bitrate, channels: null, normalize: step.normalize, trim: null });
  const blob = await runMedia(file, job, run);
  const name = item.name.toLowerCase().endsWith(job.container.extension) ? item.name : replaceExtension(item.name, job.container.extension);
  return { kind: step.type === "convert-audio" ? "audio" : item.kind, name, blob };
}
