"use client";

import type { CSSProperties, ReactNode } from "react";
import { baselineOffset, LINE_HEIGHT, type EditObject } from "@/lib/pdf/edit/types";
import { CSS_FONTS } from "./model";
import type { EditorImage } from "./useEditorState";

const MULTIPLY: CSSProperties = { mixBlendMode: "multiply" };

/** Arrow head as drawn in the PDF: a triangle at (x2, y2), and where the shaft should stop. */
export function arrowHead(o: { x1: number; y1: number; x2: number; y2: number; strokeWidth: number }) {
  const length = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1;
  const head = Math.min(length, Math.max(8, o.strokeWidth * 4));
  const [ux, uy] = [(o.x2 - o.x1) / length, (o.y2 - o.y1) / length];
  const [bx, by] = [o.x2 - ux * head, o.y2 - uy * head];
  const [px, py] = [-uy * head * 0.45, ux * head * 0.45];
  return { points: `${o.x2},${o.y2} ${bx + px},${by + py} ${bx - px},${by - py}`, end: { x: bx + ux * 0.5, y: by + uy * 0.5 } };
}

const MARKS = {
  check: "M0.12 0.55 L0.4 0.84 L0.9 0.16",
  cross: "M0.16 0.16 L0.84 0.84 M0.84 0.16 L0.16 0.84",
};

/** One object, in page points (the SVG's viewBox). `hideText` hides text being edited in place. */
export function ObjectShape({ object, images, hideText }: { object: EditObject; images: Record<string, EditorImage>; hideText?: boolean }) {
  switch (object.kind) {
    case "whiteout":
      return <rect x={object.x} y={object.y} width={object.width} height={object.height} fill={object.color} />;
    case "rect":
    case "ellipse": {
      const paint = { fill: object.fill ?? "none", stroke: object.stroke ?? "none", strokeWidth: object.strokeWidth, opacity: object.opacity };
      return object.kind === "rect" ? (
        <rect x={object.x} y={object.y} width={object.width} height={object.height} {...paint} />
      ) : (
        <ellipse cx={object.x + object.width / 2} cy={object.y + object.height / 2} rx={object.width / 2} ry={object.height / 2} {...paint} />
      );
    }
    case "line":
    case "arrow": {
      const head = object.kind === "arrow" ? arrowHead(object) : null;
      const end = head?.end ?? { x: object.x2, y: object.y2 };
      return (
        <g opacity={object.opacity}>
          <line x1={object.x1} y1={object.y1} x2={end.x} y2={end.y} stroke={object.color} strokeWidth={object.strokeWidth} strokeLinecap="round" />
          {head && <polygon points={head.points} fill={object.color} />}
        </g>
      );
    }
    case "ink":
      return (
        <g opacity={object.opacity} style={object.highlighter ? MULTIPLY : undefined} fill="none" stroke={object.color} strokeWidth={object.strokeWidth} strokeLinecap={object.highlighter ? "square" : "round"} strokeLinejoin="round">
          {object.strokes.map((points, i) =>
            points.length === 2 ? (
              <circle key={i} cx={points[0]} cy={points[1]} r={object.strokeWidth / 2} fill={object.color} stroke="none" />
            ) : (
              <polyline key={i} points={points.join(" ")} />
            ),
          )}
        </g>
      );
    case "highlight":
    case "underline":
    case "strikeout":
      return (
        <g fill={object.color} opacity={object.opacity} style={object.kind === "highlight" ? MULTIPLY : undefined}>
          {object.rects.map((r, i) => {
            if (object.kind === "highlight") return <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} />;
            const width = Math.max(0.6, r.height * 0.07);
            const v = object.kind === "underline" ? r.y + r.height - width : r.y + r.height * 0.55;
            return <rect key={i} x={r.x} y={v - width / 2} width={r.width} height={width} />;
          })}
        </g>
      );
    case "check":
    case "cross":
    case "dot":
      return object.kind === "dot" ? (
        <circle cx={object.x + object.size / 2} cy={object.y + object.size / 2} r={object.size * 0.32} fill={object.color} />
      ) : (
        <path
          d={MARKS[object.kind]}
          transform={`translate(${object.x} ${object.y}) scale(${object.size})`}
          fill="none"
          stroke={object.color}
          strokeWidth={0.12}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "image": {
      const image = images[object.image];
      return image ? <image href={image.url} x={object.x} y={object.y} width={object.width} height={object.height} preserveAspectRatio="none" opacity={object.opacity} /> : null;
    }
    case "note": {
      const { x, y } = object;
      return (
        <g>
          <path d={`M${x + 1} ${y + 1} H${x + 19} V${y + 14} H${x + 9} L${x + 5} ${y + 19} V${y + 14} H${x + 1} Z`} fill={object.color} stroke="rgb(0 0 0 / 0.4)" strokeWidth={0.8} strokeLinejoin="round" />
          {[4.5, 7.5, 10.5].map((v) => (
            <line key={v} x1={x + 4} y1={y + v} x2={x + 16} y2={y + v} stroke="#262626" strokeWidth={1} />
          ))}
        </g>
      );
    }
    case "text":
    case "replace":
      return (
        <g>
          {object.kind === "replace" && <rect x={object.cover.x} y={object.cover.y} width={object.cover.width} height={object.cover.height} fill={object.background} />}
          {!hideText && (
            <text
              fill={object.color}
              fontFamily={CSS_FONTS[object.font]}
              fontSize={object.size}
              fontWeight={object.bold ? 700 : 400}
              fontStyle={object.italic ? "italic" : "normal"}
              style={{ whiteSpace: "pre" }}
            >
              {object.text.split("\n").map((line, i) => (
                <tspan key={i} x={object.x} y={object.y + baselineOffset(object.font, object.size) + i * LINE_HEIGHT * object.size}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </g>
      );
  }
}

/** An invisible, easier-to-hit outline for thin objects (lines, strokes). */
export function HitArea({ object, scale }: { object: EditObject; scale: number }): ReactNode {
  const pad = 10 / scale; // about 10 CSS pixels
  if (object.kind === "line" || object.kind === "arrow") {
    return <line x1={object.x1} y1={object.y1} x2={object.x2} y2={object.y2} stroke="transparent" strokeWidth={object.strokeWidth + pad} />;
  }
  if (object.kind === "ink") {
    return (
      <g fill="none" stroke="transparent" strokeWidth={object.strokeWidth + pad} strokeLinecap="round">
        {object.strokes.map((points, i) => (
          <polyline key={i} points={points.length === 2 ? `${points.join(" ")} ${points[0] + 0.01} ${points[1]}` : points.join(" ")} />
        ))}
      </g>
    );
  }
  return null;
}
