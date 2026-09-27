import {
  Combine,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  FileText,
  Images,
  LayoutGrid,
  ListOrdered,
  Lock,
  LockOpen,
  ScanSearch,
  Scissors,
  Sheet,
  Shrink,
  Signature,
  Stamp,
  FileType,
  type LucideIcon,
} from "lucide-react";
import type { FileKind } from "./files";

export type ToolCategoryId = "privacy" | "organize" | "security" | "convert" | "optimize";

export interface ToolCategory {
  id: ToolCategoryId;
  name: string;
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  { id: "privacy", name: "Sanitize & Privacy" },
  { id: "organize", name: "Organize" },
  { id: "security", name: "Security" },
  { id: "convert", name: "Convert" },
  { id: "optimize", name: "Optimize & Markup" },
];

export interface Tool {
  /** URL slug: /tools/<id> */
  id: string;
  name: string;
  description: string;
  category: ToolCategoryId;
  icon: LucideIcon;
  /** File kinds this tool can take as input. */
  accepts: FileKind[];
  /** Whether the tool works on several files at once (e.g. merge). */
  multiFile?: boolean;
  /** Flip to "ready" once the tool's workspace is implemented. */
  status: "ready" | "planned";
}

export const TOOLS: Tool[] = [
  {
    id: "sanitize",
    name: "Sanitize Metadata",
    description: "Audit hidden metadata (EXIF, XMP, PDF info), strip it in one click, and verify the result is clean.",
    category: "privacy",
    icon: ScanSearch,
    accepts: ["pdf", "image"],
    status: "ready",
  },
  {
    id: "merge",
    name: "Merge PDF",
    description: "Combine several PDFs into one document in the order you choose.",
    category: "organize",
    icon: Combine,
    accepts: ["pdf"],
    multiFile: true,
    status: "ready",
  },
  {
    id: "split",
    name: "Split PDF",
    description: "Extract page ranges or split a PDF into separate files.",
    category: "organize",
    icon: Scissors,
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "organize",
    name: "Organize Pages",
    description: "Reorder, rotate and delete pages on a visual drag-and-drop grid.",
    category: "organize",
    icon: LayoutGrid,
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "protect",
    name: "Protect PDF",
    description: "Encrypt a PDF with a password using AES.",
    category: "security",
    icon: Lock,
    accepts: ["pdf"],
    status: "planned",
  },
  {
    id: "unlock",
    name: "Unlock PDF",
    description: "Remove the password from a PDF you have access to.",
    category: "security",
    icon: LockOpen,
    accepts: ["pdf"],
    status: "planned",
  },
  {
    id: "redact",
    name: "Redact PDF",
    description: "Black out sensitive areas and permanently remove the content underneath.",
    category: "security",
    icon: EyeOff,
    accepts: ["pdf"],
    status: "planned",
  },
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    description: "Turn JPG, PNG and WebP images into a single PDF.",
    category: "convert",
    icon: FileImage,
    accepts: ["image"],
    multiFile: true,
    status: "ready",
  },
  {
    id: "pdf-to-images",
    name: "PDF to Images",
    description: "Export every page of a PDF as a JPG, PNG or WebP image.",
    category: "convert",
    icon: Images,
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    description: "Extract the text of a PDF into an editable .docx document.",
    category: "convert",
    icon: FileText,
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Extract tables from a PDF into an .xlsx spreadsheet.",
    category: "convert",
    icon: FileSpreadsheet,
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    description: "Convert a .docx document to PDF, keeping headings, lists, tables and images.",
    category: "convert",
    icon: FileType,
    accepts: ["word"],
    status: "ready",
  },
  {
    id: "excel-to-pdf",
    name: "Excel to PDF",
    description: "Turn Excel, OpenDocument or CSV sheets into paginated PDF tables.",
    category: "convert",
    icon: Sheet,
    accepts: ["excel"],
    status: "ready",
  },
  {
    id: "compress",
    name: "Compress PDF",
    description: "Shrink a PDF by downscaling and re-encoding its embedded images.",
    category: "optimize",
    icon: Shrink,
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "sign",
    name: "E-Sign PDF",
    description: "Draw or upload a signature and place it anywhere on a page.",
    category: "optimize",
    icon: Signature,
    accepts: ["pdf"],
    status: "planned",
  },
  {
    id: "watermark",
    name: "Watermark",
    description: "Stamp text across every page of a PDF.",
    category: "optimize",
    icon: Stamp,
    accepts: ["pdf"],
    status: "planned",
  },
  {
    id: "page-numbers",
    name: "Page Numbers",
    description: "Add page numbers with your choice of position and format.",
    category: "optimize",
    icon: ListOrdered,
    accepts: ["pdf"],
    status: "planned",
  },
];

export function getTool(id: string): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

export function toolsInCategory(category: ToolCategoryId): Tool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

export function toolsAccepting(kind: FileKind): Tool[] {
  return TOOLS.filter((tool) => tool.accepts.includes(kind));
}
