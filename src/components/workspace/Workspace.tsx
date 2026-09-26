"use client";

import { useRef } from "react";
import { useAddFiles } from "@/hooks/useAddFiles";
import { usePasteFiles, useWindowFileDrop } from "@/hooks/useFileInputs";
import { acceptFor } from "@/lib/files";
import type { Tool } from "@/lib/tools";
import { useActiveFile, useWorkspaceStore } from "@/store/workspace";
import { DropOverlay, Dropzone } from "./Dropzone";
import { FilePanel } from "./FilePanel";
import { FileTabs } from "./FileTabs";

/**
 * The multi-tab editing area for a tool. Open files are global (they stay open when switching
 * tools) so the output of one tool can be fed straight into the next.
 */
export function Workspace({ tool }: { tool: Tool }) {
  const hasFiles = useWorkspaceStore((s) => s.files.length > 0);
  const activeFile = useActiveFile();
  const addFiles = useAddFiles(tool);
  const inputRef = useRef<HTMLInputElement>(null);

  const dragging = useWindowFileDrop(addFiles);
  usePasteFiles(addFiles);

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="flex flex-1 flex-col">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptFor(tool.accepts)}
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          // Reset so picking the same file again still fires onChange.
          e.target.value = "";
        }}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {hasFiles ? (
        <>
          <FileTabs tool={tool} onAddFiles={openPicker} />
          {activeFile && <FilePanel key={activeFile.id} tool={tool} file={activeFile} />}
        </>
      ) : (
        <Dropzone tool={tool} onBrowse={openPicker} />
      )}

      {dragging && <DropOverlay tool={tool} />}
    </div>
  );
}
