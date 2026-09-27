// Copies the optional add-ons into public/addons/<name>-<version>/. They're served from our own
// origin but left out of the service worker's precache: the app downloads each one the first time
// a tool needs it, and the service worker keeps it for offline use from then on (see
// build-service-worker.mjs). The version in the folder name makes an upgrade a new URL.
// Runs before `dev` and `build`; the output folder is git-ignored.
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const target = join(process.cwd(), "public", "addons");
await rm(target, { recursive: true, force: true });

// HEIC decoding (libheif + libde265, LGPL-3.0).
const heif = dirname(require.resolve("libheif-js/package.json"));
const { version } = JSON.parse(await readFile(join(heif, "package.json"), "utf8"));
const heifDir = join(target, `libheif-${version}`);
await mkdir(heifDir, { recursive: true });
for (const file of ["libheif.js", "libheif.wasm", "LICENSE"]) await copyFile(join(heif, "libheif-wasm", file), join(heifDir, file));
await copyFile(join("scripts", "addons", "heif.worker.js"), join(heifDir, "heif.worker.js"));

console.log(`copy-addons: copied libheif ${version} to public/addons`);
