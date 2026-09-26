"use client";

import { useCallback } from "react";
import { detectFileKind, extensionsFor } from "@/lib/files";
import type { Tool } from "@/lib/tools";
import { toast } from "@/store/toast";
import { useWorkspaceStore } from "@/store/workspace";

function sameFile(a: File, b: File) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Returns a handler that opens files as workspace tabs for `tool`: files the tool can't read are
 * rejected and files that are already open are skipped (and focused), with a toast for each case.
 */
export function useAddFiles(tool: Tool) {
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
          title:
            rejected.length === 1
              ? `“${rejected[0].name}” can’t be opened here`
              : `${plural(rejected.length, "file")} can’t be opened here`,
          description: `${tool.name} accepts ${extensionsFor(tool.accepts).join(", ")}.`,
        });
      }
      if (duplicates > 0) {
        toast({ tone: "info", title: `${plural(duplicates, "file")} already open` });
      }
    },
    [tool],
  );
}
