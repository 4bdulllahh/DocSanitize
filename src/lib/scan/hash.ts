/*
 * File hashes. SHA-1, SHA-256 and SHA-512 come from the browser (Web Crypto); MD5, which Web
 * Crypto doesn't offer but many download pages still list, is computed here.
 */

export type HashAlgorithm = "SHA-256" | "SHA-512" | "SHA-1" | "MD5";

export const HASH_ALGORITHMS: HashAlgorithm[] = ["SHA-256", "SHA-512", "SHA-1", "MD5"];

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): string {
  const length = data.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const m = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const sum = (a + f + K[i] + m[g]) >>> 0;
      [a, d, c] = [d, c, b];
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word, true));
  return hex(out);
}

export async function hashBytes(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<string> {
  if (algorithm === "MD5") return md5(bytes);
  return hex(new Uint8Array(await crypto.subtle.digest(algorithm, bytes as BufferSource)));
}

export async function hashAll(bytes: Uint8Array): Promise<Record<HashAlgorithm, string>> {
  const entries = await Promise.all(HASH_ALGORITHMS.map(async (a) => [a, await hashBytes(bytes, a)] as const));
  return Object.fromEntries(entries) as Record<HashAlgorithm, string>;
}

/** Which of the hashes a pasted value matches (spaces, colons and case ignored), if any. */
export function matchHash(hashes: Record<HashAlgorithm, string>, pasted: string): HashAlgorithm | null {
  const clean = pasted.trim().toLowerCase().replace(/[\s:-]/g, "");
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  return HASH_ALGORITHMS.find((a) => hashes[a] === clean) ?? null;
}
