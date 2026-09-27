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
  ImageDown,
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
  /** Other words people search for this tool by (synonyms, formats, tasks). */
  keywords?: string[];
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
    keywords: ["exif", "gps", "location", "privacy", "clean", "remove metadata", "strip", "author", "iphone", "photo", "heic", "xmp", "hidden data"],
    accepts: ["pdf", "image"],
    status: "ready",
  },
  {
    id: "merge",
    name: "Merge PDF",
    description: "Combine several PDFs into one document in the order you choose.",
    category: "organize",
    icon: Combine,
    keywords: ["combine", "join", "append", "put together"],
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
    keywords: ["extract pages", "separate", "divide", "cut", "pages"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "organize",
    name: "Organize Pages",
    description: "Reorder, rotate and delete pages on a visual drag-and-drop grid.",
    category: "organize",
    icon: LayoutGrid,
    keywords: ["reorder", "rotate", "delete pages", "remove pages", "sort", "arrange", "move pages"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "protect",
    name: "Protect PDF",
    description: "Encrypt a PDF with a password (AES-256) and control printing and copying.",
    category: "security",
    icon: Lock,
    keywords: ["password", "encrypt", "lock", "secure", "aes"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "unlock",
    name: "Unlock PDF",
    description: "Remove the password or restrictions from a PDF you have access to.",
    category: "security",
    icon: LockOpen,
    keywords: ["remove password", "decrypt", "open locked", "unprotect"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "redact",
    name: "Redact PDF",
    description: "Black out sensitive areas and permanently remove the content underneath.",
    category: "security",
    icon: EyeOff,
    keywords: ["black out", "censor", "hide text", "blackout", "remove text", "confidential"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    description: "Turn JPG, PNG, WebP, HEIC and AVIF images into a single PDF.",
    category: "convert",
    icon: FileImage,
    keywords: ["jpg to pdf", "png to pdf", "photo to pdf", "heic to pdf", "scan", "pictures"],
    accepts: ["image"],
    multiFile: true,
    status: "ready",
  },
  {
    id: "heic-to-jpg",
    name: "HEIC to JPG",
    description: "Convert iPhone HEIC photos, and AVIF, WebP or PNG images, to JPG or PNG. Location and camera details aren't copied.",
    category: "convert",
    icon: ImageDown,
    keywords: ["iphone", "photo", "convert image", "heif", "avif", "webp", "png", "jpeg", "image converter"],
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
    keywords: ["pdf to jpg", "pdf to png", "export pages", "screenshot", "picture"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    description: "Extract the text of a PDF into an editable .docx document.",
    category: "convert",
    icon: FileText,
    keywords: ["docx", "doc", "editable", "text", "convert"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Extract tables from a PDF into an .xlsx spreadsheet.",
    category: "convert",
    icon: FileSpreadsheet,
    keywords: ["xlsx", "table", "spreadsheet", "csv", "convert"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    description: "Convert a .docx document to PDF, keeping headings, lists, tables and images.",
    category: "convert",
    icon: FileType,
    keywords: ["docx", "doc", "document", "convert"],
    accepts: ["word"],
    status: "ready",
  },
  {
    id: "excel-to-pdf",
    name: "Excel to PDF",
    description: "Turn Excel, OpenDocument or CSV sheets into paginated PDF tables.",
    category: "convert",
    icon: Sheet,
    keywords: ["xlsx", "csv", "spreadsheet", "ods", "convert"],
    accepts: ["excel"],
    status: "ready",
  },
  {
    id: "compress",
    name: "Compress PDF",
    description: "Shrink a PDF by downscaling and re-encoding its embedded images.",
    category: "optimize",
    icon: Shrink,
    keywords: ["reduce size", "shrink", "smaller", "optimize", "email"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "sign",
    name: "E-Sign PDF",
    description: "Draw or upload a signature and place it anywhere on a page.",
    category: "optimize",
    icon: Signature,
    keywords: ["signature", "e-sign", "esign", "sign document", "date", "initials"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "watermark",
    name: "Watermark",
    description: "Stamp text or an image on every page, or just the pages you pick.",
    category: "optimize",
    icon: Stamp,
    keywords: ["stamp", "draft", "confidential", "logo", "overlay"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "page-numbers",
    name: "Page Numbers",
    description: "Add page numbers with your choice of position and format.",
    category: "optimize",
    icon: ListOrdered,
    keywords: ["number pages", "footer", "header", "pagination", "page x of y"],
    accepts: ["pdf"],
    status: "ready",
  },
];

export function getTool(id: string): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

export function toolsInCategory(category: ToolCategoryId): Tool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

/**
 * Tools matching a search, best first. Every word must match the tool's name, keywords,
 * description or category; matches in the name count most.
 */
export function searchTools(query: string): Tool[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return TOOLS.filter((t) => t.status === "ready");
  const scored = TOOLS.filter((t) => t.status === "ready").map((tool) => {
    const name = tool.name.toLowerCase();
    const keywords = (tool.keywords ?? []).join(" | ").toLowerCase();
    const description = tool.description.toLowerCase();
    const category = TOOL_CATEGORIES.find((c) => c.id === tool.category)!.name.toLowerCase();
    let score = 0;
    for (const word of words) {
      const inName = name.split(/[^a-z0-9]+/).some((part) => part.startsWith(word)) ? 6 : name.includes(word) ? 4 : 0;
      const inKeywords = keywords.split(/[^a-z0-9-]+/).some((part) => part.startsWith(word)) ? 3 : keywords.includes(word) ? 2 : 0;
      const elsewhere = description.includes(word) || category.includes(word) ? 1 : 0;
      const best = Math.max(inName, inKeywords, elsewhere);
      if (best === 0) return { tool, score: 0 };
      score += best;
    }
    // A phrase match ("pdf to word") beats the same words scattered around.
    if (name.includes(words.join(" "))) score += 4;
    return { tool, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.tool);
}

export function toolsAccepting(kind: FileKind): Tool[] {
  return TOOLS.filter((tool) => tool.accepts.includes(kind));
}
