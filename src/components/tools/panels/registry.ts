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

/**
 * Tool id -> workspace panel. Register panels with next/dynamic so heavy libraries (pdf-lib,
 * pdfjs, …) are only downloaded when their tool is opened, e.g.:
 *
 *   sanitize: dynamic(() => import("./SanitizePanel"), { ssr: false }),
 *
 * Tools without an entry show a "coming soon" card.
 */
export const TOOL_PANELS: Partial<Record<string, ComponentType<ToolPanelProps>>> = {};
