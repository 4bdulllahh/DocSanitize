/*
 * Just enough ASN.1 DER for certificates and CMS signatures: a reader that keeps each element's
 * exact bytes (signatures are over the original encoding) and a few encoders.
 */

export interface Der {
  /** Tag byte as read (class, constructed bit and number). */
  tag: number;
  /** The whole element: header and content. */
  bytes: Uint8Array;
  /** The content only. */
  content: Uint8Array;
  /** Parsed children, for constructed elements. */
  children: Der[];
}

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8: 0x0c,
  PRINTABLE: 0x13,
  T61: 0x14,
  IA5: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  BMP: 0x1e,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

export class DerError extends Error {}

function readOne(bytes: Uint8Array, offset: number, end: number): Der {
  if (offset + 2 > end) throw new DerError("Truncated ASN.1 data");
  const tag = bytes[offset];
  if ((tag & 0x1f) === 0x1f) throw new DerError("Multi-byte ASN.1 tags aren't supported");
  let length = bytes[offset + 1];
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new DerError("Unsupported ASN.1 length");
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[offset + 2 + i];
    header += count;
  }
  const start = offset + header;
  if (start + length > end) throw new DerError("Truncated ASN.1 data");
  const content = bytes.subarray(start, start + length);
  const constructed = (tag & 0x20) !== 0;
  const children: Der[] = [];
  if (constructed) {
    let at = start;
    while (at < start + length) {
      const child = readOne(bytes, at, start + length);
      children.push(child);
      at += child.bytes.length;
    }
  }
  return { tag, bytes: bytes.subarray(offset, start + length), content, children };
}

/** Parse one DER element from the start of `bytes` (anything after it, such as padding, is ignored). */
export function parseDer(bytes: Uint8Array): Der {
  return readOne(bytes, 0, bytes.length);
}

/** Parse the content of a primitive element (e.g. an OCTET STRING holding DER) as DER. */
export function parseInner(node: Der): Der {
  return parseDer(node.content);
}

export function decodeOid(node: Der): string {
  const b = node.content;
  if (!b.length) return "";
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let value = 0;
  for (let i = 1; i < b.length; i++) {
    value = value * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  if (b[0] >= 80) {
    parts[0] = 2;
    parts[1] = b[0] - 80;
  }
  return parts.join(".");
}

const textDecoders = { utf8: new TextDecoder(), latin1: new TextDecoder("latin1"), utf16: new TextDecoder("utf-16be") };

/** The text of any ASN.1 string type. */
export function decodeString(node: Der): string {
  if (node.tag === TAG.BMP) return textDecoders.utf16.decode(node.content);
  if (node.tag === TAG.T61) return textDecoders.latin1.decode(node.content);
  return textDecoders.utf8.decode(node.content);
}

/** UTCTime or GeneralizedTime → Date. */
export function decodeTime(node: Der): Date {
  const text = textDecoders.latin1.decode(node.content);
  const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.(\d+))?(Z|[+-]\d{4})?$/.exec(text);
  if (!m) throw new DerError(`Unreadable time: ${text}`);
  let year = Number(m[1]);
  if (m[1].length === 2) year += year < 50 ? 2000 : 1900;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  let time = Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), ms);
  if (m[8] && m[8] !== "Z") {
    const sign = m[8][0] === "+" ? 1 : -1;
    time -= sign * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(3, 5))) * 60_000;
  }
  return new Date(time);
}

/** An INTEGER's value as unsigned bytes (leading zero dropped). */
export function integerBytes(node: Der): Uint8Array {
  const b = node.content;
  return b.length > 1 && b[0] === 0 ? b.subarray(1) : b;
}

export function decodeSmallInt(node: Der): number {
  let n = 0;
  for (const byte of node.content) n = n * 256 + byte;
  return n;
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------- Encoding

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function lengthBytes(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** An element with this tag around this content. */
export function tlv(tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat([Uint8Array.from([tag, ...lengthBytes(content.length)]), content]);
}

export const seq = (...items: Uint8Array[]) => tlv(TAG.SEQUENCE, concat(items));

/** A SET OF, sorted as DER requires. */
export function setOf(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const sorted = [...items].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  });
  return tlv(TAG.SET, concat(sorted));
}

/** [n] EXPLICIT around an element. */
export const explicit = (n: number, item: Uint8Array) => tlv(0xa0 | n, item);
/** [n] IMPLICIT for a constructed element: same content, context tag. */
export const implicitConstructed = (n: number, content: Uint8Array) => tlv(0xa0 | n, content);

export function oid(dotted: string): Uint8Array<ArrayBuffer> {
  const parts = dotted.split(".").map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let n = Math.floor(part / 128); n > 0; n = Math.floor(n / 128)) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(TAG.OID, Uint8Array.from(bytes));
}

/** An INTEGER from unsigned big-endian bytes (a zero byte is added when the top bit is set). */
export function integer(value: Uint8Array | number): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array;
  if (typeof value === "number") {
    const out: number[] = [];
    for (let n = value; n > 0; n = Math.floor(n / 256)) out.unshift(n & 0xff);
    bytes = Uint8Array.from(out.length ? out : [0]);
  } else {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start++;
    bytes = value.subarray(start);
  }
  return tlv(TAG.INTEGER, bytes[0] & 0x80 ? concat([Uint8Array.of(0), bytes]) : bytes);
}

export const octetString = (bytes: Uint8Array) => tlv(TAG.OCTET_STRING, bytes);
export const bitString = (bytes: Uint8Array) => tlv(TAG.BIT_STRING, concat([Uint8Array.of(0), bytes]));
export const nullValue = () => Uint8Array.of(TAG.NULL, 0);
export const boolean = (value: boolean) => Uint8Array.of(TAG.BOOLEAN, 1, value ? 0xff : 0);
export const utf8String = (text: string) => tlv(TAG.UTF8, new TextEncoder().encode(text));
export const printableString = (text: string) => tlv(TAG.PRINTABLE, new TextEncoder().encode(text));
export const ia5String = (text: string) => tlv(TAG.IA5, new TextEncoder().encode(text));

/** UTCTime up to 2049, GeneralizedTime after (as RFC 5280 requires). */
export function time(date: Date): Uint8Array<ArrayBuffer> {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const year = date.getUTCFullYear();
  return year < 2050 ? tlv(TAG.UTC_TIME, new TextEncoder().encode(`${iso.slice(2)}Z`)) : tlv(TAG.GENERALIZED_TIME, new TextEncoder().encode(`${iso}Z`));
}
