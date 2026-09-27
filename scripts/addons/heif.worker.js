// DocSanitize HEIC decoder add-on: a classic worker around libheif (LGPL-3.0; its licence is
// copied next to this file). It's served from our own origin and only downloaded the first time
// a HEIC photo is opened; the service worker then keeps it for offline use.
//
// Message in:  { id, bytes: Uint8Array }
// Message out: { id, width, height, pixels: Uint8ClampedArray (RGBA) } or { id, error }
importScripts("libheif.js");

let ready;
function load() {
  ready ??= new Promise((resolve, reject) => {
    // The callback runs after the wasm has loaded, by which time `lib` is assigned.
    const lib = self.libheif({
      locateFile: (file) => new URL(file, self.location.href).href,
      onRuntimeInitialized: () => queueMicrotask(() => resolve(lib)),
      onAbort: (reason) => reject(new Error(`The HEIC decoder failed to start: ${reason}`)),
    });
  });
  return ready;
}

self.onmessage = async ({ data: { id, bytes } }) => {
  let images = [];
  try {
    const lib = await load();
    images = new lib.HeifDecoder().decode(bytes);
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) throw new Error("This file holds no HEIC image.");
    const width = image.get_width();
    const height = image.get_height();
    const pixels = new Uint8ClampedArray(width * height * 4);
    // display() decodes with the photo's rotation and mirroring applied.
    await new Promise((resolve, reject) => image.display({ data: pixels, width, height }, (r) => (r ? resolve() : reject(new Error("This HEIC photo couldn't be decoded.")))));
    self.postMessage({ id, width, height, pixels }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const image of images) image.free();
  }
};
