import { describe, expect, it } from "vitest";
import { animationJob, bitrateForSize, cleanJob, compressVideoJob, containerOf, convertAudioJob, convertVideoJob, NO_METADATA, outputDuration, scaledSize, trimJob } from "../jobs";
import { codecLabel, formatIso6709, parseProbe, type MediaInfo, type ProbeJson } from "../probe";
import { formatTime, parseTime } from "../time";

// What ffprobe reports for a portrait iPhone video (HDR HEVC, 1920 × 1080 stored, rotated 90°).
const IPHONE: ProbeJson = {
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "hevc",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30000/1001",
      color_transfer: "arib-std-b67",
      bit_rate: "8000000",
      side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
      tags: { creation_time: "2026-05-01T10:00:00.000000Z", handler_name: "Core Media Video", vendor_id: "[0][0][0][0]", language: "und" },
    },
    { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2, bit_rate: "160000", tags: { handler_name: "Core Media Audio" } },
    { index: 2, codec_type: "data", codec_tag_string: "mebx", tags: { handler_name: "Core Media Metadata" } },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    format_long_name: "QuickTime / MOV",
    duration: "12.500000",
    bit_rate: "8200000",
    tags: {
      major_brand: "qt  ",
      compatible_brands: "qt  ",
      creation_time: "2026-05-01T10:00:00.000000Z",
      "com.apple.quicktime.location.ISO6709": "+51.5007-000.1246+012.000/",
      "com.apple.quicktime.make": "Apple",
      "com.apple.quicktime.model": "iPhone 15 Pro",
      "com.apple.quicktime.software": "17.4.1",
      "com.apple.quicktime.creationdate": "2026-05-01T11:00:00+0100",
    },
  },
};

const AUDIO: ProbeJson = {
  streams: [
    { index: 0, codec_type: "audio", codec_name: "flac", sample_rate: "96000", channels: 2, bits_per_raw_sample: "24" },
    { index: 1, codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 }, tags: { comment: "Cover (front)" } },
  ],
  format: { format_name: "flac", duration: "200.0", tags: { TITLE: "Voice memo", ARTIST: "Jane Doe", DATE: "2026" } },
  chapters: [{ tags: { title: "Intro" } }],
};

const info = (json: ProbeJson): MediaInfo => parseProbe(json);
const iphone = info(IPHONE);
const IN = "/in/input.mov";

/** The value after a flag. */
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("times", () => {
  it("reads seconds and clock times", () => {
    expect(parseTime("90")).toBe(90);
    expect(parseTime("1.5")).toBe(1.5);
    expect(parseTime("1,5")).toBe(1.5);
    expect(parseTime("1:30")).toBe(90);
    expect(parseTime(" 1:02:03.5 ")).toBe(3723.5);
    for (const bad of ["", "abc", "1:75", "1:60:00", "-3", "1::2"]) expect(parseTime(bad)).toBeNull();
  });

  it("writes clock times", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(62)).toBe("1:02");
    expect(formatTime(3723)).toBe("1:02:03");
    expect(formatTime(5.34, 1)).toBe("0:05.3");
    expect(formatTime(59.96, 1)).toBe("1:00.0");
  });
});

describe("probe", () => {
  it("reads the main tracks, turning a rotated phone video upright", () => {
    expect(iphone.duration).toBe(12.5);
    expect(iphone.video).toMatchObject({ codec: "hevc", width: 1080, height: 1920, rotation: 270, fps: 29.97, hdr: true });
    expect(iphone.audio).toMatchObject({ codec: "aac", channels: 2, sampleRate: 44100 });
    expect(iphone.cover).toBe(false);
  });

  it("lists the revealing details, grouped, and skips structural ones", () => {
    const byLabel = Object.fromEntries(iphone.details.map((d) => [`${d.label}@${d.where}`, d]));
    expect(byLabel["Location@file"]).toMatchObject({ group: "location", value: "51.5007, -0.1246 (12 m)" });
    expect(byLabel["Make@file"].group).toBe("device");
    expect(byLabel["Model@file"].value).toBe("iPhone 15 Pro");
    expect(byLabel["Software@file"].group).toBe("software");
    expect(byLabel["Created@file"].group).toBe("dates");
    expect(byLabel["Created@video track"].group).toBe("dates");
    expect(byLabel["Timed metadata track@data track"].value).toBe("Core Media Metadata");
    expect(iphone.details.some((d) => /brand|handler|vendor|language/i.test(d.label))).toBe(false);
  });

  it("recognises cover art, tags and chapter titles in music", () => {
    const flac = info(AUDIO);
    expect(flac.video).toBeNull();
    expect(flac.cover).toBe(true);
    expect(flac.audio).toMatchObject({ bitDepth: 24, sampleRate: 96000 });
    expect(flac.details.map((d) => [d.group, d.label, d.where])).toEqual([
      ["text", "Title", "file"],
      ["text", "Artist", "file"],
      ["dates", "Date", "file"],
      ["text", "Comment", "cover"],
      ["text", "Title", "chapter 1"],
    ]);
  });

  it("formats ISO 6709 locations and codec names", () => {
    expect(formatIso6709("+37.7749-122.4194/")).toBe("37.7749, -122.4194");
    expect(formatIso6709("not a place")).toBeNull();
    expect(codecLabel("hevc")).toBe("HEVC (H.265)");
    expect(codecLabel("pcm_s24le")).toBe("PCM");
    expect(codecLabel("dnxhd")).toBe("DNXHD");
  });
});

describe("jobs", () => {
  it("never copies or adds metadata", () => {
    for (const job of [
      convertVideoJob(iphone, IN, { target: "mp4", quality: "balanced", maxShort: null, fps: null, mute: false, trim: null }),
      convertAudioJob(iphone, IN, { target: "mp3", bitrate: 192, channels: null, normalize: false, trim: null }),
      cleanJob(iphone, IN, "clip.mov", { keepCover: true }),
      trimJob(iphone, IN, "clip.mov", { start: 1, end: 2, exact: false }),
      animationJob(iphone, IN, { target: "gif", fps: 12, width: 480, loop: true, trim: null }),
    ]) {
      const tail = job.args.slice(-NO_METADATA.length - 3, -3);
      expect(tail).toEqual(NO_METADATA);
      expect(job.args.slice(-3)).toEqual(["-f", job.container.muxer, job.output]);
    }
  });

  it("converts video: tone-maps HDR, scales the short side, keeps even sizes", () => {
    const job = convertVideoJob(iphone, IN, { target: "mp4", quality: "high", maxShort: 720, fps: 24, mute: false, trim: { start: 2, end: 7 } });
    const vf = flag(job.args, "-vf");
    expect(vf).toMatch(/^zscale=t=linear.*tonemap=tonemap=hable/);
    expect(vf).toContain("scale=720:1280");
    expect(vf).toContain("fps=24");
    expect(vf.endsWith("format=yuv420p")).toBe(true);
    expect(job.args.slice(0, 6)).toEqual(["-ss", "2", "-i", IN, "-t", "5"]);
    expect(flag(job.args, "-crf")).toBe("20");
    expect(flag(job.args, "-c:a")).toBe("aac");
    expect(job.args).toContain("+faststart");
    expect(job.duration).toBe(5);
    expect(job.output).toBe("/out/output.mp4");
  });

  it("writes WebM as VP8 + Opus, and can drop the sound", () => {
    const job = convertVideoJob(iphone, IN, { target: "webm", quality: "small", maxShort: null, fps: 60, mute: true, trim: null });
    expect(flag(job.args, "-c:v")).toBe("libvpx");
    expect(job.args).not.toContain("0:a:0");
    expect(job.args).not.toContain("-c:a");
    expect(flag(job.args, "-vf")).not.toContain("fps="); // 60 isn't lower than 29.97
  });

  it("refuses video jobs on sound-only files and bad trims", () => {
    const flac = info(AUDIO);
    expect(() => convertVideoJob(flac, IN, { target: "mp4", quality: "high", maxShort: null, fps: null, mute: false, trim: null })).toThrow(/no video/);
    expect(() => convertAudioJob(iphone, IN, { target: "mp3", bitrate: 128, channels: null, normalize: false, trim: { start: 5, end: 3 } })).toThrow(/after the start/);
    expect(() => convertAudioJob(iphone, IN, { target: "mp3", bitrate: 128, channels: null, normalize: false, trim: { start: 20, end: null } })).toThrow(/past the end/);
  });

  it("compresses to a target size", () => {
    expect(bitrateForSize(10_000_000, 100, 128)).toBe(744_000 - 128_000);
    const job = compressVideoJob(iphone, IN, { goal: { mode: "size", bytes: 5_000_000 }, maxShort: 1080, audioKbps: 96, trim: null });
    const k = Number(flag(job.args, "-b:v").replace("k", ""));
    expect(k).toBe(Math.round(bitrateForSize(5_000_000, 12.5, 96) / 1000));
    expect(flag(job.args, "-maxrate")).toBe(`${Math.round(k * 1.5)}k`);
    expect(flag(job.args, "-b:a")).toBe("96k");
    expect(job.container.extension).toBe(".mp4");
    expect(() => compressVideoJob(iphone, IN, { goal: { mode: "size", bytes: 50_000 }, maxShort: null, audioKbps: 128, trim: null })).toThrow(/too small/);
    const quality = compressVideoJob(iphone, IN, { goal: { mode: "quality", crf: 30 }, maxShort: null, audioKbps: 0, trim: null });
    expect(flag(quality.args, "-crf")).toBe("30");
    expect(quality.args).not.toContain("0:a:0");
  });

  it("converts sound, extracting it from video", () => {
    const mp3 = convertAudioJob(iphone, IN, { target: "mp3", bitrate: 192, channels: 1, normalize: true, trim: null });
    expect(mp3.args).toEqual(expect.arrayContaining(["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-ac", "1"]));
    expect(flag(mp3.args, "-af")).toContain("loudnorm");
    expect(flag(mp3.args, "-ar")).toBe("44100");
    const wav = convertAudioJob(info(AUDIO), "/in/input.flac", { target: "wav", bitrate: 0, channels: null, normalize: false, trim: null });
    expect(flag(wav.args, "-c:a")).toBe("pcm_s24le");
    expect(wav.args).not.toContain("-b:a");
    const opus = convertAudioJob(iphone, IN, { target: "opus", bitrate: 96, channels: null, normalize: true, trim: null });
    expect(flag(opus.args, "-ar")).toBe("48000");
  });

  it("trims by copying, or exactly by re-encoding in the same format", () => {
    const fast = trimJob(iphone, IN, "clip.mov", { start: 1.25, end: 4, exact: false });
    expect(fast.args).toEqual(expect.arrayContaining(["-c", "copy", "-avoid_negative_ts", "make_zero", "-tag:v", "hvc1"]));
    expect(fast.container.muxer).toBe("mov");
    expect(fast.duration).toBe(2.75);
    const exact = trimJob(iphone, IN, "clip.mov", { start: 1, end: null, exact: true });
    expect(flag(exact.args, "-c:v")).toBe("libx264");
    expect(exact.duration).toBe(11.5);
    expect(trimJob(iphone, IN, "clip.wmv", { start: 1, end: 2, exact: true }).container.extension).toBe(".mp4");
    expect(trimJob(iphone, IN, "clip.webm", { start: 1, end: 2, exact: true }).args).toContain("libvpx");
    const song = trimJob(info(AUDIO), "/in/input.flac", "song.flac", { start: 0, end: 30, exact: true });
    expect(flag(song.args, "-c:a")).toBe("flac");
    expect(song.args).not.toContain("-vf");
  });

  it("cleans by copying the tracks, dropping data tracks (and the cover if asked)", () => {
    const job = cleanJob(iphone, IN, "IMG_0001.MOV", { keepCover: true });
    expect(job.args).toEqual(expect.arrayContaining(["-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy"]));
    expect(job.args).not.toContain("0:d?");
    expect(job.container.extension).toBe(".mov");
    expect(cleanJob(info(AUDIO), "/in/input.flac", "song.flac", { keepCover: false }).args).toContain("0:V?");
    expect(cleanJob(iphone, IN, "clip.xyz", { keepCover: true }).container.muxer).toBe("matroska");
  });

  it("makes GIFs with their own palette, and animated WebP", () => {
    const gif = animationJob(iphone, IN, { target: "gif", fps: 10, width: 480, loop: false, trim: { start: 0, end: 3 } });
    expect(flag(gif.args, "-filter_complex")).toMatch(/fps=10,scale=480:-1:flags=lanczos,split\[a\]\[b\];\[a\]palettegen/);
    expect(flag(gif.args, "-loop")).toBe("-1");
    const webp = animationJob(iphone, IN, { target: "webp", fps: 15, width: 2000, loop: true, trim: null });
    expect(flag(webp.args, "-c:v")).toBe("libwebp_anim");
    expect(flag(webp.args, "-vf")).not.toMatch(/(^|,)scale=/); // never enlarged
    expect(flag(webp.args, "-loop")).toBe("0");
  });

  it("works out sizes, lengths and containers", () => {
    expect(scaledSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(scaledSize(1080, 1920, 480)).toEqual({ width: 480, height: 854 });
    expect(scaledSize(641, 361, null)).toEqual({ width: 642, height: 362 });
    expect(scaledSize(640, 360, 1080)).toEqual({ width: 640, height: 360 });
    expect(outputDuration(10, { start: 2, end: null })).toBe(8);
    expect(outputDuration(10, { start: 2, end: 30 })).toBe(8);
    expect(outputDuration(null, null)).toBeNull();
    expect(containerOf("Holiday.MP4")?.muxer).toBe("mp4");
    expect(containerOf("song.m4a")?.muxer).toBe("ipod");
    expect(containerOf("notes.txt")).toBeNull();
  });
});
