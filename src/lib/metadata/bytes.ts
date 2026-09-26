export const latin1 = new TextDecoder("latin1");
export const utf8 = new TextDecoder("utf-8");

export function ascii(bytes: Uint8Array, start: number, length: number): string {
  return latin1.decode(bytes.subarray(start, start + length));
}

export function startsWith(bytes: Uint8Array, prefix: string, offset = 0): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Index of the first 0x00 at or after `from`, or -1. */
export function nullIndex(bytes: Uint8Array, from = 0): number {
  return bytes.indexOf(0, from);
}

/** Inflate zlib data (PNG zTXt / compressed iTXt) with the platform's native decompressor. */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
