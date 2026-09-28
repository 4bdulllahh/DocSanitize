"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Crosshair, Play, X } from "lucide-react";
import { KindIcon } from "@/components/files/KindIcon";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/files";
import { MEDIA_ENGINE_MB, mediaEngineCached, mediaInputPath, probeMedia, runMedia, type MediaProgress } from "@/lib/media/engine";
import type { MediaJob, Trim } from "@/lib/media/jobs";
import { channelsLabel, codecLabel, type MediaInfo } from "@/lib/media/probe";
import { formatTime, parseTime } from "@/lib/media/time";
import { replaceExtension, withSuffix } from "@/lib/zip";
import { toast } from "@/store/toast";
import { useWorkspaceStore, type WorkspaceFile } from "@/store/workspace";
import { FidelityNote, ProgressBar } from "../shared/ConversionParts";
import { Field, INPUT } from "../shared/controls";
import { SECONDARY, type OutputFile } from "../shared/OutputCard";

/* Pieces shared by the audio and video tools. */

// ---------------------------------------------------------------- Playback

type Player = HTMLVideoElement | HTMLAudioElement;

/** Plays a local file (the browser's own player; nothing is uploaded). */
export function MediaPlayer({ blob, kind, label, playerRef }: { blob: Blob; kind: "video" | "audio" | "image"; label: string; playerRef?: RefObject<Player | null> }) {
  const ownRef = useRef<Player | HTMLImageElement | null>(null);
  const [failed, setFailed] = useState<Blob | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ownRef.current) ownRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const setRef = (element: Player | HTMLImageElement | null) => {
    ownRef.current = element;
    if (playerRef && !(element instanceof HTMLImageElement)) playerRef.current = element;
  };

  if (failed === blob) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg bg-surface-muted p-8 text-center">
        <KindIcon kind={kind === "image" ? "image" : kind} className="size-10 text-fg-subtle" strokeWidth={1.25} />
        <p className="max-w-xs text-sm text-fg-muted">This browser can&apos;t play this format, but the tools can still work with it.</p>
      </div>
    );
  }
  const onError = () => setFailed(blob);
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- local blob URL, nothing to optimize
    return <img ref={setRef} alt={label} onError={onError} className="mx-auto max-h-[26rem] max-w-full rounded" />;
  }
  if (kind === "audio") {
    return <audio ref={setRef} controls preload="metadata" aria-label={label} onError={onError} className="w-full" />;
  }
  return <video ref={setRef} controls playsInline preload="metadata" aria-label={label} onError={onError} className="max-h-[26rem] w-full rounded-lg bg-black" />;
}

/** "0:42 · 1080 × 1920 · 29.97 fps · HEVC (H.265) · HDR" and the sound's format. */
export function MediaFacts({ info }: { info: MediaInfo }) {
  const { video, audio } = info;
  const parts = [
    info.duration !== null ? formatTime(info.duration) : null,
    video ? `${video.width} × ${video.height}` : null,
    video?.fps ? `${Math.round(video.fps * 100) / 100} fps` : null,
    video ? codecLabel(video.codec) : null,
    video?.hdr ? "HDR" : null,
  ].filter(Boolean);
  const sound = audio ? [codecLabel(audio.codec), channelsLabel(audio.channels), audio.sampleRate ? `${audio.sampleRate / 1000} kHz` : null].filter(Boolean).join(" · ") : "No sound";
  return (
    <p className="text-xs text-fg-subtle">
      {parts.join(" · ")}
      {parts.length > 0 && " — "}
      {sound}
      {info.audioTracks > 1 && ` (+${info.audioTracks - 1} more sound track${info.audioTracks > 2 ? "s" : ""})`}
    </p>
  );
}

/** The file being worked on, playable, with what's known about it. */
export function SourceCard({ file, info, playerRef }: { file: WorkspaceFile; info: MediaInfo | null; playerRef?: RefObject<Player | null> }) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="Original">
      <MediaPlayer key={`${file.id}:${file.revision}`} blob={file.file} kind={file.kind === "audio" ? "audio" : "video"} label={`Play ${file.name}`} playerRef={playerRef} />
      {info && <MediaFacts info={info} />}
    </section>
  );
}

/** The result, playable before it's downloaded. */
export function ResultCard({ output }: { output: OutputFile }) {
  const type = output.blob.type;
  const kind = type.startsWith("image/") ? "image" : type.startsWith("audio/") ? "audio" : "video";
  return (
    <section className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="Result">
      <h2 className="text-sm font-semibold text-fg">Result</h2>
      <MediaPlayer blob={output.blob} kind={kind} label={`Play ${output.name}`} />
      <p className="text-xs text-fg-subtle">
        {output.name} · {formatBytes(output.blob.size)}
        {output.detail && ` · ${output.detail}`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- Trim

/** Optional start and end fields ("1:05.5"); empty start is the beginning, empty end the end. */
export function useTrimField(onChange: () => void) {
  const [start, setStartText] = useState("");
  const [end, setEndText] = useState("");
  const startAt = start.trim() ? parseTime(start) : 0;
  const endAt = end.trim() ? parseTime(end) : null;
  let error: string | undefined;
  if (startAt === null || (end.trim() && endAt === null)) error = "Type times like 1:05 or 65.5 (seconds).";
  else if (endAt !== null && endAt <= startAt) error = "The end must come after the start.";
  const value: Trim | null = error || (startAt === 0 && endAt === null) ? null : { start: startAt!, end: endAt };
  return {
    start,
    end,
    error,
    value,
    setStart: (text: string) => {
      setStartText(text);
      onChange();
    },
    setEnd: (text: string) => {
      setEndText(text);
      onChange();
    },
  };
}

/** Play from the start of the part and pause at its end. */
function playBetween(player: Player, { start, end }: Trim) {
  player.currentTime = start;
  void player.play();
  if (end === null) return;
  const check = () => {
    if (player.currentTime >= end) {
      player.pause();
      player.removeEventListener("timeupdate", check);
    }
  };
  player.addEventListener("timeupdate", check);
  player.addEventListener("pause", () => player.removeEventListener("timeupdate", check), { once: true });
}

export function TrimFields({ trim, playerRef, disabled, duration }: { trim: ReturnType<typeof useTrimField>; playerRef?: RefObject<Player | null>; disabled?: boolean; duration: number | null }) {
  const fromPlayer = (set: (text: string) => void) => () => {
    const player = playerRef?.current;
    if (player && Number.isFinite(player.currentTime)) set(formatTime(player.currentTime, 1));
  };
  const playPart = () => {
    if (playerRef?.current && trim.value) playBetween(playerRef.current, trim.value);
  };
  const length = trim.value ? (trim.value.end ?? duration ?? NaN) - trim.value.start : null;
  const field = (label: string, value: string, set: (t: string) => void, placeholder: string) => (
    <div className="flex items-end gap-1.5">
      <Field label={label}>
        <input value={value} disabled={disabled} onChange={(e) => set(e.target.value)} placeholder={placeholder} inputMode="decimal" className={INPUT} />
      </Field>
      {playerRef && (
        <button type="button" disabled={disabled} onClick={fromPlayer(set)} className="mb-px rounded-lg border border-line p-2.5 text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50" title={`Set the ${label.toLowerCase()} to where the player is`} aria-label={`${label}: use the player's position`}>
          <Crosshair className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {field("Start", trim.start, trim.setStart, "0:00")}
        {field("End", trim.end, trim.setEnd, duration ? formatTime(duration, 1) : "The end")}
      </div>
      {trim.error ? (
        <p className="mt-1.5 text-xs text-danger-text">{trim.error}</p>
      ) : (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
          {length !== null && Number.isFinite(length) ? `Keeps ${formatTime(length, 1)}.` : trim.value ? "Keeps from the start time to the end." : "Leave both empty to keep everything."}
          {playerRef && trim.value && (
            <button type="button" onClick={playPart} disabled={disabled} className="inline-flex items-center gap-1 font-medium text-brand-text hover:underline">
              <Play className="size-3" aria-hidden="true" />
              Play this part
            </button>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Running

const probes = new WeakMap<Blob, Promise<MediaInfo>>();

/** Probe each version of a file once. */
function probeOnce(file: File, onProgress?: (p: MediaProgress) => void, signal?: AbortSignal): Promise<MediaInfo> {
  let probe = probes.get(file);
  if (!probe) {
    probe = probeMedia(file, { onProgress, signal });
    probes.set(file, probe);
    probe.catch(() => probes.delete(file));
  }
  return probe;
}

interface Status {
  label: string;
  fraction: number | null;
}

function describe(progress: MediaProgress, verb: string, startedAt: { current: number | null }): Status {
  if (progress.stage === "download") return { label: `Downloading the media engine (${MEDIA_ENGINE_MB} MB, first time only)… ${Math.round(progress.fraction * 100)}%`, fraction: progress.fraction };
  if (progress.stage === "starting") return { label: "Starting the media engine…", fraction: null };
  const now = Date.now();
  startedAt.current ??= now;
  const { fraction, seconds } = progress;
  if (fraction === null) return { label: `${verb}… ${formatTime(seconds)} done`, fraction: null };
  const elapsed = (now - startedAt.current) / 1000;
  const left = fraction > 0.03 && elapsed > 2 ? (elapsed / fraction) * (1 - fraction) : null;
  return { label: `${verb}… ${Math.round(fraction * 100)}%${left !== null ? ` · about ${left < 60 ? `${Math.max(1, Math.round(left))} s` : `${Math.round(left / 60)} min`} left` : ""}`, fraction };
}

/**
 * Runs a media job on the file: probes it (once), builds the job from what's in it, runs it with
 * progress and cancel, and keeps the output. The file's facts show up as soon as they're known.
 */
export function useMediaJob(file: WorkspaceFile, verb = "Converting") {
  const [info, setInfo] = useState<{ file: File; info: MediaInfo } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [output, setOutput] = useState<OutputFile | null>(null);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef<number | null>(null);

  // Read the file's facts straight away if the engine needn't be downloaded for it.
  useEffect(() => {
    let active = true;
    mediaEngineCached().then((cached) => {
      if (!cached || !active) return;
      probeOnce(file.file)
        .then((value) => active && setInfo({ file: file.file, info: value }))
        .catch(() => {});
    });
    return () => {
      active = false;
    };
  }, [file.file]);

  const run = async (make: (info: MediaInfo, input: string) => MediaJob, name: (job: MediaJob) => string, detail?: (info: MediaInfo, blob: Blob) => string | undefined) => {
    const { updateFile } = useWorkspaceStore.getState();
    const controller = new AbortController();
    abort.current = controller;
    startedAt.current = null;
    setOutput(null);
    const onProgress = (p: MediaProgress) => setStatus(describe(p, verb, startedAt));
    setStatus(describe({ stage: "starting" }, verb, startedAt));
    updateFile(file.id, { status: "processing", error: undefined });
    try {
      const facts = await probeOnce(file.file, onProgress, controller.signal);
      setInfo({ file: file.file, info: facts });
      const job = make(facts, mediaInputPath(file.file));
      const blob = await runMedia(file.file, job, { onProgress, signal: controller.signal });
      setOutput({ name: name(job), blob, detail: detail?.(facts, blob) });
      updateFile(file.id, { status: "idle" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateFile(file.id, { status: "idle" });
      } else {
        updateFile(file.id, { status: "error", error: errorMessage(error) });
        toast({ tone: "error", title: "Couldn't process this file", description: errorMessage(error) });
      }
    } finally {
      abort.current = null;
      setStatus(null);
    }
  };

  /** Read the file's facts (downloading the engine if needed) without running anything. */
  const inspect = async () => {
    const controller = new AbortController();
    abort.current = controller;
    const onProgress = (p: MediaProgress) => setStatus(describe(p, verb, startedAt));
    setStatus(describe({ stage: "starting" }, verb, startedAt));
    try {
      setInfo({ file: file.file, info: await probeOnce(file.file, onProgress, controller.signal) });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast({ tone: "error", title: "Couldn't read this file", description: errorMessage(error) });
    } finally {
      abort.current = null;
      setStatus(null);
    }
  };

  return {
    info: info?.file === file.file ? info.info : null,
    busy: status !== null,
    status,
    output,
    clearOutput: () => setOutput(null),
    run,
    inspect,
    cancel: () => abort.current?.abort(),
  };
}

/** Progress and a cancel button while running; otherwise the action button. */
export function RunButton({ job, label, icon: Icon, disabled, className, onClick }: { job: ReturnType<typeof useMediaJob>; label: string; icon: typeof Play; disabled?: boolean; className: string; onClick: () => void }) {
  if (job.status) {
    return (
      <>
        <ProgressBar label={job.status.label} fraction={job.status.fraction} />
        <button type="button" onClick={job.cancel} className={`${SECONDARY} mt-4 w-full`}>
          <X className="size-4" aria-hidden="true" />
          Cancel
        </button>
      </>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

export function EngineNote({ children }: { children?: ReactNode }) {
  return (
    <FidelityNote>
      {children}
      {children && " "}
      Runs on this device with FFmpeg: a {MEDIA_ENGINE_MB} MB download the first time, then it works offline. Long or high-resolution videos take a while.
    </FidelityNote>
  );
}

/** "clip.mov" → "clip.mp4", or "clip-compressed.mp4" when the extension stays the same. */
export function outputName(file: WorkspaceFile, job: MediaJob, suffix: string): string {
  const same = file.name.toLowerCase().endsWith(job.container.extension);
  return same ? withSuffix(file.name, suffix, job.container.extension) : replaceExtension(file.name, job.container.extension);
}
