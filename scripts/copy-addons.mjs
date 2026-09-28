// Copies the optional add-ons into public/addons/<name>-<version>/. They're served from our own
// origin but left out of the service worker's precache: the app downloads each one the first time
// a tool needs it, and the service worker keeps it for offline use from then on (see
// build-service-worker.mjs). The version in the folder name makes an upgrade a new URL.
// Runs before `dev` and `build`; the output folder is git-ignored.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const target = join(process.cwd(), "public", "addons");
await rm(target, { recursive: true, force: true });

const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));
const versionOf = async (dir) => JSON.parse(await readFile(join(dir, "package.json"), "utf8")).version;

// HEIC decoding (libheif + libde265, LGPL-3.0).
const heif = packageDir("libheif-js");
const heifVersion = await versionOf(heif);
const heifDir = join(target, `libheif-${heifVersion}`);
await mkdir(heifDir, { recursive: true });
for (const file of ["libheif.js", "libheif.wasm", "LICENSE"]) await copyFile(join(heif, "libheif-wasm", file), join(heifDir, file));
await copyFile(join("scripts", "addons", "heif.worker.js"), join(heifDir, "heif.worker.js"));

// OCR (Tesseract, Apache-2.0): tesseract.js's worker script, the LSTM-only builds of the core
// (the worker picks one by the browser's SIMD support), and one model per language.
const tesseract = packageDir("tesseract.js");
const tesseractVersion = await versionOf(tesseract);
const tesseractDir = join(target, `tesseract-${tesseractVersion}`);
await mkdir(tesseractDir, { recursive: true });
await copyFile(join(tesseract, "dist", "worker.min.js"), join(tesseractDir, "worker.min.js"));
await copyFile(join(tesseract, "LICENSE.md"), join(tesseractDir, "LICENSE.md"));

const core = packageDir("tesseract.js-core");
const coreVersion = await versionOf(core);
const coreDir = join(target, `tesseract-core-${coreVersion}`);
await mkdir(coreDir, { recursive: true });
for (const file of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js", "LICENSE"]) {
  await copyFile(join(core, file), join(coreDir, file));
}

const ocr = JSON.parse(await readFile(join("src", "lib", "ocr", "languages.json"), "utf8"));
const dataDir = join(process.cwd(), "public", ...ocr.dir.split("/").filter(Boolean));
await mkdir(dataDir, { recursive: true });
for (const { code } of ocr.languages) {
  await copyFile(join(packageDir(`@tesseract.js-data/${code}`), "4.0.0_best_int", `${code}.traineddata.gz`), join(dataDir, `${code}.traineddata.gz`));
}
await writeFile(
  join(dataDir, "NOTICE.txt"),
  "Tesseract LSTM models (tessdata_best, integer versions) from https://github.com/tesseract-ocr/tessdata_best,\n" +
    "packaged as @tesseract.js-data/<language>. Licensed under the Apache License 2.0.\n",
);

console.log(`copy-addons: copied libheif ${heifVersion}, tesseract.js ${tesseractVersion} (core ${coreVersion}) and ${ocr.languages.length} OCR languages to public/addons`);
