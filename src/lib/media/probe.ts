import { msg } from "@/i18n/msg";
/*
 * Reads ffprobe's JSON (-show_format -show_streams -show_chapters) into what the media tools need:
 * the main video and audio track, and every descriptive detail (location, device, dates, names…)
 * that Remove Media Metadata can take out.
 */

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
}

export interface ProbeJson {
  streams?: ProbeStream[];
  format?: { format_name?: string; format_long_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string> };
  chapters?: { tags?: Record<string, string> }[];
}

export interface VideoTrack {
  codec: string;
  /** Size as shown, after the rotation a phone recorded. */
  width: number;
  height: number;
  rotation: number;
  fps: number | null;
  /** HLG or PQ (HDR) — converting to ordinary video needs tone mapping. */
  hdr: boolean;
  bitRate: number | null;
}

export interface AudioTrack {
  codec: string;
  channels: number;
  sampleRate: number | null;
  bitRate: number | null;
  bitDepth: number | null;
}

export type DetailGroup = "location" | "device" | "dates" | "text" | "software" | "other";

export const DETAIL_GROUPS: Record<DetailGroup, string> = {
  location: msg("Location"),
  device: msg("Device"),
  dates: msg("Dates"),
  text: msg("Titles, names & comments"),
  software: msg("Software"),
  other: msg("Other details"),
};

export interface MediaDetail {
  group: DetailGroup;
  label: string;
  value: string;
  /** Where it's stored: "file", "video track", "chapter 2"… */
  where: string;
}

export interface MediaInfo {
  format: string;
  duration: number | null;
  bitRate: number | null;
  video: VideoTrack | null;
  audio: AudioTrack | null;
  audioTracks: number;
  subtitleTracks: number;
  /** Album art or a video's cover picture. */
  cover: boolean;
  details: MediaDetail[];
}

const number = (value: string | number | undefined): number | null => {
  const n = typeof value === "number" ? value : value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function frameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : null;
}

function rotationOf(stream: ProbeStream): number {
  const matrix = stream.side_data_list?.find((d) => typeof d.rotation === "number");
  const degrees = matrix?.rotation ?? Number(stream.tags?.rotate ?? 0);
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

function videoTrack(stream: ProbeStream): VideoTrack {
  const rotation = rotationOf(stream);
  const [w, h] = [stream.width ?? 0, stream.height ?? 0];
  const sideways = rotation === 90 || rotation === 270;
  return {
    codec: stream.codec_name ?? "unknown",
    width: sideways ? h : w,
    height: sideways ? w : h,
    rotation,
    fps: frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate),
    hdr: stream.color_transfer === "smpte2084" || stream.color_transfer === "arib-std-b67",
    bitRate: number(stream.bit_rate),
  };
}

function audioTrack(stream: ProbeStream): AudioTrack {
  return {
    codec: stream.codec_name ?? "unknown",
    channels: stream.channels ?? 2,
    sampleRate: number(stream.sample_rate),
    bitRate: number(stream.bit_rate),
    bitDepth: number(stream.bits_per_raw_sample),
  };
}

// Structural fields every file of a format has; nothing about who made it or where.
const TECHNICAL = /^(major_brand|minor_version|compatible_brands|handler_name|vendor_id|language|rotate|duration|bps|number_of_frames|number_of_bytes|_statistics_tags|mimetype|filename|encoder_options)$/;

const GROUP_RULES: [DetailGroup, RegExp][] = [
  ["location", /location|xyz|gps|iso6709|latitude|longitude|coordinates|place/],
  ["device", /make|model|manufacturer|camera|lens|device|serial/],
  ["software", /encoder|encoded_by|software|writing_app|application|tool|android\.version|^version$/],
  ["dates", /date|creation_time|time$|year|timecode/],
  ["text", /title|artist|author|album|composer|performer|publisher|copyright|comment|description|synopsis|lyrics|genre|keywords|owner|creator|director|producer|show|episode|network|grouping|track|disc|sort|purl|rating|subject/],
];

const LABELS: Record<string, string> = {
  "location.iso6709": msg("Location"),
  "location.accuracy.horizontal": msg("Location accuracy"),
  "location.name": msg("Place name"),
  location: msg("Location"),
  "content.identifier": msg("Content ID"),
  creationdate: msg("Created"),
  creation_time: msg("Created"),
  "_statistics_writing_app": msg("Written by"),
  "_statistics_writing_date_utc": msg("Written on"),
  "android.version": msg("Android version"),
  "android.capture.fps": msg("Capture frame rate"),
};

/** The key without vendor prefixes or language suffixes: "com.apple.quicktime.make" → "make". */
function shortKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/^com\.apple\.quicktime\./, "")
    .replace(/^com\./, "")
    .replace(/-[a-z]{3}$/, "");
}

function labelFor(key: string): string {
  const short = shortKey(key);
  const label = LABELS[short] ?? short.replace(/[._-]+/g, " ").trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "+37.7749-122.4194+010.000/" → "37.7749, -122.4194 (10 m)". */
export function formatIso6709(value: string): string | null {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?(?:CRS[^/]*)?\/?$/.exec(value.trim());
  if (!m) return null;
  const [lat, lon] = [Number(m[1]), Number(m[2])];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const altitude = m[3] ? ` (${Math.round(Number(m[3]))} m)` : "";
  return `${lat}, ${lon}${altitude}`;
}

function detailsFrom(tags: Record<string, string> | undefined, where: string): MediaDetail[] {
  const details: MediaDetail[] = [];
  for (const [key, raw] of Object.entries(tags ?? {})) {
    const short = shortKey(key);
    const value = String(raw).trim();
    if (!value || TECHNICAL.test(short)) continue;
    const group = GROUP_RULES.find(([, pattern]) => pattern.test(short))?.[0] ?? "other";
    details.push({ group, label: labelFor(key), value: (group === "location" && formatIso6709(value)) || value, where });
  }
  return details;
}

export function parseProbe(json: ProbeJson): MediaInfo {
  const streams = json.streams ?? [];
  const pictures = streams.filter((s) => s.codec_type === "video" && s.disposition?.attached_pic);
  const videos = streams.filter((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audios = streams.filter((s) => s.codec_type === "audio");
  const format = json.format ?? {};

  const details = detailsFrom(format.tags, "file");
  for (const stream of streams) {
    const kind = pictures.includes(stream) ? "cover" : stream.codec_type === "video" || stream.codec_type === "audio" || stream.codec_type === "subtitle" ? `${stream.codec_type} track` : "data track";
    details.push(...detailsFrom(stream.tags, kind));
    // Phones add tracks of timed metadata (per-frame location, camera state) beside the picture.
    if (stream.codec_type === "data") {
      details.push({ group: "other", label: msg("Timed metadata track"), value: stream.tags?.handler_name?.trim() || stream.codec_tag_string || "Data", where: "data track" });
    }
  }
  json.chapters?.forEach((chapter, i) => details.push(...detailsFrom(chapter.tags, `chapter ${i + 1}`)));

  const durations = streams.map((s) => number((s as { duration?: string }).duration)).filter((d): d is number => d !== null);
  return {
    format: format.format_long_name || format.format_name || "unknown",
    duration: number(format.duration) ?? (durations.length ? Math.max(...durations) : null),
    bitRate: number(format.bit_rate),
    video: videos[0] ? videoTrack(videos[0]) : null,
    audio: audios[0] ? audioTrack(audios[0]) : null,
    audioTracks: audios.length,
    subtitleTracks: streams.filter((s) => s.codec_type === "subtitle").length,
    cover: pictures.length > 0,
    details,
  };
}

const CODECS: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC (H.265)",
  av1: "AV1",
  vp8: "VP8",
  vp9: "VP9",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  prores: "ProRes",
  theora: "Theora",
  wmv3: "WMV",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  alac: "ALAC",
  ac3: "Dolby Digital",
  eac3: "Dolby Digital Plus",
  wmav2: "WMA",
  amr_nb: "AMR",
};

export function codecLabel(codec: string): string {
  if (codec.startsWith("pcm_")) return "PCM";
  return CODECS[codec] ?? codec.toUpperCase();
}

export function channelsLabel(channels: number): string {
  return channels === 1 ? msg("mono") : channels === 2 ? msg("stereo") : msg`${channels} channels`;
}
