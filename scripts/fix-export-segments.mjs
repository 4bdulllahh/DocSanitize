// Works around a Next.js static-export bug on Windows: segment prefetch files
// are meant to be flat (`__next.tools.$d$tool.__PAGE__.txt`) but Windows path
// separators make Next write them as nested folders (`__next.tools/$d$tool/__PAGE__.txt`),
// so the client's prefetch requests 404. This flattens them. No-op on Linux/macOS.
import { readdir, rename, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const OUT_DIR = "out";

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return nested.flat();
}

async function walk(dir) {
  let fixed = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (entry.name.startsWith("__next.")) {
      for (const file of await listFiles(full)) {
        const flat = `${entry.name}.${relative(full, file).split(sep).join(".")}`;
        await rename(file, join(dir, flat));
        fixed++;
      }
      await rm(full, { recursive: true, force: true });
    } else {
      fixed += await walk(full);
    }
  }
  return fixed;
}

try {
  await stat(OUT_DIR);
} catch {
  process.exit(0);
}
const fixed = await walk(OUT_DIR);
if (fixed > 0) console.log(`fix-export-segments: flattened ${fixed} segment prefetch file(s)`);
