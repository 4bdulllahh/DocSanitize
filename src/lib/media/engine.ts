import engine from "./engine.json";
import { ProcessingError } from "../errors";
import { extensionOf, type MediaJob } from "./jobs";
import { parseProbe, type MediaInfo, type ProbeJson } from "./probe";

/*
 * The media engine (FFmpeg compiled to WebAssembly) is an add-on: a worker, a small script and a
 * 31 MB module served from our own site under /addons/ (see scripts/copy-addons.mjs), downloaded
 * the first time a media tool runs and kept by the service worker for offline use. Files are read
 * by the worker straight from the File objects; nothing is uploaded.
 */

export const MEDIA_ENGINE_DIR = `/addons/ffmpeg-${engine.version}/`;
export const MEDIA_ENGINE_URL = `${MEDIA_ENGINE_DIR}ffmpeg.worker.js`;
export const MEDIA_ENGINE_MB = 31;

export type MediaProgress =
  | { stage: "download"; fraction: number }
  | { stage: "starting" }
  /** `fraction` is null when the length isn't known; `seconds` is how much of the output is done. */
  | { stage: "working"; fraction: number | null; seconds: number };

export interface MediaRunOptions {
  onProgress?: (progress: MediaProgress) => void;
  signal?: AbortSignal;
}

type Reply = { id: number; type: "done" | "error"; message?: string; log?: string[]; code?: number; files?: Record<string, Uint8Array>; json?: string };

interface Pending {
  id: number;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  onMessage: (data: { type: string; loaded?: number; total?: number; time?: number }) => void;
}

let worker: Worker | null = null;
let current: Pending | null = null;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
let started = false;

function unavailable(): ProcessingError {
  return new ProcessingError(
    `The media engine couldn't be loaded. It's downloaded from this site the first time you use an audio or video tool (about ${MEDIA_ENGINE_MB} MB), then works offline — check your connection and try again.`,
    "unsupported",
  );
}

function stop() {
  worker?.terminate();
  worker = null;
  started = false;
}

function start(): Worker {
  if (worker) return worker;
  const w = new Worker(MEDIA_ENGINE_URL);
  w.onmessage = ({ data }: MessageEvent<Reply & { loaded?: number; total?: number; time?: number }>) => {
    const job = current;
    if (!job) return;
    if (data.type === "done" || data.type === "error") {
      if (data.id === job.id) job.resolve(data);
    } else if (data.id === undefined || data.id === job.id) {
      job.onMessage(data);
    }
  };
  // The script couldn't load (usually: offline before the add-on was ever downloaded).
  w.onerror = (event) => {
    event.preventDefault();
    stop();
    current?.reject(unavailable());
  };
  worker = w;
  return w;
}

/** Whether the engine files are already on this device (so using it needs no download). */
export async function mediaEngineCached(): Promise<boolean> {
  if (started) return true;
  try {
    return !!(await caches.match(`${MEDIA_ENGINE_DIR}ffmpeg-core.wasm`));
  } catch {
    return false;
  }
}

/** One request at a time: the engine runs a single job, and a cancel restarts it. */
function send(message: Record<string, unknown>, options: MediaRunOptions, onTime?: (seconds: number) => void): Promise<Reply> {
  const run = () =>
    new Promise<Reply>((resolve, reject) => {
      const { signal, onProgress } = options;
      if (signal?.aborted) return reject(new DOMException("Cancelled.", "AbortError"));
      const id = nextId++;
      const onAbort = () => {
        stop();
        reject(new DOMException("Cancelled.", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => {
        signal?.removeEventListener("abort", onAbort);
        current = null;
      };
      current = {
        id,
        resolve: (reply) => {
          done();
          resolve(reply);
        },
        reject: (error) => {
          done();
          reject(error);
        },
        onMessage: (data) => {
          if (data.type === "download") {
            const fraction = data.total ? Math.min(1, (data.loaded ?? 0) / data.total) : 0;
            onProgress?.(fraction >= 1 ? { stage: "starting" } : { stage: "download", fraction });
          } else if (data.type === "progress" && typeof data.time === "number") {
            onTime?.(data.time);
          }
        },
      };
      start().postMessage({ id, ...message });
    });
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

const LOG_NOISE = /^(Aborted\(\)|Conversion failed!|Exiting normally.*|\s*Last message repeated.*)$/;

/** Turns FFmpeg's log into a message a person can act on. */
export function engineError(message: string, log: string[] = []): ProcessingError {
  const text = [message, ...log].join("\n");
  if (/memory access out of bounds|Cannot enlarge memory|out of memory|Aborted\(OOM\)|RangeError/i.test(text)) {
    return new ProcessingError("This file is too large or complex to process in the browser. Try a shorter part (trim it first) or a lower resolution.", "unsupported");
  }
  if (/Invalid data found when processing input|could not find codec parameters|moov atom not found|EBML header parsing failed|couldn't be read as audio or video/i.test(text)) {
    return new ProcessingError("This file couldn't be read as audio or video. It may be damaged, or in a format the engine can't open.", "corrupt");
  }
  if (/does not contain any stream|Output file is empty/i.test(text)) {
    return new ProcessingError("There's nothing to write: the file (or the chosen part of it) has no sound or picture.", "invalid");
  }
  if (/Could not find tag for codec|not currently supported in container|codec not currently supported/i.test(text)) {
    return new ProcessingError("This file's sound or picture can't be stored in that format without converting it. Try another format.", "unsupported");
  }
  const detail = log.map((line) => line.trim()).filter((line) => line && !LOG_NOISE.test(line)).pop() ?? message;
  return new ProcessingError(`The media engine stopped with an error${detail ? `: ${detail}` : "."}`, "corrupt");
}

/** The file under a plain name the engine can open (/in/input.<ext>). */
function engineInput(file: File): { file: File; path: string } {
  const ext = extensionOf(file.name).replace(/[^a-z0-9]/g, "");
  const name = `input${ext ? `.${ext}` : ""}`;
  return { file: new File([file], name, { type: file.type }), path: `/in/${name}` };
}

/** The input path a job for this file should read from. */
export function mediaInputPath(file: File): string {
  return engineInput(file).path;
}

async function reply(message: Record<string, unknown>, options: MediaRunOptions, onTime?: (seconds: number) => void): Promise<Reply> {
  const result = await send(message, options, onTime);
  started = true;
  if (result.type === "error") {
    // A crash leaves the engine unusable: start a fresh one next time.
    stop();
    throw engineError(result.message ?? "", result.log);
  }
  return result;
}

/** Tracks, length and the descriptive details of an audio or video file. */
export async function probeMedia(file: File, options: MediaRunOptions = {}): Promise<MediaInfo> {
  options.onProgress?.({ stage: "starting" });
  const result = await reply({ type: "probe", input: engineInput(file).file }, options);
  let json: ProbeJson;
  try {
    json = JSON.parse(result.json ?? "{}") as ProbeJson;
  } catch {
    json = {};
  }
  if (!json.streams?.length) throw engineError("couldn't be read as audio or video");
  return parseProbe(json);
}

/** Run a job on the file and return the result. */
export async function runMedia(file: File, job: MediaJob, options: MediaRunOptions = {}): Promise<Blob> {
  const { onProgress } = options;
  onProgress?.({ stage: "starting" });
  const result = await reply({ type: "run", args: job.args, inputs: [engineInput(file).file], outputs: [job.output] }, options, (seconds) =>
    onProgress?.({ stage: "working", seconds, fraction: job.duration ? Math.min(1, seconds / job.duration) : null }),
  );
  const bytes = result.files?.[job.output];
  if (result.code !== 0 || !bytes?.length) {
    stop();
    throw engineError("", result.log);
  }
  return new Blob([bytes as BlobPart], { type: job.container.mime });
}
