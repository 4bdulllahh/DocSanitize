import { create } from "zustand";
import { createId, detectFileKind, type FileKind } from "@/lib/files";

export type FileStatus = "idle" | "processing" | "done" | "error";

export interface ProcessedOutput {
  blob: Blob;
  name: string;
}

/**
 * One open document in the workspace. Each entry is rendered as its own tab.
 * Files live only in memory (File/Blob objects) and are never persisted or uploaded.
 */
export interface WorkspaceFile {
  id: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  kind: FileKind;
  addedAt: number;
  /** Bumped whenever the tab's content is replaced, so views keyed on it re-read the file. */
  revision: number;
  status: FileStatus;
  /** 0–100 while status is "processing". */
  progress?: number;
  error?: string;
  /** Latest result produced by a tool, ready to download or promote to the working copy. */
  output?: ProcessedOutput;
}

type FilePatch = Partial<Pick<WorkspaceFile, "status" | "progress" | "error" | "output">>;

interface WorkspaceState {
  files: WorkspaceFile[];
  activeFileId: string | null;

  /** Add files as new tabs; the first added file becomes active. Returns the created entries. */
  addFiles: (files: Iterable<File>) => WorkspaceFile[];
  removeFile: (id: string) => void;
  clearFiles: () => void;
  setActiveFile: (id: string) => void;
  updateFile: (id: string, patch: FilePatch) => void;
  /** Swap a tab's underlying file for new content (e.g. after sanitizing) so tools can be chained. */
  replaceFileContent: (id: string, blob: Blob, name?: string) => void;
  reorderFiles: (fromIndex: number, toIndex: number) => void;
}

function toWorkspaceFile(file: File): WorkspaceFile {
  return {
    id: createId(),
    file,
    name: file.name,
    size: file.size,
    mimeType: file.type,
    kind: detectFileKind(file),
    addedAt: Date.now(),
    revision: 0,
    status: "idle",
  };
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  files: [],
  activeFileId: null,

  addFiles: (incoming) => {
    const added = Array.from(incoming, toWorkspaceFile);
    if (added.length === 0) return added;
    set((state) => ({
      files: [...state.files, ...added],
      activeFileId: added[0].id,
    }));
    return added;
  },

  removeFile: (id) =>
    set((state) => {
      const index = state.files.findIndex((f) => f.id === id);
      if (index === -1) return state;
      const files = state.files.filter((f) => f.id !== id);
      let activeFileId = state.activeFileId;
      if (activeFileId === id) {
        // Focus the neighbouring tab, preferring the one to the left like a browser.
        activeFileId = files[Math.max(0, index - 1)]?.id ?? null;
      }
      return { files, activeFileId };
    }),

  clearFiles: () => set({ files: [], activeFileId: null }),

  setActiveFile: (id) => set({ activeFileId: id }),

  updateFile: (id, patch) =>
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  replaceFileContent: (id, blob, name) =>
    set((state) => ({
      files: state.files.map((f) => {
        if (f.id !== id) return f;
        const nextName = name ?? f.name;
        const file = new File([blob], nextName, { type: blob.type || f.mimeType });
        return {
          ...f,
          file,
          name: nextName,
          size: file.size,
          mimeType: file.type,
          revision: f.revision + 1,
          status: "idle",
          progress: undefined,
          error: undefined,
          output: undefined,
        };
      }),
    })),

  reorderFiles: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return state;
      const files = [...state.files];
      const [moved] = files.splice(fromIndex, 1);
      if (!moved) return state;
      files.splice(toIndex, 0, moved);
      return { files };
    }),
}));

export function useActiveFile(): WorkspaceFile | undefined {
  return useWorkspaceStore((state) => state.files.find((f) => f.id === state.activeFileId));
}
