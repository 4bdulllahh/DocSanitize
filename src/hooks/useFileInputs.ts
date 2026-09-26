"use client";

import { useEffect, useEffectEvent, useState } from "react";

function carriesFiles(e: DragEvent) {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Accept files dropped anywhere in the window. Returns true while files are being dragged over
 * the page so a drop overlay can be shown. Internal drags (e.g. reordering tabs) are ignored.
 */
export function useWindowFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const handleFiles = useEffectEvent(onFiles);

  useEffect(() => {
    // dragenter/dragleave fire for every child element crossed, so track nesting depth.
    let depth = 0;

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) handleFiles(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return dragging;
}

/** Accept files pasted with Ctrl/Cmd+V (e.g. a copied screenshot), unless the user is typing. */
export function usePasteFiles(onFiles: (files: File[]) => void) {
  const handleFiles = useEffectEvent(onFiles);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      handleFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
}

/** Warn before closing or reloading the tab while `active` — open files live only in memory. */
export function useUnloadWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
