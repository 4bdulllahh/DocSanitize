// Writes out/sw.js from scripts/service-worker.template.js with the list of every file in the
// build (pages under their folder URL) and a version derived from their contents, so each
// deployment that changes anything gets a new service worker. Runs after secure-export.mjs,
// which edits the pages.
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const OUT_DIR = "out";
// Not part of the app: the worker itself, host config, source maps, and duplicate 404 pages
// (404.html is the one served).
const SKIP = [/^sw\.js$/, /^_headers$/, /\.map$/, /^404\/index\.html$/, /^_not-found\/index\.html$/];

try {
  await stat(OUT_DIR);
} catch {
  process.exit(0);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

const files = (await listFiles(OUT_DIR))
  .map((file) => relative(OUT_DIR, file).split(sep).join("/"))
  .filter((path) => !SKIP.some((pattern) => pattern.test(path)))
  .sort();

const hash = createHash("sha256");
let bytes = 0;
for (const path of files) {
  const data = await readFile(join(OUT_DIR, path));
  if (!path.startsWith("addons/")) bytes += data.length; // precached size only
  hash.update(path).update("\0").update(data).update("\0");
}
const version = hash.digest("hex").slice(0, 16);

// Add-ons are fetched on first use instead (see copy-addons.mjs and the template).
const isAddon = (path) => path.startsWith("addons/");
const addons = files.filter(isAddon).map((path) => `/${path}`);

const urls = files.filter((path) => !isAddon(path)).map((path) => {
  if (path === "index.html") return "/";
  if (path.endsWith("/index.html")) return `/${path.slice(0, -"index.html".length)}`;
  return `/${path}`;
});

const template = await readFile(join("scripts", "service-worker.template.js"), "utf8");
if (!template.includes('"%VERSION%"') || !template.includes("/* %PRECACHE% */ []") || !template.includes("/* %ADDONS% */ []")) {
  throw new Error("build-service-worker: placeholders missing from the template");
}
const worker = template
  .replace('"%VERSION%"', JSON.stringify(version))
  .replace("/* %PRECACHE% */ []", JSON.stringify(urls, null, 2))
  .replace("/* %ADDONS% */ []", JSON.stringify(addons, null, 2));
await writeFile(join(OUT_DIR, "sw.js"), worker);

console.log(`build-service-worker: out/sw.js precaches ${urls.length} files (${(bytes / 1048576).toFixed(1)} MB with ${addons.length} add-on files cached on first use), version ${version}`);
