// Serves the static build (./out) and runs every browser test in this folder against it.
// Usage: npm run build && npm run e2e            (all scripts)
//        npm run e2e -- organize                  (only scripts whose name contains "organize")
// Needs a Chromium for playwright-core: `npx playwright-core install chromium` once per machine.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const output = join(here, ".output");
const port = process.env.E2E_PORT ?? "3123";
const filter = process.argv[2] ?? "";
mkdirSync(output, { recursive: true });

const require = createRequire(import.meta.url);
const serveBin = join(dirname(require.resolve("serve/package.json")), "build", "main.js");
const server = spawn(process.execPath, [serveBin, join(root, "out"), "-l", port, "--no-clipboard"], { stdio: "ignore" });

const base = `http://localhost:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 50) throw new Error(`Static server didn't start on ${base} — did you run \`npm run build\`?`);
  await new Promise((r) => setTimeout(r, 200));
}

const scripts = readdirSync(here).filter((f) => f.endsWith(".mjs") && f !== "run.mjs" && f.includes(filter));
let failed = 0;
for (const script of scripts) {
  console.log(`\n▶ ${script}`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", join(here, script)], {
      cwd: output,
      stdio: "inherit",
      env: { ...process.env, E2E_BASE_URL: base },
    });
    child.on("exit", resolve);
  });
  if (code !== 0) failed++;
}
server.kill();
console.log(failed ? `\n✗ ${failed} of ${scripts.length} e2e script(s) failed` : `\n✓ all ${scripts.length} e2e script(s) passed`);
process.exit(failed ? 1 : 0);
