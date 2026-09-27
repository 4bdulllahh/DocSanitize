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
  merge: dynamic(() => import("./merge/MergePanel"), { ssr: false, loading: PanelSkeleton }),
  split: dynamic(() => import("./split/SplitPanel"), { ssr: false, loading: PanelSkeleton }),
  organize: dynamic(() => import("./organize/OrganizePanel"), { ssr: false, loading: PanelSkeleton }),
  "images-to-pdf": dynamic(() => import("./images-to-pdf/ImagesToPdfPanel"), { ssr: false, loading: PanelSkeleton }),
  "pdf-to-images": dynamic(() => import("./pdf-to-images/PdfToImagesPanel"), { ssr: false, loading: PanelSkeleton }),
  compress: dynamic(() => import("./compress/CompressPanel"), { ssr: false, loading: PanelSkeleton }),
};
