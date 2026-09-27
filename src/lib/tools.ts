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
  Bookmark,
  ClipboardPen,
  Contrast,
  Crop,
  FileMinus,
  FilePenLine,
  FilePlus2,
  FileSliders,
  FileX2,
  Hash,
  Layers2,
  PanelTop,
  RotateCw,
  Scaling,
  FileType,
  ImageDown,
  type LucideIcon,
} from "lucide-react";
import type { FileKind } from "./files";

export type ToolCategoryId = "privacy" | "edit" | "organize" | "security" | "convert" | "optimize";

export interface ToolCategory {
  id: ToolCategoryId;
  name: string;
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  { id: "privacy", name: "Sanitize & Privacy" },
  { id: "edit", name: "Edit & Sign" },
  { id: "organize", name: "Organize" },
  { id: "security", name: "Security" },
  { id: "convert", name: "Convert" },
  { id: "optimize", name: "Optimize" },
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
    id: "edit-metadata",
    name: "Edit Metadata",
    description: "Set a PDF's title, author, subject, keywords and dates to exactly what you want.",
    category: "privacy",
    icon: FileSliders,
    keywords: ["properties", "title", "author", "document info", "keywords", "change metadata"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "edit-pdf",
    name: "Edit PDF",
    description: "Add and edit text, white out, highlight, draw, add shapes, check marks, images, signatures and notes, all on one page.",
    category: "edit",
    icon: FilePenLine,
    keywords: ["edit text", "add text", "annotate", "highlight", "underline", "strikethrough", "draw", "pen", "whiteout", "erase", "shapes", "rectangle", "arrow", "check mark", "tick", "cross", "image", "sticky note", "comment", "typewriter", "fill"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "fill-pdf",
    name: "Fill PDF Form",
    description: "Type into a PDF form's fields, tick its boxes and pick its options, then save it, optionally flattened.",
    category: "edit",
    icon: ClipboardPen,
    keywords: ["form", "fill in", "fillable", "acroform", "fields", "application"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "header-footer",
    name: "Header & Footer",
    description: "Add text at the top and bottom of pages, with page numbers, the date or the file name.",
    category: "edit",
    icon: PanelTop,
    keywords: ["header", "footer", "running head", "page x of y", "date", "file name"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "bates",
    name: "Bates Numbering",
    description: "Number every page of one or more PDFs in one sequence, e.g. ACME-000001, for legal and audit work.",
    category: "edit",
    icon: Hash,
    keywords: ["legal", "discovery", "stamp numbers", "sequence", "exhibit"],
    accepts: ["pdf"],
    multiFile: true,
    status: "ready",
  },
  {
    id: "flatten",
    name: "Flatten PDF",
    description: "Make form answers, comments, highlights and stamps part of the page so they can't be changed.",
    category: "edit",
    icon: Layers2,
    keywords: ["lock form", "flatten annotations", "merge layers", "non editable"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    description: "Add, rename, nest and reorder the bookmarks (outline) readers show beside a PDF.",
    category: "edit",
    icon: Bookmark,
    keywords: ["outline", "table of contents", "toc", "navigation", "chapters"],
    accepts: ["pdf"],
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
    id: "rotate",
    name: "Rotate PDF",
    description: "Turn all pages or just the ones you pick, by 90° or 180°.",
    category: "organize",
    icon: RotateCw,
    keywords: ["turn", "orientation", "sideways", "upside down", "landscape"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "delete-pages",
    name: "Delete Pages",
    description: "Remove the pages you pick; they're purged from the file, not just hidden.",
    category: "organize",
    icon: FileMinus,
    keywords: ["remove pages", "delete", "drop pages"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "insert-pages",
    name: "Insert Pages",
    description: "Add blank pages, or pages from another PDF, anywhere in a document.",
    category: "organize",
    icon: FilePlus2,
    keywords: ["add pages", "blank page", "insert"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "crop",
    name: "Crop PDF",
    description: "Trim page edges by hand or remove white margins automatically.",
    category: "organize",
    icon: Crop,
    keywords: ["trim", "margins", "white space", "cut edges"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "resize-pages",
    name: "Resize Pages",
    description: "Change the paper size (A4, Letter, Legal, A3, A5 or custom), scaling content to fit.",
    category: "organize",
    icon: Scaling,
    keywords: ["page size", "a4", "letter", "paper size", "scale"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "remove-blank",
    name: "Remove Blank Pages",
    description: "Find blank pages, including scanned ones, and remove them in one go.",
    category: "organize",
    icon: FileX2,
    keywords: ["empty pages", "blank", "scanner", "clean up"],
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
    id: "grayscale",
    name: "Grayscale PDF",
    description: "Turn a PDF's text, drawings and photos gray, for printing without colour ink.",
    category: "optimize",
    icon: Contrast,
    keywords: ["black and white", "monochrome", "greyscale", "no colour", "print"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "sign",
    name: "E-Sign PDF",
    description: "Draw or upload a signature and place it anywhere on a page.",
    category: "edit",
    icon: Signature,
    keywords: ["signature", "e-sign", "esign", "sign document", "date", "initials"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "watermark",
    name: "Watermark",
    description: "Stamp text or an image on every page, or just the pages you pick.",
    category: "edit",
    icon: Stamp,
    keywords: ["stamp", "draft", "confidential", "logo", "overlay"],
    accepts: ["pdf"],
    status: "ready",
  },
  {
    id: "page-numbers",
    name: "Page Numbers",
    description: "Add page numbers with your choice of position and format.",
    category: "edit",
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
