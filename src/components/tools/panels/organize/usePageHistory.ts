"use client";

import { useCallback, useReducer } from "react";

export interface PageItem {
  /** Stable key for drag-and-drop. */
  id: string;
  /** 0-based index in the original document. */
  index: number;
  /** Extra clockwise rotation in degrees. */
  rotate: number;
  deleted: boolean;
}

interface History {
  past: PageItem[][];
  present: PageItem[];
  future: PageItem[][];
}

type Action =
  | { type: "commit"; pages: PageItem[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; pages: PageItem[] };

const LIMIT = 100;

function reducer(state: History, action: Action): History {
  switch (action.type) {
    case "commit":
      return { past: [...state.past, state.present].slice(-LIMIT), present: action.pages, future: [] };
    case "undo":
      if (state.past.length === 0) return state;
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
    case "redo":
      if (state.future.length === 0) return state;
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
    case "reset":
      return { past: [...state.past, state.present].slice(-LIMIT), present: action.pages, future: [] };
  }
}

export function initialPages(count: number): PageItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, index: i, rotate: 0, deleted: false }));
}

/** Page list with unlimited-feeling undo/redo (last 100 steps). */
export function usePageHistory(count: number) {
  const [state, dispatch] = useReducer(reducer, count, (n) => ({ past: [], present: initialPages(n), future: [] }));
  return {
    pages: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback((pages: PageItem[]) => dispatch({ type: "commit", pages }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback(() => dispatch({ type: "reset", pages: initialPages(count) }), [count]),
  };
}
