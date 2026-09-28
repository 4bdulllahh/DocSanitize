import { File, FileCode, FileImage, FileSpreadsheet, FileText, FileType, Presentation, type LucideProps } from "lucide-react";
import type { FileKind } from "@/lib/files";

const ICONS = {
  pdf: FileText,
  image: FileImage,
  word: FileType,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  text: FileCode,
  unknown: File,
} satisfies Record<FileKind, unknown>;

export function KindIcon({ kind, ...props }: { kind: FileKind } & LucideProps) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden="true" {...props} />;
}
