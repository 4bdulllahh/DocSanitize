import { LINE_HEIGHT, type Box, type EditObject } from "./types";

/*
 * Object geometry shared by the editor and the PDF writer (no pdf-lib here, so the editor can
 * import it cheaply).
 */

/** Width of the longest line of a text object. Browsers pass a measurer; otherwise it's estimated. */
export type TextMeasure = (object: Extract<EditObject, { kind: "text" | "replace" }>) => number;

const estimate: TextMeasure = (object) => Math.max(...object.text.split("\n").map((l) => l.length), 1) * object.size * 0.6;

/** The area an object covers, in displayed coordinates, padded for strokes. */
export function bounds(object: EditObject, measure: TextMeasure = estimate): Box {
  const pad = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });
  const fromPoints = (xs: number[], ys: number[]): Box => ({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
  switch (object.kind) {
    case "rect":
    case "ellipse":
      return pad(object, object.stroke ? object.strokeWidth : 0);
    case "whiteout":
    case "image":
      return object;
    case "line":
    case "arrow":
      return pad(fromPoints([object.x1, object.x2], [object.y1, object.y2]), Math.max(object.strokeWidth * 4, 8));
    case "ink": {
      const xs = object.strokes.flatMap((s) => s.filter((_, i) => i % 2 === 0));
      const ys = object.strokes.flatMap((s) => s.filter((_, i) => i % 2 === 1));
      return pad(fromPoints(xs, ys), object.strokeWidth);
    }
    case "highlight":
    case "underline":
    case "strikeout":
      return fromPoints(
        object.rects.flatMap((r) => [r.x, r.x + r.width]),
        object.rects.flatMap((r) => [r.y, r.y + r.height]),
      );
    case "check":
    case "cross":
    case "dot":
      return { x: object.x, y: object.y, width: object.size, height: object.size };
    case "note":
      return { x: object.x, y: object.y, width: 20, height: 20 };
    case "text":
    case "replace": {
      const lines = object.text.split("\n");
      const box = { x: object.x, y: object.y, width: Math.max(measure(object), object.size * 0.5), height: lines.length * LINE_HEIGHT * object.size };
      return object.kind === "replace" ? fromPoints([box.x, box.x + box.width, object.cover.x, object.cover.x + object.cover.width], [box.y, box.y + box.height, object.cover.y, object.cover.y + object.cover.height]) : box;
    }
  }
}


/** Move an object by dx, dy points. */
export function moveObject<T extends EditObject>(object: T, dx: number, dy: number): T {
  switch (object.kind) {
    case "line":
    case "arrow":
      return { ...object, x1: object.x1 + dx, y1: object.y1 + dy, x2: object.x2 + dx, y2: object.y2 + dy };
    case "ink":
      return { ...object, strokes: object.strokes.map((s) => s.map((v, i) => v + (i % 2 ? dy : dx))) };
    case "highlight":
    case "underline":
    case "strikeout":
      return { ...object, rects: object.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) };
    default:
      return { ...object, x: (object as { x: number }).x + dx, y: (object as { y: number }).y + dy };
  }
}
