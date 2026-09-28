"use client";

import { useCallback } from "react";
import { detectFileKind, extensionsFor } from "@/lib/files";
import type { Tool } from "@/lib/tools";
import { useT } from "@/store/locale";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";

function sameFile(a: File, b: File) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/**
 * Returns a handler that opens files as workspace tabs for `tool`: files the tool can't read are
 * rejected and files that are already open are skipped (and focused), with a toast for each case.
 */
export function useAddFiles(tool: Tool) {
  const t = useT();
  return useCallback(
    (incoming: File[]) => {
      const { files: open, addFiles, setActiveFile } = useWorkspaceStore.getState();
      const accepted: File[] = [];
      const rejected: File[] = [];
      let firstDuplicateId: string | null = null;
      let duplicates = 0;

      for (const file of incoming) {
        if (!tool.accepts.includes(detectFileKind(file))) {
          rejected.push(file);
          continue;
        }
        const existing = open.find((f) => sameFile(f.file, file));
        if (existing || accepted.some((f) => sameFile(f, file))) {
          duplicates++;
          firstDuplicateId ??= existing?.id ?? null;
          continue;
        }
        accepted.push(file);
      }

      if (accepted.length > 0) {
        addFiles(accepted);
      } else if (firstDuplicateId) {
        setActiveFile(firstDuplicateId);
      }

      if (rejected.length > 0) {
        toast({
          tone: "warning",
          title: rejected.length === 1 ? t("“{name}” can’t be opened here", { name: rejected[0].name }) : t.plural(rejected.length, "{n} file can’t be opened here", "{n} files can’t be opened here"),
          description: t("{tool} accepts {formats}.", { tool: t(tool.name), formats: extensionsFor(tool.accepts).map(t.dynamic).join(", ") }),
        });
      }
      if (duplicates > 0) {
        toast({ tone: "info", title: t.plural(duplicates, "{n} file already open", "{n} files already open") });
      }
    },
    [tool, t],
  );
}
