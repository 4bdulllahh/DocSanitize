import libheifPackage from "libheif-js/package.json";
import { ProcessingError } from "../errors";
import { isAvif, isHeif } from "../metadata/heif";

/*
 * HEIC decoding through the libheif add-on (scripts/addons/heif.worker.js), which is downloaded
 * from our own site the first time it's needed and cached for offline use after that. Works from
 * the page and from inside other workers. AVIF isn't routed here: browsers decode it natively.
 */

export const HEIC_DECODER_URL = `/addons/libheif-${libheifPackage.version}/heif.worker.js`;

/** Whether these bytes are a HEIC/HEIF image the browser needs the add-on for (not AVIF). */
export const needsHeicDecoder = (bytes: Uint8Array) => isHeif(bytes) && !isAvif(bytes);

export interface DecodedPixels {
  width: number;
  height: number;
  /** RGBA, not premultiplied. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

type Pending = { resolve: (d: DecodedPixels) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function decoder(): Worker {
  if (worker) return worker;
  const w = new Worker(HEIC_DECODER_URL);
  w.onmessage = ({ data }: MessageEvent<{ id: number; error?: string } & Partial<DecodedPixels>>) => {
    const job = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) job?.reject(new ProcessingError(data.error, "corrupt"));
    else job?.resolve({ width: data.width!, height: data.height!, pixels: data.pixels! });
  };
  // The script couldn't load (usually: offline before the add-on was ever downloaded).
  w.onerror = (event) => {
    event.preventDefault();
    worker = null;
    w.terminate();
    const error = new ProcessingError(
      "The HEIC decoder couldn't be loaded. It's downloaded from this site the first time you open a HEIC photo (about 1.5 MB), then works offline — check your connection and try again.",
      "unsupported",
    );
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  worker = w;
  return w;
}

/** Decode a HEIC photo (rotation applied) to RGBA pixels. The bytes are copied, not transferred. */
export function decodeHeic(bytes: Uint8Array): Promise<DecodedPixels> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    decoder().postMessage({ id, bytes });
  });
}
