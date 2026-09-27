// Hardens the static export after `next build`:
//
// 1. Adds a Content-Security-Policy <meta> tag to every page, so the policy applies even on hosts
//    that can't send headers (GitHub Pages, S3, a USB stick). It is the header policy from
//    vercel.json, made stricter: instead of 'unsafe-inline', only the page's own inline scripts
//    (the theme script and Next.js's hydration data) are allowed, by their sha256 hashes.
// 2. Writes out/_headers (Netlify / Cloudflare Pages format) from the same vercel.json rules.
//
// vercel.json is the single source of truth for the security headers.
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = "out";
// Ignored (with a console warning) when delivered by <meta>, so header-only.
const HEADER_ONLY = new Set(["frame-ancestors", "report-uri", "report-to", "sandbox"]);

try {
  await stat(OUT_DIR);
} catch {
  process.exit(0);
}

const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
const csp = vercel.headers
  .find((rule) => rule.source === "/(.*)")
  ?.headers.find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
if (!csp) throw new Error("secure-export: vercel.json has no Content-Security-Policy header for /(.*)");

const directives = csp
  .split(";")
  .map((d) => d.trim().split(/\s+/))
  .filter((d) => d[0]);

function metaPolicy(scriptHashes) {
  return directives
    .filter(([name]) => !HEADER_ONLY.has(name))
    .map(([name, ...values]) => {
      if (name === "script-src") values = [...values.filter((v) => v !== "'unsafe-inline'"), ...scriptHashes];
      return [name, ...values].join(" ");
    })
    .join("; ");
}

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : [])),
  );
  return nested.flat();
}

let pages = 0;
for (const file of await htmlFiles(OUT_DIR)) {
  const html = await readFile(file, "utf8");
  if (html.includes('http-equiv="Content-Security-Policy"')) continue;
  const hashes = new Set();
  for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
    if (body) hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${metaPolicy([...hashes])}"/>`;
  // Right after the charset, and before any script: a <meta> policy only covers what follows it.
  const charset = /<meta charSet="utf-8"\/>/i.exec(html);
  const at = charset ? charset.index + charset[0].length : html.indexOf("<head>") + "<head>".length;
  if (at < "<head>".length) throw new Error(`secure-export: no <head> in ${file}`);
  if (html.slice(0, at).includes("<script")) throw new Error(`secure-export: a script comes before the CSP in ${file}`);
  await writeFile(file, html.slice(0, at) + meta + html.slice(at));
  pages++;
}

// Netlify / Cloudflare Pages: "/(.*)" in vercel.json is "/*" there.
const headersFile = vercel.headers
  .map((rule) => [rule.source.replace("(.*)", "*"), ...rule.headers.map((h) => `  ${h.key}: ${h.value}`)].join("\n"))
  .join("\n\n");
await writeFile(join(OUT_DIR, "_headers"), `${headersFile}\n`);

console.log(`secure-export: added a Content-Security-Policy to ${pages} page(s) and wrote out/_headers`);
