// Milestone 16: the audio and video tools (ffmpeg.wasm add-on). Fixtures are made by the engine
// itself in a separate browser; results are downloaded and read back with ffprobe (and searched
// byte by byte for the details that must be gone). Run via `npm run e2e`.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(`${repo}/src/lib/media/engine.json`, "utf8"));
const ENGINE = `/addons/ffmpeg-${version}/ffmpeg.worker.js`;
const base = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const step = (s) => console.log("✓", s);

const browser = await chromium.launch();

// ---------------------------------------------------------------- The engine, driven directly
// A separate context, so the app's own context starts without the engine downloaded.
const lab = await (await browser.newContext()).newPage();
await lab.goto(base + "/", { waitUntil: "networkidle" });
/** Run ffmpeg ("run") or ffprobe ("probe") in a fresh engine; files travel as base64. */
async function engine(type, { args = [], input = null, output = null } = {}) {
  return lab.evaluate(
    async ({ url, type, args, input, output }) => {
      const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const toB64 = (bytes) => {
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const worker = new Worker(url);
      const file = input && new File([fromB64(input.data)], input.name);
      const reply = await new Promise((resolve) => {
        worker.onmessage = ({ data }) => (data.type === "done" || data.type === "error") && resolve(data);
        worker.postMessage(type === "probe" ? { id: 1, type, input: file } : { id: 1, type, args, inputs: file ? [file] : [], outputs: output ? [output] : [] });
      });
      worker.terminate();
      if (reply.type === "error") throw new Error(reply.message);
      return type === "probe" ? JSON.parse(reply.json) : { code: reply.code, data: reply.files[output] && toB64(reply.files[output]) };
    },
    { url: ENGINE, type, args, input, output },
  );
}
const probe = (name, bytes) => engine("probe", { input: { name, data: Buffer.from(bytes).toString("base64") } });
const streamsOf = (json, type) => json.streams.filter((s) => s.codec_type === type && !s.disposition?.attached_pic);

mkdirSync("m16", { recursive: true });
async function make(name, args) {
  const result = await engine("run", { args: [...args, `/out/${name}`], output: `/out/${name}` });
  assert.equal(result.code, 0, `made ${name}`);
  writeFileSync(`m16/${name}`, Buffer.from(result.data, "base64"));
}
// An iPhone-style video: portrait (rotated), with Apple's location, device and date keys.
await make("phone.mov", [
  ...["-f", "lavfi", "-i", "testsrc2=duration=4:size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=4"],
  ...["-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest"],
  ...["-movflags", "use_metadata_tags"],
  ...["-metadata", "com.apple.quicktime.location.ISO6709=+51.5007-000.1246+012.000/", "-metadata", "com.apple.quicktime.make=Apple"],
  ...["-metadata", "com.apple.quicktime.model=iPhone 15 Pro", "-metadata", "com.apple.quicktime.software=17.4.1"],
  ...["-metadata", "com.apple.quicktime.creationdate=2026-05-01T11:00:00+0100", "-metadata", "title=Secret meeting", "-f", "mov"],
]);
await make("song.mp3", [
  ...["-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "libmp3lame", "-b:a", "128k"],
  ...["-metadata", "title=Secret memo", "-metadata", "artist=Jane Doe", "-metadata", "comment=Recorded at home", "-metadata", "date=2026"],
]);
// Portrait, the way phones store it: landscape pixels plus a 90° matrix in the video track header
// (this FFmpeg version can't write one). tkhd: the matrix starts 40 bytes after the box type.
{
  const mov = readFileSync("m16/phone.mov");
  const at = mov.indexOf("tkhd") + 4 + 40;
  [0, 0x10000, 0, -0x10000, 0].forEach((v, i) => mov.writeInt32BE(v, at + i * 4));
  writeFileSync("m16/phone.mov", mov);
}
writeFileSync("m16/broken.mp4", Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 251)));
const phone = readFileSync("m16/phone.mov");
const phoneInfo = await probe("phone.mov", phone);
assert.equal(phoneInfo.format.tags["com.apple.quicktime.model"], "iPhone 15 Pro", "the fixture carries the details");
assert.equal(phoneInfo.streams[0].side_data_list?.[0]?.rotation, -90, "the fixture is portrait");
step(`fixtures made by the engine: an iPhone-style MOV (${(phone.length / 1024).toFixed(0)} KB, location, model, dates), a tagged MP3, a broken file`);

/** Search raw bytes (the details must be gone, not just unlisted). */
const SECRETS = ["iPhone 15 Pro", "Secret meeting", "Secret memo", "Jane Doe", "Recorded at home", "51.5007", "17.4.1", "2026-05-01", "com.apple.quicktime.location"];
function assertClean(bytes, label) {
  const text = Buffer.from(bytes).toString("latin1");
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${label}: “${secret}” is gone`);
  assert.ok(!/Lav[fc]\d/.test(text.replace(/Lavc59\.37\.100/g, "")), `${label}: no versioned encoder tag added`);
}

// ---------------------------------------------------------------- The app
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const origins = new Set();
const watch = (p) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => origins.add(new URL(r.url()).origin));
  p.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
};
watch(page);
const main = (p = page) => p.locator("main");
const open = async (tool, files, p = page) => {
  await p.goto(`${base}/tools/${tool}/`, { waitUntil: "networkidle" });
  await main(p).locator('input[type="file"]').first().setInputFiles(files);
};
async function download(p = page) {
  const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download result", exact: true }).click()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
const LONG = { timeout: 180_000 };

// ---------------------------------------------------------------- Remove metadata (first use downloads the engine)
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.evaluate(() => navigator.serviceWorker.ready);
await open("clean-media", ["m16/phone.mov"]);
const check = page.getByRole("button", { name: "Check this file" });
await check.click();
await page.getByRole("status").filter({ hasText: /Downloading the media engine|Starting the media engine/ }).first().waitFor();
const found = page.getByRole("region", { name: "Details found" });
await found.waitFor(LONG);
const foundText = await found.textContent();
for (const text of ["Location", "51.5007, -0.1246 (12 m)", "Device", "iPhone 15 Pro", "Software", "17.4.1", "Dates", "Secret meeting"]) assert.ok(foundText.includes(text), `${text} listed`);
assert.match(await main().getByLabel("Original").innerText(), /0:04 · 360 × 640 · 30 fps · H\.264 — AAC · mono · 44\.1 kHz/);
await page.screenshot({ path: "m16-01-clean-found.png", fullPage: true });
await page.getByRole("button", { name: /^Remove \d+ details$/ }).click();
await page.getByText("Details removed").waitFor(LONG);
await page.getByText("Checked the new file: none of these details are left.").waitFor(LONG);
const cleaned = await download();
assert.equal(cleaned.name, "phone-clean.mov");
assertClean(cleaned.bytes, "cleaned MOV");
const cleanedInfo = await probe("clean.mov", cleaned.bytes);
assert.deepEqual(cleanedInfo.streams.map((s) => [s.codec_type, s.codec_name]), [["video", "h264"], ["audio", "aac"]], "same tracks, copied");
assert.equal(cleanedInfo.streams[0].side_data_list?.[0]?.rotation, -90, "the picture stays upright");
assert.ok(Math.abs(cleaned.bytes.length - phone.length) / phone.length < 0.05, "not re-encoded");
const cachedAddons = await page.evaluate(async () => (await (await caches.open("docsanitize-addons")).keys()).map((r) => new URL(r.url).pathname));
assert.ok(cachedAddons.some((p) => p.endsWith("/ffmpeg-core.wasm")), "the engine is kept for offline use");
step("Remove Metadata: first use downloads the engine (kept offline); location, model, software, date and title listed, then gone from the bytes; tracks copied untouched");

await open("clean-media", ["m16/song.mp3"]);
// The engine is on the device now, so the details show without asking.
await found.waitFor(LONG);
assert.match(await found.innerText(), /Jane Doe[\s\S]*Recorded at home|Recorded at home[\s\S]*Jane Doe/);
await page.getByRole("button", { name: /^Remove \d+ details$/ }).click();
await page.getByText("Checked the new file: none of these details are left.").waitFor(LONG);
const cleanSong = await download();
assertClean(cleanSong.bytes, "cleaned MP3");
assert.equal(streamsOf(await probe("s.mp3", cleanSong.bytes), "audio")[0].codec_name, "mp3");
step("Remove Metadata on an MP3: title, artist, comment and date removed without asking twice");

// ---------------------------------------------------------------- Convert Video
await open("convert-video", ["m16/phone.mov"]);
await main().getByText("0:04 · 360 × 640").waitFor(LONG);
await page.getByRole("radio", { name: "Small file" }).click();
await page.getByLabel("Resolution").selectOption("360");
await page.getByRole("checkbox", { name: "Remove the sound" }).check();
await main().getByRole("textbox", { name: "Start" }).fill("1");
await main().getByRole("textbox", { name: "End" }).fill("0:03");
await page.getByText("Keeps 0:02.0.").waitFor();
await page.getByRole("button", { name: "Convert to MP4" }).click();
await page.getByText("Video converted").waitFor(LONG);
await page.screenshot({ path: "m16-02-convert-video.png", fullPage: true });
const mp4 = await download();
assert.equal(mp4.name, "phone.mp4");
assertClean(mp4.bytes, "converted MP4");
const mp4Info = await probe("v.mp4", mp4.bytes);
const [v] = streamsOf(mp4Info, "video");
assert.deepEqual([v.codec_name, v.width, v.height], ["h264", 360, 640], "upright, H.264, already 360p so not resized");
assert.equal(streamsOf(mp4Info, "audio").length, 0, "sound removed");
assert.ok(Math.abs(Number(mp4Info.format.duration) - 2) < 0.15, `2 s kept (${mp4Info.format.duration})`);
assert.equal(mp4Info.format.tags?.major_brand, "isom");

await page.getByRole("radio", { name: "WebM" }).click();
await page.getByRole("checkbox", { name: "Remove the sound" }).uncheck();
await main().getByRole("textbox", { name: "Start" }).fill("");
await main().getByRole("textbox", { name: "End" }).fill("");
await page.getByRole("button", { name: "Convert to WebM" }).click();
await page.getByText("Video converted").waitFor(LONG);
const webm = await download();
const webmInfo = await probe("v.webm", webm.bytes);
assert.deepEqual(webmInfo.streams.map((s) => s.codec_name), ["vp8", "opus"]);
step("Convert Video: MOV → MP4 (trimmed 1–3 s, no sound, upright) and → WebM (VP8 + Opus)");

// ---------------------------------------------------------------- Compress Video
await open("compress-video", ["m16/phone.mov"]);
await page.getByRole("button", { name: "Compress video" }).click();
await page.getByText("Video compressed").waitFor(LONG);
const medium = await download();
assert.ok(medium.bytes.length < phone.length / 2, `smaller (${medium.bytes.length} of ${phone.length})`);
assert.equal(medium.name, "phone.mp4");
await page.getByRole("radio", { name: "A file size" }).click();
await main().getByRole("textbox", { name: "Target size (MB)" }).fill("0.2");
await page.getByRole("button", { name: "Compress video" }).click();
await page.getByText("Video compressed").waitFor(LONG);
const sized = await download();
assert.ok(sized.bytes.length < 0.2 * 1048576 * 1.15, `about 0.2 MB (${sized.bytes.length})`);
assertClean(sized.bytes, "compressed MP4");
await main().getByRole("textbox", { name: "Target size (MB)" }).fill("0.001");
await page.getByRole("button", { name: "Compress video" }).click();
await page.getByText("That size is too small for a video this long").first().waitFor(LONG);
step(`Compress Video: by quality (${(medium.bytes.length / 1024).toFixed(0)} KB) and to a target size (${(sized.bytes.length / 1024).toFixed(0)} KB ≤ 0.2 MB); an impossible size is explained`);

// ---------------------------------------------------------------- Convert Audio
await open("convert-audio", ["m16/phone.mov"]);
await page.getByRole("heading", { name: "Save the sound" }).waitFor();
await page.getByLabel("Quality").selectOption("128");
await page.getByRole("checkbox", { name: "Even out the loudness" }).check();
await page.getByRole("button", { name: "Convert to MP3" }).click();
await page.getByText("Audio ready").waitFor(LONG);
const extracted = await download();
assert.equal(extracted.name, "phone.mp3");
const extractedInfo = await probe("a.mp3", extracted.bytes);
assert.deepEqual(extractedInfo.streams.map((s) => [s.codec_type, s.codec_name]), [["audio", "mp3"]]);
assert.equal(extractedInfo.streams[0].sample_rate, "44100");
assertClean(extracted.bytes, "extracted MP3");

await open("convert-audio", ["m16/song.mp3"]);
await page.getByRole("radio", { name: "FLAC" }).click();
await page.getByRole("radio", { name: "Mono" }).click();
await page.getByRole("button", { name: "Convert to FLAC" }).click();
await page.getByText("Audio ready").waitFor(LONG);
const flac = await download();
assert.equal(flac.bytes.subarray(0, 4).toString(), "fLaC");
const flacInfo = await probe("a.flac", flac.bytes);
assert.equal(flacInfo.streams[0].channels, 1);
assertClean(flac.bytes, "FLAC");
step("Convert Audio: the sound of a video saved as MP3 (loudness evened out), an MP3 made a mono FLAC; no tags carried over");

// ---------------------------------------------------------------- Trim
await open("trim-media", ["m16/song.mp3"]);
const player = main().locator("audio");
await player.waitFor();
await page.waitForFunction(() => document.querySelector("main audio")?.readyState >= 1, null, { timeout: 30_000 });
await player.evaluate((a) => (a.currentTime = 1));
await page.waitForFunction(() => Math.abs(document.querySelector("main audio").currentTime - 1) < 0.01);
await page.getByRole("button", { name: "Start: use the player's position" }).click();
assert.equal(await main().getByRole("textbox", { name: "Start" }).inputValue(), "0:01.0");
await main().getByRole("textbox", { name: "End" }).fill("2.5");
await page.getByRole("button", { name: "Keep 0:01.5" }).click();
await page.getByText("Trimmed").first().waitFor(LONG);
const cut = await download();
assert.equal(cut.name, "song-trimmed.mp3");
assert.ok(Math.abs(Number((await probe("t.mp3", cut.bytes)).format.duration) - 1.5) < 0.1);
assertClean(cut.bytes, "trimmed MP3");

await open("trim-media", ["m16/phone.mov"]);
await main().getByRole("textbox", { name: "Start" }).fill("0.5");
await main().getByRole("textbox", { name: "End" }).fill("2");
await page.getByRole("radio", { name: "Exact" }).click();
await page.getByRole("button", { name: "Keep 0:01.5" }).click();
await page.getByText("Trimmed").first().waitFor(LONG);
const exact = await download();
assert.equal(exact.name, "phone-trimmed.mov");
const exactInfo = await probe("t.mov", exact.bytes);
assert.ok(Math.abs(Number(exactInfo.format.duration) - 1.5) < 0.1, exactInfo.format.duration);
assert.equal(exactInfo.format.format_name.split(",")[0], "mov");
step("Trim: start taken from the player, MP3 cut losslessly; MOV cut exactly (re-encoded) and kept as MOV");

// ---------------------------------------------------------------- Video to GIF
await open("video-to-gif", ["m16/phone.mov"]);
await page.getByLabel("Width").selectOption("240");
await main().getByRole("textbox", { name: "End" }).fill("1");
await page.getByRole("button", { name: "Make a GIF" }).click();
await page.getByText("GIF ready").waitFor(LONG);
const gif = await download();
assert.equal(gif.name, "phone.gif");
assert.equal(gif.bytes.subarray(0, 6).toString(), "GIF89a");
assert.equal(gif.bytes.readUInt16LE(6), 240, "240 px wide");
assert.ok(gif.bytes.includes(Buffer.from("NETSCAPE2.0")), "loops");
await page.getByRole("radio", { name: "Animated WebP" }).click();
await page.getByRole("button", { name: "Make an animated WebP" }).click();
await page.getByText("WebP ready").waitFor(LONG);
const webp = await download();
assert.equal(webp.bytes.subarray(8, 12).toString(), "WEBP");
assert.ok(webp.bytes.includes(Buffer.from("ANIM")), "animated");
assert.ok(webp.bytes.length < gif.bytes.length, "WebP is smaller");
step(`Video to GIF: a 240 px looping GIF (${(gif.bytes.length / 1024).toFixed(0)} KB) and a smaller animated WebP (${(webp.bytes.length / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------- Cancel and errors
await open("convert-video", ["m16/phone.mov"]);
await page.getByRole("radio", { name: "High" }).click();
await page.getByRole("button", { name: "Convert to MP4" }).click();
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByRole("button", { name: "Convert to MP4" }).waitFor();
assert.equal(await page.getByText("Video converted").count(), 0);
await page.getByRole("button", { name: "Convert to MP4" }).click();
await page.getByText("Video converted").waitFor(LONG);
step("a conversion can be cancelled, and the engine starts afresh for the next one");

await open("convert-video", ["m16/broken.mp4"]);
await page.getByRole("button", { name: "Convert to MP4" }).click();
await page.getByText("This file couldn't be read as audio or video").first().waitFor(LONG);
step("a damaged file gets a clear message");

// ---------------------------------------------------------------- Dark and mobile
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const dp = await dark.newPage();
watch(dp);
await open("convert-audio", ["m16/song.mp3"], dp);
await dp.getByRole("button", { name: "Convert to MP3" }).waitFor();
await dp.waitForTimeout(500);
await dp.screenshot({ path: "m16-03-audio-dark.png", fullPage: true });

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mob.newPage();
watch(mp);
const overflow = {};
for (const [tool, input, ready] of [
  ["clean-media", ["m16/phone.mov"], "Check this file"],
  ["convert-video", ["m16/phone.mov"], "Convert to MP4"],
  ["compress-video", ["m16/phone.mov"], "Compress video"],
  ["convert-audio", ["m16/song.mp3"], "Convert to MP3"],
  ["trim-media", ["m16/song.mp3"], "Choose a start or end"],
  ["video-to-gif", ["m16/phone.mov"], "Make a GIF"],
]) {
  await open(tool, input, mp);
  await mp.getByRole("button", { name: ready }).waitFor();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `m16-04-${tool}-mobile.png`, fullPage: true });
  overflow[tool] = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}
console.log("   mobile overflow px:", overflow);
assert.ok(Object.values(overflow).every((px) => px <= 0), "no horizontal scroll on mobile");
step("dark theme and 390 px mobile screenshots");

console.log("errors:", errors.length ? errors : "none");
console.log("origins:", [...origins]);
assert.deepEqual(errors, []);
assert.deepEqual([...origins], [new URL(base).origin]);
await browser.close();
