/// <reference lib="webworker" />
// pdf.js's worker wires itself to `self` when imported inside a worker, so bundling it through
// our own entry is all that's needed — same origin, no CDN.
import "pdfjs-dist/build/pdf.worker.min.mjs";
