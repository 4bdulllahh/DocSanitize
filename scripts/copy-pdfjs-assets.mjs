// Copies pdf.js runtime assets (CMaps, standard fonts, WASM decoders, ICC profiles) into
// public/pdfjs so they are served from our own origin — pdf.js never needs a CDN.
// Runs before `dev` and `build`; the output folder is git-ignored.
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(process.cwd(), "public", "pdfjs");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(join(root, dir), join(target, dir), { recursive: true });
}
console.log("copy-pdfjs-assets: copied pdf.js assets to public/pdfjs");
