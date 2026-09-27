// Regenerates the app icons from one drawing: the header's shield mark, in navy.
// Run by hand after changing the design (needs the Chromium used by the e2e tests):
//   node scripts/make-icons.mjs
// Writes src/app/icon.svg, src/app/apple-icon.png, src/app/favicon.ico and public/icons/*.png.
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const NAVY = "#263a81";
const PAPER = "#fffcf2";
// lucide "shield", on its 24 × 24 grid.
const SHIELD =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

/**
 * @param {object} o
 * @param {boolean} o.fullBleed  square corners (maskable and Apple icons are cropped by the OS)
 * @param {number} o.shield  shield grid size as a fraction of the icon
 * @param {number} o.stroke  stroke width on the 24-unit grid
 */
function svg({ fullBleed, shield, stroke }) {
  const scale = (512 * shield) / 24;
  const offset = 256 - 12 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${fullBleed ? 0 : 112}" fill="${NAVY}"/>
  <path d="${SHIELD}" transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${PAPER}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

const REGULAR = svg({ fullBleed: false, shield: 0.5625, stroke: 2.25 });
// Tiny sizes need a bigger, bolder mark to stay legible.
const SMALL = svg({ fullBleed: false, shield: 0.72, stroke: 2.75 });
// Maskable icons may be cut to a circle 80% wide, so the mark stays well inside it.
const MASKABLE = svg({ fullBleed: true, shield: 0.46, stroke: 2.25 });
const APPLE = svg({ fullBleed: true, shield: 0.56, stroke: 2.25 });

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}">`,
  );
  await page.waitForFunction(() => document.querySelector("img").complete);
  return page.screenshot({ omitBackground: true, type: "png" });
}

/** An .ico holding PNG images (supported by every browser that matters). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

await mkdir("public/icons", { recursive: true });
await writeFile("src/app/icon.svg", REGULAR);
await writeFile("src/app/apple-icon.png", await png(APPLE, 180));
await writeFile("public/icons/icon-192.png", await png(REGULAR, 192));
await writeFile("public/icons/icon-512.png", await png(REGULAR, 512));
await writeFile("public/icons/maskable-512.png", await png(MASKABLE, 512));
const favicons = [];
for (const size of [16, 32, 48]) favicons.push({ size, data: await png(SMALL, size) });
await writeFile("src/app/favicon.ico", ico(favicons));
await browser.close();
console.log("make-icons: wrote src/app/icon.svg, apple-icon.png, favicon.ico and public/icons/");
