"use client";

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import clsx from "clsx";
import { Check, Eraser, ImagePlus, Undo2 } from "lucide-react";
import { create } from "zustand";
import { createId } from "@/lib/files";
import { toast } from "@/store/toast";
import { Field, INPUT, Segmented } from "../shared/controls";
import { PRIMARY, SECONDARY } from "../shared/OutputCard";

export interface SignatureAsset {
  id: string;
  /** Transparent PNG, trimmed to the ink. */
  png: Uint8Array;
  url: string;
  /** Pixel size, for the aspect ratio. */
  width: number;
  height: number;
}

/** Signatures made this session, shared by every file. Memory only: never stored on disk. */
export const useSignatures = create<{ assets: SignatureAsset[]; add: (a: SignatureAsset) => void; remove: (id: string) => void }>()((set) => ({
  assets: [],
  add: (asset) => set((s) => ({ assets: [...s.assets, asset] })),
  remove: (id) =>
    set((s) => {
      const gone = s.assets.find((a) => a.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return { assets: s.assets.filter((a) => a.id !== id) };
    }),
}));

/** Crop a canvas to its non-transparent pixels (plus a little padding) and encode it as PNG. */
async function trimmedPng(source: HTMLCanvasElement): Promise<SignatureAsset | null> {
  const ctx = source.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, source.width, source.height);
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  const [x0, y0] = [Math.max(0, minX - pad), Math.max(0, minY - pad)];
  const [w, h] = [Math.min(width, maxX + pad + 1) - x0, Math.min(height, maxY + pad + 1) - y0];
  const out = Object.assign(document.createElement("canvas"), { width: w, height: h });
  out.getContext("2d")!.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { id: createId(), png: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), width: w, height: h };
}

type Mode = "draw" | "type" | "upload";

export function SignatureCreator({ onDone }: { onDone: (asset: SignatureAsset | null) => void }) {
  const [mode, setMode] = useState<Mode>("draw");
  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <Segmented
        label="New signature"
        value={mode}
        onChange={setMode}
        options={[
          { id: "draw", label: "Draw" },
          { id: "type", label: "Type" },
          { id: "upload", label: "Upload" },
        ]}
      />
      {mode === "draw" && <DrawPad onDone={onDone} />}
      {mode === "type" && <TypePad onDone={onDone} />}
      {mode === "upload" && <UploadPad onDone={onDone} />}
    </div>
  );
}

function Actions({ onCancel, onSave, disabled }: { onCancel: () => void; onSave: () => void; disabled: boolean }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" onClick={onCancel} className={SECONDARY}>
        Cancel
      </button>
      <button type="button" onClick={onSave} disabled={disabled} className={clsx(PRIMARY, "py-2")}>
        <Check className="size-4" aria-hidden="true" />
        Save
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------- Draw

const INKS = [
  { id: "#111827", label: "Black" },
  { id: "#1d3a8a", label: "Blue" },
];
// The pad's own resolution; it's shown scaled to the panel width.
const PAD = { width: 900, height: 360 };

interface Point {
  x: number;
  y: number;
  t: number;
}

function DrawPad({ onDone }: { onDone: (asset: SignatureAsset | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<{ ink: string; points: Point[] }[]>([]);
  const [ink, setInk] = useState(INKS[0].id);
  const drawing = useRef(false);

  // Redraw everything whenever the strokes change: smooth curves through segment midpoints,
  // thinner where the pen moves fast, like ink.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      const pts = stroke.points;
      ctx.strokeStyle = stroke.ink;
      ctx.fillStyle = stroke.ink;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const speed = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
        ctx.lineWidth = Math.min(9, Math.max(3.5, 9 - speed * 1.6));
        const start = i === 1 ? a : { x: (pts[i - 2].x + a.x) / 2, y: (pts[i - 2].y + a.y) / 2 };
        const end = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo(a.x, a.y, i === pts.length - 1 ? b.x : end.x, i === pts.length - 1 ? b.y : end.y);
        ctx.stroke();
      }
    }
  }, [strokes]);

  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * PAD.width, y: ((event.clientY - rect.top) / rect.height) * PAD.height, t: event.timeStamp };
  };

  return (
    <div className="mt-3">
      {/* The pad is paper: white with dark ink in either theme, like the page itself. */}
      <div className="relative overflow-hidden rounded-lg border border-line-strong bg-white">
        <canvas
          ref={canvasRef}
          width={PAD.width}
          height={PAD.height}
          aria-label="Signature pad: draw your signature with a mouse, pen or finger"
          role="img"
          className="block aspect-[5/2] w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            setStrokes((s) => [...s, { ink, points: [point(e)] }]);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = point(e);
            setStrokes((s) => [...s.slice(0, -1), { ...s[s.length - 1], points: [...s[s.length - 1].points, p] }]);
          }}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        {/* A signing line; it's a guide only and isn't part of the signature. */}
        <div className="pointer-events-none absolute right-6 bottom-[22%] left-6 border-b border-dashed border-gray-300" aria-hidden="true" />
        {strokes.length === 0 && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-gray-400">Sign here</p>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {INKS.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setInk(i.id)}
            aria-label={`${i.label} ink`}
            aria-pressed={ink === i.id}
            className={clsx("size-6 rounded-full border border-line-strong", ink === i.id && "ring-2 ring-brand-border ring-offset-2 ring-offset-surface")}
            style={{ backgroundColor: i.id }}
          />
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={strokes.length === 0} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" aria-label="Undo the last stroke">
          <Undo2 className="size-4" />
        </button>
        <button type="button" onClick={() => setStrokes([])} disabled={strokes.length === 0} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-40" aria-label="Clear the pad">
          <Eraser className="size-4" />
        </button>
      </div>
      <Actions onCancel={() => onDone(null)} disabled={strokes.length === 0} onSave={async () => onDone(await trimmedPng(canvasRef.current!))} />
    </div>
  );
}

// ---------------------------------------------------------------------------- Type

// Handwriting-style fonts already on the device (Windows, macOS, then any cursive font).
const STYLES = [
  { id: "script", label: "Script", font: '"Segoe Script", "Snell Roundhand", "Brush Script MT", cursive' },
  { id: "hand", label: "Hand", font: '"Lucida Handwriting", "Apple Chancery", "Bradley Hand", cursive' },
  { id: "serif", label: "Serif", font: 'Georgia, "Times New Roman", serif' },
];

function TypePad({ onDone }: { onDone: (asset: SignatureAsset | null) => void }) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState(STYLES[0].id);
  const font = STYLES.find((s) => s.id === style)!.font;

  const save = async () => {
    const size = 120;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = `italic ${size}px ${font}`;
    canvas.width = Math.ceil(ctx.measureText(name).width + size);
    canvas.height = Math.ceil(size * 1.8);
    ctx.font = `italic ${size}px ${font}`;
    ctx.fillStyle = "#111827";
    ctx.textBaseline = "middle";
    ctx.fillText(name, size / 2, canvas.height / 2);
    onDone(await trimmedPng(canvas));
  };

  return (
    <div>
      <Field label="Your name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className={INPUT} maxLength={60} autoComplete="name" />
      </Field>
      <Segmented label="Style" value={style} onChange={setStyle} options={STYLES} />
      <div className="mt-3 flex h-20 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-white px-3 text-3xl text-gray-900 italic" style={{ fontFamily: font }}>
        {name || <span className="text-base text-gray-400 not-italic">Preview</span>}
      </div>
      <Actions onCancel={() => onDone(null)} disabled={!name.trim()} onSave={save} />
    </div>
  );
}

// ---------------------------------------------------------------------------- Upload

function UploadPad({ onDone }: { onDone: (asset: SignatureAsset | null) => void }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Draw the image, turning near-white paper transparent with a soft edge so ink keeps its outline.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !bitmap) return;
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (!removeBackground) return;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const lightness = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i + 3] = Math.round(d[i + 3] * Math.min(1, Math.max(0, (0.88 - lightness) / 0.18)));
    }
    ctx.putImageData(image, 0, 0);
  }, [bitmap, removeBackground]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setBitmap(await createImageBitmap(file, { imageOrientation: "from-image" }));
    } catch {
      toast({ tone: "error", title: "Couldn't read that image", description: "Use a PNG, JPEG or WebP picture of your signature." });
    }
  };

  return (
    <div className="mt-3">
      {bitmap ? (
        <div className="rounded-lg border border-line-strong bg-[repeating-conic-gradient(var(--surface-muted)_0_25%,var(--surface)_0_50%)] bg-[length:16px_16px] p-2">
          <canvas ref={previewRef} className="mx-auto block max-h-40 max-w-full" aria-label="Uploaded signature" role="img" />
        </div>
      ) : (
        <label className={clsx(SECONDARY, "w-full cursor-pointer py-6")}>
          <ImagePlus className="size-4" aria-hidden="true" />
          Choose a photo or scan
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} className="sr-only" />
        </label>
      )}
      <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-fg">
        <input type="checkbox" checked={removeBackground} onChange={(e) => setRemoveBackground(e.target.checked)} className="size-4 accent-brand" />
        Remove the white background
      </label>
      <Actions onCancel={() => onDone(null)} disabled={!bitmap} onSave={async () => onDone(await trimmedPng(previewRef.current!))} />
    </div>
  );
}
