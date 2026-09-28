import { defaultStep, type BatchStep } from "./steps";
import { msg } from "@/i18n/msg";

export interface BatchPreset {
  id: string;
  name: string;
  description: string;
  steps: (options: { ocrLanguage: string }) => BatchStep[];
}

/** Ready-made lists to start from; each can be changed before running. */
export const BATCH_PRESETS: BatchPreset[] = [
  {
    id: "share",
    name: msg("Share safely"),
    description: msg("Remove metadata, flatten forms and comments, then compress."),
    steps: () => [defaultStep("sanitize"), defaultStep("flatten"), defaultStep("compress")],
  },
  {
    id: "bundle",
    name: msg("Numbered bundle"),
    description: msg("Convert everything to PDF, add Bates numbers across the files, remove metadata."),
    steps: () => [defaultStep("to-pdf"), { ...defaultStep("bates"), prefix: "DOC-" }, defaultStep("sanitize")],
  },
  {
    id: "scans",
    name: msg("Searchable scans"),
    description: msg("Turn scans and photos into PDFs with selectable text, then compress."),
    steps: ({ ocrLanguage }) => [defaultStep("to-pdf"), { ...defaultStep("ocr"), languages: [ocrLanguage] }, defaultStep("compress")],
  },
  {
    id: "drafts",
    name: msg("Draft copies"),
    description: msg("A DRAFT watermark and page numbers on every PDF."),
    steps: () => [{ ...defaultStep("watermark"), text: "DRAFT", color: "#6b7280", opacity: 0.2 }, defaultStep("page-numbers")],
  },
  {
    id: "photos",
    name: msg("Photos for sharing"),
    description: msg("Remove location and camera details, and make photos JPGs up to 2048 pixels."),
    steps: () => [defaultStep("sanitize"), { ...defaultStep("convert-image"), maxSide: 2048 }],
  },
];
