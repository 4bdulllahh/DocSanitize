"use client";

import { useEffect, useState } from "react";
import type { EditObject } from "@/lib/pdf/edit/types";

export interface EditorImage {
  bytes: Uint8Array;
  format: "png" | "jpeg";
  /** Object URL for showing it in the editor. */
  url: string;
  width: number;
  height: number;
}

interface History {
  past: EditObject[][];
  present: EditObject[];
  future: EditObject[][];
  /** Changes with the same key in a row become one undo step (a drag, a slider being moved). */
  key: string | null;
  at: number;
}

export interface Draft {
  history: History;
  images: Record<string, EditorImage>;
}

/**
 * Unsaved edits, per file version, kept in memory while the tab is open so switching tools or
 * tabs doesn't lose them. Never stored anywhere else.
 */
const drafts = new Map<string, Draft>();

const LIMIT = 200;
/** Keyed changes further apart than this start a new undo step (gesture keys never do). */
const MERGE_MS = 1000;

export function useEditorState(draftKey: string) {
  const [draft, setDraft] = useState<Draft>(() => drafts.get(draftKey) ?? { history: { past: [], present: [], future: [], key: null, at: 0 }, images: {} });

  useEffect(() => {
    drafts.set(draftKey, draft);
  }, [draftKey, draft]);

  const { history } = draft;

  /** Change the objects. Pass a key to merge consecutive changes into one undo step. */
  const change = (fn: (objects: EditObject[]) => EditObject[], key?: string) =>
    setDraft((d) => {
      const h = d.history;
      const next = fn(h.present);
      if (next === h.present) return d;
      const now = Date.now();
      const merge = key != null && key === h.key && (key.startsWith("gesture:") || now - h.at < MERGE_MS);
      return {
        ...d,
        history: {
          past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
          present: next,
          future: [],
          key: key ?? null,
          at: now,
        },
      };
    });

  const undo = () =>
    setDraft((d) => {
      const h = d.history;
      if (!h.past.length) return d;
      return { ...d, history: { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: null, at: 0 } };
    });

  const redo = () =>
    setDraft((d) => {
      const h = d.history;
      if (!h.future.length) return d;
      return { ...d, history: { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), key: null, at: 0 } };
    });

  const addImage = (id: string, image: EditorImage) => setDraft((d) => ({ ...d, images: { ...d.images, [id]: image } }));

  /** Start again from the saved file (after "Replace the file in this tab" the key changes anyway). */
  const reset = () => setDraft((d) => ({ ...d, history: { past: [], present: [], future: [], key: null, at: 0 } }));

  return {
    objects: history.present,
    images: draft.images,
    change,
    undo,
    redo,
    reset,
    addImage,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

export type EditorState = ReturnType<typeof useEditorState>;
