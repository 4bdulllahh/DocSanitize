/*
 * A small reader for page content streams, used to remove the original text when a line is
 * edited. Covering old text with white would leave it in the file (selectable, searchable and
 * copyable), which breaks the "removed means gone" rule. Instead the operators that draw that
 * text are found by following the text state (fonts, matrices, spacing) and replaced with an
 * empty TJ that moves the text position by the same amount, so nothing after them shifts.
 *
 * Only the page's own content is edited; text drawn inside form XObjects isn't reached, and the
 * caller is told which regions had nothing removed.
 */

// ---------------------------------------------------------------------------- Tokens

export type Operand = number | { name: string } | { bytes: Uint8Array } | Operand[] | { dict: true };

export interface Operation {
  op: string;
  operands: Operand[];
  /** Byte range of the operands and the operator. */
  start: number;
  end: number;
}

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %
const isRegular = (c: number) => !WHITESPACE.has(c) && !DELIMITERS.has(c);
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** Split a content stream into operations, each with its operands and byte range. */
export function parseContent(bytes: Uint8Array): Operation[] {
  const ops: Operation[] = [];
  // Operand stack: values with the offset where each started.
  let stack: { value: Operand; start: number }[] = [];
  const nested: { items: Operand[]; start: number; kind: "array" | "dict" }[] = [];
  let pos = 0;

  const push = (value: Operand, start: number) => {
    if (nested.length) nested[nested.length - 1].items.push(value);
    else stack.push({ value, start });
  };

  while (pos < bytes.length) {
    const c = bytes[pos];
    if (WHITESPACE.has(c)) {
      pos++;
    } else if (c === 37) {
      // % comment to end of line
      while (pos < bytes.length && bytes[pos] !== 10 && bytes[pos] !== 13) pos++;
    } else if (c === 40) {
      const start = pos;
      const [value, next] = readLiteral(bytes, pos);
      push({ bytes: value }, start);
      pos = next;
    } else if (c === 60 && bytes[pos + 1] === 60) {
      nested.push({ items: [], start: pos, kind: "dict" });
      pos += 2;
    } else if (c === 62 && bytes[pos + 1] === 62) {
      const done = nested.pop();
      pos += 2;
      if (done) push({ dict: true }, done.start);
    } else if (c === 60) {
      const start = pos;
      const close = bytes.indexOf(62, pos);
      const end = close === -1 ? bytes.length : close;
      push({ bytes: hexBytes(ascii(bytes, pos + 1, end)) }, start);
      pos = end + 1;
    } else if (c === 91) {
      nested.push({ items: [], start: pos, kind: "array" });
      pos++;
    } else if (c === 93) {
      const done = nested.pop();
      pos++;
      if (done) push(done.items, done.start);
    } else if (c === 47) {
      const start = pos;
      pos++;
      while (pos < bytes.length && isRegular(bytes[pos])) pos++;
      push({ name: ascii(bytes, start + 1, pos) }, start);
    } else if (c === 123 || c === 125 || c === 41 || c === 62) {
      pos++; // stray delimiter (PostScript braces don't occur in content streams)
    } else {
      const start = pos;
      while (pos < bytes.length && isRegular(bytes[pos])) pos++;
      const word = ascii(bytes, start, pos);
      const number = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? Number(word) : NaN;
      if (!Number.isNaN(number)) {
        push(number, start);
      } else if (word === "true" || word === "false" || word === "null") {
        push(0, start);
      } else if (nested.length) {
        // An operator inside an array or dict means the stream is malformed; stop nesting.
        nested.length = 0;
        stack = [];
      } else {
        const opStart = stack.length ? stack[0].start : start;
        if (word === "BI") pos = skipInlineImage(bytes, pos);
        ops.push({ op: word, operands: stack.map((s) => s.value), start: opStart, end: pos });
        stack = [];
      }
    }
  }
  return ops;
}

/** Read a literal string starting at "(", handling nesting and escapes. Returns bytes and the next offset. */
function readLiteral(bytes: Uint8Array, pos: number): [Uint8Array, number] {
  const out: number[] = [];
  let depth = 0;
  let i = pos;
  while (i < bytes.length) {
    const c = bytes[i];
    if (c === 40) {
      if (depth > 0) out.push(c);
      depth++;
      i++;
    } else if (c === 41) {
      depth--;
      i++;
      if (depth === 0) break;
      out.push(c);
    } else if (c === 92) {
      const n = bytes[i + 1];
      i += 2;
      const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
      if (escapes[n] !== undefined) out.push(escapes[n]);
      else if (n === 13) {
        if (bytes[i] === 10) i++; // line continuation
      } else if (n === 10) {
        // line continuation
      } else if (n >= 48 && n <= 55) {
        let value = n - 48;
        for (let k = 0; k < 2 && bytes[i] >= 48 && bytes[i] <= 55; k++) value = value * 8 + (bytes[i++] - 48);
        out.push(value & 255);
      } else if (n !== undefined) {
        out.push(n);
      }
    } else {
      out.push(c);
      i++;
    }
  }
  return [Uint8Array.from(out), i];
}

function hexBytes(hex: string): Uint8Array {
  const digits = hex.replace(/[^0-9a-fA-F]/g, "");
  const padded = digits.length % 2 ? `${digits}0` : digits;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Inline image: skip from after "BI" past its binary data to just after "EI". */
function skipInlineImage(bytes: Uint8Array, pos: number): number {
  // Find " ID" + one whitespace byte, then the first "EI" surrounded by whitespace.
  let i = pos;
  while (i < bytes.length - 2 && !(bytes[i] === 73 && bytes[i + 1] === 68 && WHITESPACE.has(bytes[i + 2]) && WHITESPACE.has(bytes[i - 1]))) i++;
  i += 3;
  while (i < bytes.length - 1) {
    if (bytes[i] === 69 && bytes[i + 1] === 73 && WHITESPACE.has(bytes[i - 1]) && (i + 2 >= bytes.length || WHITESPACE.has(bytes[i + 2]))) return i + 2;
    i++;
  }
  return bytes.length;
}

// ---------------------------------------------------------------------------- Text state

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m × n, PDF row-vector convention (apply m first). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const apply = (m: Matrix, x: number, y: number) => ({ x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] });

/** Glyph widths for one font, in thousandths of the font size. */
export interface FontMetrics {
  /** Split a string's bytes into character codes with their widths; null if the encoding isn't understood. */
  glyphs(bytes: Uint8Array): { width: number; space: boolean }[] | null;
}

/**
 * A box in user space along a line of text: `origin` on the baseline at the start, `along` and
 * `up` unit vectors, `width` and `height` in user units (pdf.js text item geometry).
 */
export interface TextRegion {
  transform: number[];
  width: number;
  height: number;
}

interface TextState {
  ctm: Matrix;
  font: string | null;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  scale: number;
  leading: number;
  rise: number;
}

export interface RemovalResult {
  bytes: Uint8Array;
  /** Per region: how many text operators were removed. */
  removed: number[];
  /** Text drawn in a font whose widths couldn't be read; left in place. */
  unknownFonts: number;
}

/** Whether a user-space point lies inside a text region (with a tolerance around it). */
function inRegion(region: TextRegion, p: { x: number; y: number }): boolean {
  const [a, b, c, d, e, f] = region.transform;
  const alongLength = Math.hypot(a, b) || 1;
  const upLength = Math.hypot(c, d) || 1;
  const rx = p.x - e;
  const ry = p.y - f;
  const along = (rx * a + ry * b) / alongLength;
  const up = (rx * c + ry * d) / upLength;
  const h = Math.max(region.height, 1);
  return along >= -0.3 * h && along <= region.width + 0.3 * h && up >= -0.45 * h && up <= 0.9 * h;
}

const formatNumber = (n: number) => (Math.abs(n) < 1e-4 ? "0" : String(Math.round(n * 1000) / 1000));

/**
 * Remove text operators whose run of text lies in any of the regions. Each removed operator is
 * replaced by an empty `[n] TJ` with the same advance, so the position of later text is unchanged.
 */
export function removeTextInRegions(bytes: Uint8Array, regions: TextRegion[], fontFor: (name: string) => FontMetrics | null): RemovalResult {
  const ops = parseContent(bytes);
  const removed = regions.map(() => 0);
  let unknownFonts = 0;
  const edits: { start: number; end: number; text: string }[] = [];

  let state: TextState = { ctm: [...IDENTITY], font: null, size: 0, charSpacing: 0, wordSpacing: 0, scale: 1, leading: 0, rise: 0 };
  const saved: TextState[] = [];
  let tm: Matrix = [...IDENTITY];
  let tlm: Matrix = [...IDENTITY];
  const num = (v: Operand | undefined) => (typeof v === "number" ? v : 0);

  const nextLine = () => {
    tlm = multiply([1, 0, 0, 1, 0, -state.leading], tlm);
    tm = [...tlm];
  };

  /** Advance of a string or TJ array in text space (before horizontal scaling). */
  const advance = (items: Operand[]): number | null => {
    const metrics = state.font ? fontFor(state.font) : null;
    if (!metrics) return null;
    let tx = 0;
    for (const item of items) {
      if (typeof item === "number") {
        tx -= (item / 1000) * state.size;
      } else if (item && typeof item === "object" && "bytes" in item) {
        const glyphs = metrics.glyphs(item.bytes);
        if (!glyphs) return null;
        for (const g of glyphs) tx += (g.width / 1000) * state.size + state.charSpacing + (g.space ? state.wordSpacing : 0);
      }
    }
    return tx;
  };

  /** Handle a show operation: decide whether it's in a region, and move the text position. */
  const show = (operation: Operation, items: Operand[], prefix: string) => {
    const tx = advance(items);
    if (tx === null) {
      if (items.some((i) => typeof i === "object" && i !== null && "bytes" in i && i.bytes.length)) unknownFonts++;
      return;
    }
    const scaled = tx * state.scale;
    const toUser = multiply(tm, state.ctm);
    const mid = apply(toUser, scaled / 2, state.rise);
    const hit = regions.findIndex((r) => inRegion(r, mid));
    if (hit !== -1 && state.size !== 0) {
      removed[hit]++;
      edits.push({ start: operation.start, end: operation.end, text: `${prefix}[${formatNumber((-tx * 1000) / state.size)}] TJ` });
    }
    tm = multiply([1, 0, 0, 1, scaled, 0], tm);
  };

  for (const operation of ops) {
    const o = operation.operands;
    switch (operation.op) {
      case "q":
        saved.push({ ...state, ctm: [...state.ctm] });
        break;
      case "Q":
        state = saved.pop() ?? state;
        break;
      case "cm":
        state.ctm = multiply(o.map(num) as Matrix, state.ctm);
        break;
      case "BT":
        tm = [...IDENTITY];
        tlm = [...IDENTITY];
        break;
      case "Tf":
        state.font = o[0] && typeof o[0] === "object" && "name" in o[0] ? o[0].name : null;
        state.size = num(o[1]);
        break;
      case "Tc":
        state.charSpacing = num(o[0]);
        break;
      case "Tw":
        state.wordSpacing = num(o[0]);
        break;
      case "Tz":
        state.scale = num(o[0]) / 100;
        break;
      case "TL":
        state.leading = num(o[0]);
        break;
      case "Ts":
        state.rise = num(o[0]);
        break;
      case "Td":
        tlm = multiply([1, 0, 0, 1, num(o[0]), num(o[1])], tlm);
        tm = [...tlm];
        break;
      case "TD":
        state.leading = -num(o[1]);
        tlm = multiply([1, 0, 0, 1, num(o[0]), num(o[1])], tlm);
        tm = [...tlm];
        break;
      case "Tm":
        tlm = o.map(num) as Matrix;
        tm = [...tlm];
        break;
      case "T*":
        nextLine();
        break;
      case "Tj":
        show(operation, [o[0]], "");
        break;
      case "TJ":
        show(operation, Array.isArray(o[0]) ? o[0] : [], "");
        break;
      case "'":
        nextLine();
        show(operation, [o[0]], "T* ");
        break;
      case '"':
        state.wordSpacing = num(o[0]);
        state.charSpacing = num(o[1]);
        nextLine();
        show(operation, [o[2]], `${formatNumber(num(o[0]))} Tw ${formatNumber(num(o[1]))} Tc T* `);
        break;
    }
  }

  if (edits.length === 0) return { bytes, removed, unknownFonts };
  const parts: Uint8Array[] = [];
  let at = 0;
  const encoder = new TextEncoder();
  for (const edit of edits) {
    parts.push(bytes.subarray(at, edit.start), encoder.encode(edit.text));
    at = edit.end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return { bytes: out, removed, unknownFonts };
}
