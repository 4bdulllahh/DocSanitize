import { create } from "zustand";
import { createId } from "@/lib/files";
import type { BatchStep } from "@/lib/batch/steps";

/*
 * The steps chosen in Batch Process, kept while switching tools. Memory only: gone when the tab
 * closes (a list can be saved as a file instead).
 */

export type BatchEntry = { id: string; step: BatchStep };

interface BatchState {
  entries: BatchEntry[];
  /** The step whose settings are open. */
  openId: string | null;
  add: (step: BatchStep) => void;
  replaceAll: (steps: BatchStep[]) => void;
  update: (id: string, step: BatchStep) => void;
  remove: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
  setOpen: (id: string | null) => void;
}

const entry = (step: BatchStep): BatchEntry => ({ id: createId(), step });

export const useBatchStore = create<BatchState>()((set) => ({
  entries: [],
  openId: null,
  add: (step) =>
    set((s) => {
      const added = entry(step);
      return { entries: [...s.entries, added], openId: added.id };
    }),
  replaceAll: (steps) => set({ entries: steps.map(entry), openId: null }),
  update: (id, step) => set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, step } : e)) })),
  remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id), openId: s.openId === id ? null : s.openId })),
  move: (id, by) =>
    set((s) => {
      const from = s.entries.findIndex((e) => e.id === id);
      const to = from + by;
      if (from === -1 || to < 0 || to >= s.entries.length) return s;
      const entries = [...s.entries];
      [entries[from], entries[to]] = [entries[to], entries[from]];
      return { entries };
    }),
  setOpen: (id) => set({ openId: id }),
}));
