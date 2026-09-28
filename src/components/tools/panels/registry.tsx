import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { Tool } from "@/lib/tools";
import type { WorkspaceFile } from "@/store/workspace";

export interface ToolPanelProps {
  tool: Tool;
  /** The file in the active tab (always one the tool accepts). */
  file: WorkspaceFile;
  /** Every open file the tool accepts, in tab order — for multi-file tools such as Merge. */
  files: WorkspaceFile[];
}

function PanelSkeleton() {
  return <div className="h-96 animate-pulse rounded-xl border border-line bg-surface" aria-busy="true" />;
}

/**
 * Tool id -> workspace panel. Panels are loaded with next/dynamic so heavy libraries (pdf-lib,
 * pdfjs, …) are only downloaded when their tool is opened. Tools without an entry show a
 * "coming soon" card; remember to flip the tool's `status` to "ready" in lib/tools.ts.
 */
export const TOOL_PANELS: Partial<Record<string, ComponentType<ToolPanelProps>>> = {
  sanitize: dynamic(() => import("./sanitize/SanitizePanel"), { ssr: false, loading: PanelSkeleton }),
  "find-pii": dynamic(() => import("./inspect/FindPiiPanel"), { ssr: false, loading: PanelSkeleton }),
  "inspect-pdf": dynamic(() => import("./inspect/InspectPdfPanel"), { ssr: false, loading: PanelSkeleton }),
  "inspect-office": dynamic(() => import("./inspect/InspectOfficePanel"), { ssr: false, loading: PanelSkeleton }),
  "image-forensics": dynamic(() => import("./inspect/ImageForensicsPanel"), { ssr: false, loading: PanelSkeleton }),
  "check-file": dynamic(() => import("./inspect/CheckFilePanel"), { ssr: false, loading: PanelSkeleton }),
  "check-links": dynamic(() => import("./inspect/CheckLinksPanel"), { ssr: false, loading: PanelSkeleton }),
  "edit-pdf": dynamic(() => import("./edit/EditPanel"), { ssr: false, loading: PanelSkeleton }),
  "fill-pdf": dynamic(() => import("./fill/FillPanel"), { ssr: false, loading: PanelSkeleton }),
  "edit-metadata": dynamic(() => import("./document/DocumentPanels").then((m) => m.PropertiesPanel), { ssr: false, loading: PanelSkeleton }),
  bookmarks: dynamic(() => import("./document/DocumentPanels").then((m) => m.BookmarksPanel), { ssr: false, loading: PanelSkeleton }),
  "header-footer": dynamic(() => import("./markup/NumberingPanels").then((m) => m.HeaderFooterPanel), { ssr: false, loading: PanelSkeleton }),
  bates: dynamic(() => import("./markup/NumberingPanels").then((m) => m.BatesPanel), { ssr: false, loading: PanelSkeleton }),
  rotate: dynamic(() => import("./pages/PagePanels").then((m) => m.RotatePanel), { ssr: false, loading: PanelSkeleton }),
  "delete-pages": dynamic(() => import("./pages/PagePanels").then((m) => m.DeletePagesPanel), { ssr: false, loading: PanelSkeleton }),
  "insert-pages": dynamic(() => import("./pages/PagePanels").then((m) => m.InsertPagesPanel), { ssr: false, loading: PanelSkeleton }),
  "resize-pages": dynamic(() => import("./pages/PagePanels").then((m) => m.ResizePanel), { ssr: false, loading: PanelSkeleton }),
  grayscale: dynamic(() => import("./pages/PagePanels").then((m) => m.GrayscalePanel), { ssr: false, loading: PanelSkeleton }),
  flatten: dynamic(() => import("./pages/PagePanels").then((m) => m.FlattenPanel), { ssr: false, loading: PanelSkeleton }),
  crop: dynamic(() => import("./pages/ScanPanels").then((m) => m.CropPanel), { ssr: false, loading: PanelSkeleton }),
  "remove-blank": dynamic(() => import("./pages/ScanPanels").then((m) => m.RemoveBlankPanel), { ssr: false, loading: PanelSkeleton }),
  merge: dynamic(() => import("./merge/MergePanel"), { ssr: false, loading: PanelSkeleton }),
  split: dynamic(() => import("./split/SplitPanel"), { ssr: false, loading: PanelSkeleton }),
  organize: dynamic(() => import("./organize/OrganizePanel"), { ssr: false, loading: PanelSkeleton }),
  "images-to-pdf": dynamic(() => import("./images-to-pdf/ImagesToPdfPanel"), { ssr: false, loading: PanelSkeleton }),
  "heic-to-jpg": dynamic(() => import("./convert-image/ConvertImagePanel"), { ssr: false, loading: PanelSkeleton }),
  "pdf-to-images": dynamic(() => import("./pdf-to-images/PdfToImagesPanel"), { ssr: false, loading: PanelSkeleton }),
  ocr: dynamic(() => import("./ocr/OcrPanel"), { ssr: false, loading: PanelSkeleton }),
  translate: dynamic(() => import("./translate/TranslatePanel"), { ssr: false, loading: PanelSkeleton }),
  compress: dynamic(() => import("./compress/CompressPanel"), { ssr: false, loading: PanelSkeleton }),
  "pdf-to-word": dynamic(() => import("./pdf-to-office/PdfToOfficePanels").then((m) => m.PdfToWordPanel), { ssr: false, loading: PanelSkeleton }),
  "pdf-to-excel": dynamic(() => import("./pdf-to-office/PdfToOfficePanels").then((m) => m.PdfToExcelPanel), { ssr: false, loading: PanelSkeleton }),
  "word-to-pdf": dynamic(() => import("./office-to-pdf/OfficeToPdfPanels").then((m) => m.WordToPdfPanel), { ssr: false, loading: PanelSkeleton }),
  protect: dynamic(() => import("./security/SecurityPanels").then((m) => m.ProtectPanel), { ssr: false, loading: PanelSkeleton }),
  unlock: dynamic(() => import("./security/SecurityPanels").then((m) => m.UnlockPanel), { ssr: false, loading: PanelSkeleton }),
  redact: dynamic(() => import("./redact/RedactPanel"), { ssr: false, loading: PanelSkeleton }),
  sign: dynamic(() => import("./sign/SignPanel"), { ssr: false, loading: PanelSkeleton }),
  watermark: dynamic(() => import("./markup/StampPanels").then((m) => m.WatermarkPanel), { ssr: false, loading: PanelSkeleton }),
  "page-numbers": dynamic(() => import("./markup/StampPanels").then((m) => m.PageNumbersPanel), { ssr: false, loading: PanelSkeleton }),
  "excel-to-pdf": dynamic(() => import("./office-to-pdf/OfficeToPdfPanels").then((m) => m.ExcelToPdfPanel), { ssr: false, loading: PanelSkeleton }),
};
