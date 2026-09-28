import { ProcessingError } from "../errors";
import type { MediaInfo, VideoTrack } from "./probe";

/*
 * ffmpeg command lines for the media tools. Every job writes one file, /out/output<ext>, and
 * copies none of the input's descriptive metadata (location, device, dates, titles) nor adds any
 * of its own: no encoder or creation-time tags (-fflags/-flags +bitexact).
 */

export interface Container {
  extension: string;
  /** ffmpeg's muxer name. */
  muxer: string;
  mime: string;
  label: string;
}

const c = (extension: string, muxer: string, mime: string, label: string): Container => ({ extension, muxer, mime, label });

/** Output containers by input extension, for tools that keep the file's format (trim, clean). */
const CONTAINERS: Record<string, Container> = {
  mp4: c(".mp4", "mp4", "video/mp4", "MP4"),
  m4v: c(".m4v", "mp4", "video/x-m4v", "M4V"),
  mov: c(".mov", "mov", "video/quicktime", "MOV"),
  mkv: c(".mkv", "matroska", "video/x-matroska", "MKV"),
  webm: c(".webm", "webm", "video/webm", "WebM"),
  avi: c(".avi", "avi", "video/x-msvideo", "AVI"),
  "3gp": c(".3gp", "3gp", "video/3gpp", "3GP"),
  "3g2": c(".3g2", "3g2", "video/3gpp2", "3G2"),
  wmv: c(".wmv", "asf", "video/x-ms-wmv", "WMV"),
  flv: c(".flv", "flv", "video/x-flv", "FLV"),
  mpg: c(".mpg", "mpeg", "video/mpeg", "MPEG"),
  mpeg: c(".mpeg", "mpeg", "video/mpeg", "MPEG"),
  mts: c(".mts", "mpegts", "video/mp2t", "MTS"),
  m2ts: c(".m2ts", "mpegts", "video/mp2t", "M2TS"),
  ogv: c(".ogv", "ogg", "video/ogg", "OGV"),
  mp3: c(".mp3", "mp3", "audio/mpeg", "MP3"),
  wav: c(".wav", "wav", "audio/wav", "WAV"),
  m4a: c(".m4a", "ipod", "audio/mp4", "M4A"),
  aac: c(".aac", "adts", "audio/aac", "AAC"),
  ogg: c(".ogg", "ogg", "audio/ogg", "OGG"),
  oga: c(".oga", "ogg", "audio/ogg", "OGG"),
  opus: c(".opus", "opus", "audio/ogg", "Opus"),
  flac: c(".flac", "flac", "audio/flac", "FLAC"),
  wma: c(".wma", "asf", "audio/x-ms-wma", "WMA"),
  aif: c(".aif", "aiff", "audio/aiff", "AIFF"),
  aiff: c(".aiff", "aiff", "audio/aiff", "AIFF"),
  amr: c(".amr", "amr", "audio/amr", "AMR"),
  weba: c(".weba", "webm", "audio/webm", "WebM audio"),
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The container a file's name says it is in, or null for an extension we don't write. */
export function containerOf(name: string): Container | null {
  return CONTAINERS[extensionOf(name)] ?? null;
}

// ---------------------------------------------------------------- Output formats

export type VideoTarget = "mp4" | "webm" | "mov" | "mkv";
export type AudioTarget = "mp3" | "m4a" | "wav" | "flac" | "ogg" | "opus";
export type Quality = "high" | "balanced" | "small";

export const VIDEO_TARGETS: Record<VideoTarget, { container: Container; video: "h264" | "vp8"; audio: "aac" | "opus"; note: string }> = {
  mp4: { container: CONTAINERS.mp4, video: "h264", audio: "aac", note: "H.264 + AAC: plays everywhere." },
  webm: { container: CONTAINERS.webm, video: "vp8", audio: "opus", note: "VP8 + Opus: for the web; larger than MP4 at the same quality." },
  mov: { container: CONTAINERS.mov, video: "h264", audio: "aac", note: "H.264 + AAC in a QuickTime file." },
  mkv: { container: CONTAINERS.mkv, video: "h264", audio: "aac", note: "H.264 + AAC in Matroska." },
};

export const AUDIO_TARGETS: Record<AudioTarget, { container: Container; codec: string[]; lossless: boolean; bitrates: number[]; bitrate: number }> = {
  mp3: { container: CONTAINERS.mp3, codec: ["-c:a", "libmp3lame"], lossless: false, bitrates: [320, 256, 192, 160, 128, 96, 64], bitrate: 192 },
  m4a: { container: CONTAINERS.m4a, codec: ["-c:a", "aac"], lossless: false, bitrates: [256, 192, 160, 128, 96, 64], bitrate: 160 },
  ogg: { container: CONTAINERS.ogg, codec: ["-c:a", "libvorbis"], lossless: false, bitrates: [256, 192, 160, 128, 96, 64], bitrate: 160 },
  opus: { container: CONTAINERS.opus, codec: ["-c:a", "libopus"], lossless: false, bitrates: [192, 160, 128, 96, 64, 48, 32], bitrate: 128 },
  wav: { container: CONTAINERS.wav, codec: ["-c:a", "pcm_s16le"], lossless: true, bitrates: [], bitrate: 0 },
  flac: { container: CONTAINERS.flac, codec: ["-c:a", "flac"], lossless: true, bitrates: [], bitrate: 0 },
};

// ---------------------------------------------------------------- Shared pieces

export interface Trim {
  /** Seconds from the start. */
  start: number;
  /** Seconds from the start; null runs to the end. */
  end: number | null;
}

export interface MediaJob {
  args: string[];
  output: string;
  container: Container;
  /** Length of the result in seconds (for progress), null when unknown. */
  duration: number | null;
}

/** Descriptive metadata isn't copied, chapters (with their titles) are dropped, nothing is added. */
export const NO_METADATA = ["-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact"];

const TONE_MAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

const secs = (s: number) => String(Math.round(s * 1000) / 1000);

function checkTrim(trim: Trim | null, duration: number | null): void {
  if (!trim) return;
  if (trim.start < 0 || (trim.end !== null && trim.end <= trim.start)) throw new ProcessingError("The end must come after the start.", "invalid");
  if (duration !== null && trim.start >= duration) throw new ProcessingError("The start is past the end of the file.", "invalid");
}

function inputArgs(input: string, trim: Trim | null): string[] {
  const args: string[] = [];
  if (trim && trim.start > 0) args.push("-ss", secs(trim.start));
  args.push("-i", input);
  if (trim && trim.end !== null) args.push("-t", secs(trim.end - trim.start));
  return args;
}

/** How long the output runs: the trimmed part, or the whole file. */
export function outputDuration(duration: number | null, trim: Trim | null): number | null {
  if (!trim) return duration;
  const end = trim.end === null ? duration : duration === null ? trim.end : Math.min(trim.end, duration);
  return end === null ? null : Math.max(0, end - trim.start);
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The size a video becomes when its shorter side is limited to `maxShort` (never enlarged; always even). */
export function scaledSize(width: number, height: number, maxShort: number | null): { width: number; height: number } {
  const short = Math.min(width, height);
  const factor = maxShort && short > maxShort ? maxShort / short : 1;
  return { width: even(width * factor), height: even(height * factor) };
}

/** Picture filters: HDR to ordinary colours, size, frame rate, and a pixel format every player takes. */
function pictureFilters(video: VideoTrack | null, maxShort: number | null, fps: number | null): string[] {
  const filters: string[] = [];
  if (video?.hdr) filters.push(TONE_MAP);
  if (video && video.width && video.height) {
    const size = scaledSize(video.width, video.height, maxShort);
    if (size.width !== video.width || size.height !== video.height) filters.push(`scale=${size.width}:${size.height}`);
  } else {
    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  }
  if (fps && (!video?.fps || fps < video.fps - 0.01)) filters.push(`fps=${fps}`);
  filters.push("format=yuv420p");
  return filters;
}

const X264_CRF: Record<Quality, number> = { high: 20, balanced: 23, small: 28 };
const VP8: Record<Quality, { crf: number; bitsPerPixel: number }> = {
  high: { crf: 8, bitsPerPixel: 0.2 },
  balanced: { crf: 14, bitsPerPixel: 0.12 },
  small: { crf: 24, bitsPerPixel: 0.07 },
};
const AUDIO_KBPS: Record<Quality, number> = { high: 192, balanced: 160, small: 128 };

function h264(crf: number): string[] {
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf)];
}

function vp8(quality: Quality, video: VideoTrack | null, maxShort: number | null, fps: number | null): string[] {
  const { crf, bitsPerPixel } = VP8[quality];
  const size = video?.width ? scaledSize(video.width, video.height, maxShort) : { width: 1280, height: 720 };
  const rate = Math.min(fps ?? 60, video?.fps ?? 30);
  const cap = Math.max(200, Math.round((size.width * size.height * rate * bitsPerPixel) / 1000));
  return ["-c:v", "libvpx", "-deadline", "good", "-cpu-used", "5", "-crf", String(crf), "-b:v", `${cap}k`];
}

function containerArgs(container: Container, video: VideoTrack | null, copying: boolean): string[] {
  const args: string[] = [];
  if (container.muxer === "mp4" || container.muxer === "mov" || container.muxer === "ipod") args.push("-movflags", "+faststart");
  // Apple players want HEVC tagged hvc1, which a copied stream may not be.
  if (copying && video?.codec === "hevc" && (container.muxer === "mp4" || container.muxer === "mov")) args.push("-tag:v", "hvc1");
  return args;
}

const output = (container: Container) => `/out/output${container.extension}`;

function finish(container: Container, args: string[], duration: number | null): MediaJob {
  const path = output(container);
  return { args: [...args, ...NO_METADATA, "-f", container.muxer, path], output: path, container, duration };
}

function needsVideo(info: MediaInfo): void {
  if (!info.video) throw new ProcessingError("This file has no video track. Use Convert Audio for sound-only files.", "invalid");
}

// ---------------------------------------------------------------- Jobs

export interface VideoOptions {
  target: VideoTarget;
  quality: Quality;
  /** Limit the shorter side to this many pixels (720 = 720p); null keeps the size. */
  maxShort: number | null;
  /** Lower the frame rate to this; null keeps it. */
  fps: number | null;
  mute: boolean;
  trim: Trim | null;
}

export function convertVideoJob(info: MediaInfo, input: string, options: VideoOptions): MediaJob {
  needsVideo(info);
  checkTrim(options.trim, info.duration);
  const target = VIDEO_TARGETS[options.target];
  const args = [...inputArgs(input, options.trim), "-map", "0:V:0"];
  if (info.audio && !options.mute) args.push("-map", "0:a:0");
  args.push("-vf", pictureFilters(info.video, options.maxShort, options.fps).join(","));
  args.push(...(target.video === "h264" ? h264(X264_CRF[options.quality]) : vp8(options.quality, info.video, options.maxShort, options.fps)));
  if (info.audio && !options.mute) {
    args.push(...(target.audio === "aac" ? ["-c:a", "aac"] : ["-c:a", "libopus"]), "-b:a", `${target.audio === "opus" ? AUDIO_KBPS[options.quality] - 32 : AUDIO_KBPS[options.quality]}k`);
  }
  args.push(...containerArgs(target.container, info.video, false));
  return finish(target.container, args, outputDuration(info.duration, options.trim));
}

export type CompressGoal = { mode: "quality"; crf: number } | { mode: "size"; bytes: number };

export interface CompressOptions {
  goal: CompressGoal;
  maxShort: number | null;
  /** Sound bitrate in kbps; 0 removes the sound. */
  audioKbps: number;
  trim: Trim | null;
}

/** Below this, H.264 turns to mush; the tool asks for a larger size or a lower resolution. */
const MIN_VIDEO_BPS = 60_000;

/** Video bitrate (bits/s) that makes a `seconds`-long file about `bytes` big with this much sound. */
export function bitrateForSize(bytes: number, seconds: number, audioKbps: number): number {
  // Aim a little low: the container and rate control's overshoot take the rest.
  return Math.floor((bytes * 8 * 0.93) / seconds - audioKbps * 1000);
}

export function compressVideoJob(info: MediaInfo, input: string, options: CompressOptions): MediaJob {
  needsVideo(info);
  checkTrim(options.trim, info.duration);
  const duration = outputDuration(info.duration, options.trim);
  const withAudio = !!info.audio && options.audioKbps > 0;
  const args = [...inputArgs(input, options.trim), "-map", "0:V:0"];
  if (withAudio) args.push("-map", "0:a:0");
  args.push("-vf", pictureFilters(info.video, options.maxShort, null).join(","));
  if (options.goal.mode === "quality") {
    args.push(...h264(options.goal.crf));
  } else {
    if (!duration) throw new ProcessingError("This video's length couldn't be read, so a target size can't be worked out. Use a quality level instead.", "unsupported");
    const bps = bitrateForSize(options.goal.bytes, duration, withAudio ? options.audioKbps : 0);
    if (bps < MIN_VIDEO_BPS) throw new ProcessingError("That size is too small for a video this long. Pick a larger size, trim the video, or lower the sound quality.", "invalid");
    const k = Math.round(bps / 1000);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-b:v", `${k}k`, "-maxrate", `${Math.round(k * 1.5)}k`, "-bufsize", `${k * 2}k`);
  }
  if (withAudio) args.push("-c:a", "aac", "-b:a", `${options.audioKbps}k`);
  args.push(...containerArgs(CONTAINERS.mp4, info.video, false));
  return finish(CONTAINERS.mp4, args, duration);
}

export interface AudioOptions {
  target: AudioTarget;
  /** kbps, for the lossy formats. */
  bitrate: number;
  /** 1 or 2 to mix down or up; null keeps the channels. */
  channels: 1 | 2 | null;
  /** Even out the loudness (EBU R128, -16 LUFS). */
  normalize: boolean;
  trim: Trim | null;
}

export function convertAudioJob(info: MediaInfo, input: string, options: AudioOptions): MediaJob {
  if (!info.audio) throw new ProcessingError("This file has no sound to convert.", "invalid");
  checkTrim(options.trim, info.duration);
  const target = AUDIO_TARGETS[options.target];
  const args = [...inputArgs(input, options.trim), "-map", "0:a:0", "-vn", "-sn", "-dn"];
  // Keep a 24-bit recording 24-bit in WAV.
  args.push(...(options.target === "wav" && (info.audio.bitDepth ?? 16) > 16 ? ["-c:a", "pcm_s24le"] : target.codec));
  if (!target.lossless) args.push("-b:a", `${options.bitrate}k`);
  if (options.channels) args.push("-ac", String(options.channels));
  if (options.normalize) {
    // loudnorm works at 192 kHz internally; put the result back at the source's rate (Opus: 48 kHz).
    args.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", String(options.target === "opus" ? 48000 : (info.audio.sampleRate ?? 48000)));
  }
  args.push(...containerArgs(target.container, null, false));
  return finish(target.container, args, outputDuration(info.duration, options.trim));
}

/** Sound codec for an exact (re-encoded) cut in each container, and whether it takes video (as H.264, or VP8 in WebM); others become MP4 or M4A. */
const EXACT: Record<string, { video: boolean; audio: string[] }> = {
  mp4: { video: true, audio: ["-c:a", "aac", "-b:a", "192k"] },
  m4v: { video: true, audio: ["-c:a", "aac", "-b:a", "192k"] },
  mov: { video: true, audio: ["-c:a", "aac", "-b:a", "192k"] },
  mkv: { video: true, audio: ["-c:a", "aac", "-b:a", "192k"] },
  "3gp": { video: true, audio: ["-c:a", "aac", "-b:a", "128k"] },
  mts: { video: true, audio: ["-c:a", "aac", "-b:a", "192k"] },
  m2ts: { video: true, audio: ["-c:a", "aac", "-b:a", "192k"] },
  webm: { video: true, audio: ["-c:a", "libopus", "-b:a", "160k"] },
  mp3: { video: false, audio: ["-c:a", "libmp3lame", "-b:a", "256k"] },
  m4a: { video: false, audio: ["-c:a", "aac", "-b:a", "256k"] },
  aac: { video: false, audio: ["-c:a", "aac", "-b:a", "256k"] },
  wav: { video: false, audio: ["-c:a", "pcm_s16le"] },
  flac: { video: false, audio: ["-c:a", "flac"] },
  ogg: { video: false, audio: ["-c:a", "libvorbis", "-b:a", "192k"] },
  oga: { video: false, audio: ["-c:a", "libvorbis", "-b:a", "192k"] },
  opus: { video: false, audio: ["-c:a", "libopus", "-b:a", "160k"] },
  weba: { video: false, audio: ["-c:a", "libopus", "-b:a", "160k"] },
  aif: { video: false, audio: ["-c:a", "pcm_s16be"] },
  aiff: { video: false, audio: ["-c:a", "pcm_s16be"] },
};

export interface TrimOptions extends Trim {
  /** Re-encode to cut exactly; otherwise copy, starting at the keyframe at or before `start`. */
  exact: boolean;
}

/** Streams worth keeping when copying: pictures, sound and subtitles (not data tracks or attachments). */
const copyMaps = (keepCover: boolean) => ["-map", keepCover ? "0:v?" : "0:V?", "-map", "0:a?", "-map", "0:s?"];

export function trimJob(info: MediaInfo, input: string, name: string, options: TrimOptions): MediaJob {
  const trim = { start: options.start, end: options.end };
  checkTrim(trim, info.duration);
  const duration = outputDuration(info.duration, trim);
  const ext = extensionOf(name);
  if (!options.exact) {
    const container = containerOf(name) ?? (info.video ? CONTAINERS.mkv : CONTAINERS.m4a);
    const args = [...inputArgs(input, trim), ...copyMaps(true), "-c", "copy", "-avoid_negative_ts", "make_zero", ...containerArgs(container, info.video, true)];
    return finish(container, args, duration);
  }
  const codecs = EXACT[ext] && (EXACT[ext].video || !info.video) ? EXACT[ext] : undefined;
  const container = codecs ? containerOf(name)! : info.video ? CONTAINERS.mp4 : CONTAINERS.m4a;
  const { audio } = codecs ?? (info.video ? EXACT.mp4 : EXACT.m4a);
  const video = container.muxer === "webm" ? vp8("high", info.video, null, null) : h264(18);
  const args = inputArgs(input, trim);
  if (info.video) args.push("-map", "0:V:0", "-vf", pictureFilters(info.video, null, null).join(","), ...video);
  if (info.audio) args.push("-map", "0:a:0", ...audio);
  if (!info.video && !info.audio) throw new ProcessingError("This file has no sound or picture to cut.", "invalid");
  args.push(...containerArgs(container, info.video, false));
  return finish(container, args, duration);
}

export interface CleanOptions {
  /** Keep album art / a cover picture. */
  keepCover: boolean;
}

/** Copies every picture, sound and subtitle track untouched into a new file without the details. */
export function cleanJob(info: MediaInfo, input: string, name: string, options: CleanOptions): MediaJob {
  const container = containerOf(name) ?? (info.video ? CONTAINERS.mkv : CONTAINERS.m4a);
  const args = [...inputArgs(input, null), ...copyMaps(options.keepCover), "-c", "copy", ...containerArgs(container, info.video, true)];
  return finish(container, args, info.duration);
}

export type AnimationTarget = "gif" | "webp";

export const ANIMATION_TARGETS: Record<AnimationTarget, Container> = {
  gif: c(".gif", "gif", "image/gif", "GIF"),
  webp: c(".webp", "webp", "image/webp", "WebP"),
};

export interface AnimationOptions {
  target: AnimationTarget;
  fps: number;
  /** Width in pixels (never enlarged); null keeps it. */
  width: number | null;
  loop: boolean;
  trim: Trim | null;
}

export function animationJob(info: MediaInfo, input: string, options: AnimationOptions): MediaJob {
  needsVideo(info);
  checkTrim(options.trim, info.duration);
  const video = info.video!;
  const container = ANIMATION_TARGETS[options.target];
  const filters: string[] = [];
  if (video.hdr) filters.push(TONE_MAP);
  filters.push(`fps=${options.fps}`);
  if (options.width && video.width > options.width) filters.push(`scale=${options.width}:-1:flags=lanczos`);
  const args = inputArgs(input, options.trim);
  if (options.target === "gif") {
    // One palette made for this clip, then applied with light dithering: far better than the web-safe default.
    args.push("-filter_complex", `[0:V:0]${filters.join(",")},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, "-loop", options.loop ? "0" : "-1");
  } else {
    args.push("-map", "0:V:0", "-vf", filters.join(","), "-c:v", "libwebp_anim", "-quality", "75", "-loop", options.loop ? "0" : "1");
  }
  args.push("-an");
  return finish(container, args, outputDuration(info.duration, options.trim));
}
