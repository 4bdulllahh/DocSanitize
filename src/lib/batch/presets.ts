import { defaultStep, type BatchStep } from "./steps";

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
    name: "Share safely",
    description: "Remove metadata, flatten forms and comments, then compress.",
    steps: () => [defaultStep("sanitize"), defaultStep("flatten"), defaultStep("compress")],
  },
  {
    id: "bundle",
    name: "Numbered bundle",
    description: "Convert everything to PDF, add Bates numbers across the files, remove metadata.",
    steps: () => [defaultStep("to-pdf"), { ...defaultStep("bates"), prefix: "DOC-" }, defaultStep("sanitize")],
  },
  {
    id: "scans",
    name: "Searchable scans",
    description: "Turn scans and photos into PDFs with selectable text, then compress.",
    steps: ({ ocrLanguage }) => [defaultStep("to-pdf"), { ...defaultStep("ocr"), languages: [ocrLanguage] }, defaultStep("compress")],
  },
  {
    id: "drafts",
    name: "Draft copies",
    description: "A DRAFT watermark and page numbers on every PDF.",
    steps: () => [{ ...defaultStep("watermark"), text: "DRAFT", color: "#6b7280", opacity: 0.2 }, defaultStep("page-numbers")],
  },
  {
    id: "photos",
    name: "Photos for sharing",
    description: "Remove location and camera details, and make photos JPGs up to 2048 pixels.",
    steps: () => [defaultStep("sanitize"), { ...defaultStep("convert-image"), maxSide: 2048 }],
  },
];
