// DocSanitize media add-on: a classic worker around ffmpeg.wasm's single-threaded core (FFmpeg,
// GPL-2.0-or-later; the licence and where to get the source are copied next to this file). It's
// served from our own origin and only downloaded the first time a media tool runs; the service
// worker then keeps it for offline use. Files are read in place (WORKERFS), never uploaded.
//
// Messages in:
//   { id, type: "load" }
//   { id, type: "run", args: string[], inputs: File[], outputs: string[] }
//     inputs are mounted read-only at /in/<file name>; outputs are paths under /out/.
//   { id, type: "probe", input: File }
// Messages out:
//   { type: "download", loaded, total }             while the engine downloads
//   { id, type: "progress", time }                  while running (time: seconds of output done)
//   { id, type: "done", code, files, log }          files: { [path]: Uint8Array }
//   { id, type: "done", json }                      for "probe"
//   { id, type: "error", message, log }
importScripts("ffmpeg-core.js");

const WASM_SIZE = /* %WASM_SIZE% */ 0;
const LOG_LINES = 60;

let ready;
let core;
let log = [];

function load() {
  ready ??= (async () => {
    const response = await fetch(new URL("ffmpeg-core.wasm", self.location.href));
    if (!response.ok || !response.body) throw new Error(`The media engine couldn't be downloaded (${response.status}).`);
    // Read it ourselves to report progress (a compressed response's length isn't the file's).
    const total = WASM_SIZE || Number(response.headers.get("content-length")) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let reported = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (loaded - reported > 512 * 1024) {
        reported = loaded;
        self.postMessage({ type: "download", loaded, total });
      }
    }
    const wasm = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      wasm.set(chunk, offset);
      offset += chunk.length;
    }
    self.postMessage({ type: "download", loaded, total: loaded });
    core = await self.createFFmpegCore({ wasmBinary: wasm.buffer });
    core.setLogger(({ message }) => {
      log.push(message);
      if (log.length > LOG_LINES * 2) log = log.slice(-LOG_LINES);
    });
    core.FS.mkdir("/in");
    core.FS.mkdir("/out");
  })();
  ready.catch(() => (ready = undefined));
  return ready;
}

function mount(files) {
  core.FS.mount(core.FS.filesystems.WORKERFS, { files }, "/in");
}

// Never throws: after a crash the file system may be unusable, and the crash is what to report
// (the page then starts a fresh engine).
function clean() {
  try {
    core.FS.unmount("/in");
  } catch {
    // not mounted
  }
  try {
    for (const name of core.FS.readdir("/out")) {
      if (name !== "." && name !== "..") core.FS.unlink(`/out/${name}`);
    }
  } catch {
    // see above
  }
}

function exists(path) {
  try {
    core.FS.stat(path);
    return true;
  } catch {
    return false;
  }
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  log = [];
  try {
    await load();
    if (type === "load") {
      self.postMessage({ id, type: "done" });
      return;
    }
    if (type === "probe") {
      mount([data.input]);
      try {
        // (ffprobe's return code isn't reliable here: the page checks the result has tracks.)
        core.ffprobe("-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", `/in/${data.input.name}`, "-o", "/out/probe.json");
        core.reset();
        if (!exists("/out/probe.json")) throw new Error("This file couldn't be read as audio or video.");
        const json = core.FS.readFile("/out/probe.json", { encoding: "utf8" });
        self.postMessage({ id, type: "done", json, log: log.slice(-LOG_LINES) });
      } finally {
        clean();
      }
      return;
    }
    if (type === "run") {
      mount(data.inputs);
      try {
        core.setProgress(({ time }) => self.postMessage({ id, type: "progress", time: time / 1e6 }));
        core.setTimeout(-1);
        const code = core.exec(...data.args);
        core.reset();
        const files = {};
        const transfer = [];
        for (const path of data.outputs) {
          if (!exists(path)) continue;
          const bytes = core.FS.readFile(path);
          files[path] = bytes;
          transfer.push(bytes.buffer);
        }
        self.postMessage({ id, type: "done", code, files, log: log.slice(-LOG_LINES) }, transfer);
      } finally {
        core.setProgress(() => {});
        clean();
      }
      return;
    }
    throw new Error(`Unknown request: ${type}`);
  } catch (error) {
    self.postMessage({ id, type: "error", message: error instanceof Error ? error.message : String(error), log: log.slice(-LOG_LINES) });
  }
};
