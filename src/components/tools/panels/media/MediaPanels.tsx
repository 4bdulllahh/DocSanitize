"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import { AudioLines, Clapperboard, Film, ImagePlay, Minimize2 } from "lucide-react";
import { formatBytes } from "@/lib/files";
import {
  ANIMATION_TARGETS,
  animationJob,
  AUDIO_TARGETS,
  compressVideoJob,
  convertAudioJob,
  convertVideoJob,
  extensionOf,
  trimJob,
  VIDEO_TARGETS,
  type AnimationTarget,
  type AudioTarget,
  type Quality,
  type VideoTarget,
} from "@/lib/media/jobs";
import { formatTime } from "@/lib/media/time";
import type { WorkspaceFile } from "@/store/workspace";
import type { ToolPanelProps } from "../registry";
import { Field, INPUT, Segmented, Slider } from "../shared/controls";
import { OutputCard, PRIMARY, type OutputFile } from "../shared/OutputCard";
import { ToolCard } from "../shared/toolkit";
import { EngineNote, outputName, ResultCard, RunButton, SourceCard, TrimFields, useMediaJob, useTrimField } from "./MediaParts";

type Player = HTMLVideoElement | HTMLAudioElement;

const RESOLUTIONS = [
  { id: "keep", label: "Keep the size" },
  { id: "1080", label: "1080p (Full HD)" },
  { id: "720", label: "720p (HD)" },
  { id: "480", label: "480p" },
  { id: "360", label: "360p" },
];
const maxShortOf = (id: string) => (id === "keep" ? null : Number(id));

const sameFormat = (file: WorkspaceFile, output: OutputFile) => extensionOf(file.name) === extensionOf(output.name);

/**
 * Source and result on the left, options on the right. Unlike the document tools, small screens
 * show the player first: its position sets the start and end of a part.
 */
function MediaLayout({ file, job, playerRef, children }: { file: WorkspaceFile; job: ReturnType<typeof useMediaJob>; playerRef?: RefObject<Player | null>; children: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <SourceCard file={file} info={job.info} playerRef={playerRef} />
        {job.output && <ResultCard output={job.output} />}
      </div>
      <div className="space-y-4 lg:sticky lg:top-20">{children}</div>
    </div>
  );
}

function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={clsx("mt-4 flex cursor-pointer items-start gap-3", disabled && "opacity-50")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

function PartToKeep({ trim, playerRef, disabled, duration }: { trim: ReturnType<typeof useTrimField>; playerRef: RefObject<Player | null>; disabled: boolean; duration: number | null }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium text-fg">Part to keep</legend>
      <TrimFields trim={trim} playerRef={playerRef} disabled={disabled} duration={duration} />
    </fieldset>
  );
}

/** Wraps a setter so changing an option clears the last result. */
function useReset(clear: () => void) {
  return <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      clear();
    };
}

// ---------------------------------------------------------------- Convert Video

export function ConvertVideoPanel({ file }: ToolPanelProps) {
  const job = useMediaJob(file);
  const playerRef = useRef<Player | null>(null);
  const change = useReset(job.clearOutput);
  const [target, setTarget] = useState<VideoTarget>("mp4");
  const [quality, setQuality] = useState<Quality>("balanced");
  const [resolution, setResolution] = useState("keep");
  const [fps, setFps] = useState("keep");
  const [mute, setMute] = useState(false);
  const trim = useTrimField(job.clearOutput);
  const label = VIDEO_TARGETS[target].container.label;

  const convert = () =>
    job.run(
      (info, input) => convertVideoJob(info, input, { target, quality, maxShort: maxShortOf(resolution), fps: fps === "keep" ? null : Number(fps), mute, trim: trim.value }),
      (j) => outputName(file, j, "converted"),
      (info) => (info.video?.hdr ? "HDR converted to standard colour" : undefined),
    );

  return (
    <MediaLayout file={file} job={job} playerRef={playerRef}>
      <ToolCard icon={Film} title="Convert video">
        <Segmented label="Format" hint={VIDEO_TARGETS[target].note} value={target} onChange={change(setTarget)} disabled={job.busy} options={(Object.keys(VIDEO_TARGETS) as VideoTarget[]).map((id) => ({ id, label: VIDEO_TARGETS[id].container.label }))} />
        <Segmented
          label="Quality"
          value={quality}
          onChange={change(setQuality)}
          disabled={job.busy}
          options={[
            { id: "high", label: "High" },
            { id: "balanced", label: "Balanced" },
            { id: "small", label: "Small file" },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Resolution">
            <select value={resolution} disabled={job.busy} onChange={(e) => change(setResolution)(e.target.value)} className={INPUT}>
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Frame rate">
            <select value={fps} disabled={job.busy} onChange={(e) => change(setFps)(e.target.value)} className={INPUT}>
              <option value="keep">Keep</option>
              {[60, 30, 24, 15].map((r) => (
                <option key={r} value={r}>
                  {r} fps
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="mt-1.5 text-xs text-fg-subtle">Videos are never enlarged or sped up.</p>
        <Checkbox checked={mute} onChange={change(setMute)} disabled={job.busy} label="Remove the sound" />
        <PartToKeep trim={trim} playerRef={playerRef} disabled={job.busy} duration={job.info?.duration ?? null} />
        <EngineNote>Location, phone model and dates aren&apos;t copied. HDR phone videos are converted to standard colour.</EngineNote>
        <div className="mt-5">
          <RunButton job={job} label={`Convert to ${label}`} icon={Film} disabled={!!trim.error} className={clsx(PRIMARY, "w-full")} onClick={convert} />
        </div>
      </ToolCard>
      {job.output && <OutputCard title="Video converted" outputs={[job.output]} replaceFileId={sameFormat(file, job.output) ? file.id : undefined} />}
    </MediaLayout>
  );
}

// ---------------------------------------------------------------- Compress Video

const STRENGTHS = { light: 24, medium: 28, strong: 32 } as const;
type Strength = keyof typeof STRENGTHS;
const SIZE_PRESETS = [8, 10, 25, 50];

export function CompressVideoPanel({ file }: ToolPanelProps) {
  const job = useMediaJob(file, "Compressing");
  const playerRef = useRef<Player | null>(null);
  const change = useReset(job.clearOutput);
  const [goal, setGoal] = useState<"quality" | "size">("quality");
  const [strength, setStrength] = useState<Strength>("medium");
  const [megabytes, setMegabytes] = useState("25");
  const [resolution, setResolution] = useState("keep");
  const [audio, setAudio] = useState("96");
  const trim = useTrimField(job.clearOutput);
  const mb = Number(megabytes.replace(",", "."));
  const sizeError = goal === "size" && !(mb > 0) ? "Type a size in MB." : undefined;

  const compress = () =>
    job.run(
      (info, input) =>
        compressVideoJob(info, input, {
          goal: goal === "quality" ? { mode: "quality", crf: STRENGTHS[strength] } : { mode: "size", bytes: mb * 1024 * 1024 },
          maxShort: maxShortOf(resolution),
          audioKbps: Number(audio),
          trim: trim.value,
        }),
      (j) => outputName(file, j, "compressed"),
      (_, blob) => {
        const change = 1 - blob.size / file.size;
        return change > 0 ? `${Math.round(change * 100)}% smaller` : "not smaller than the original";
      },
    );

  return (
    <MediaLayout file={file} job={job} playerRef={playerRef}>
      <ToolCard icon={Minimize2} title="Compress video">
        <p className="mt-2 text-sm text-fg-muted">Original: {formatBytes(file.size)}. The result is an MP4 (H.264) that plays everywhere.</p>
        <Segmented
          label="Aim for"
          value={goal}
          onChange={change(setGoal)}
          disabled={job.busy}
          options={[
            { id: "quality", label: "A quality" },
            { id: "size", label: "A file size" },
          ]}
        />
        {goal === "quality" ? (
          <Segmented
            label="Compression"
            hint={strength === "light" ? "Barely visible loss." : strength === "medium" ? "A good balance for sharing." : "Smallest; some blur in detailed scenes."}
            value={strength}
            onChange={change(setStrength)}
            disabled={job.busy}
            options={[
              { id: "light", label: "Light" },
              { id: "medium", label: "Medium" },
              { id: "strong", label: "Strong" },
            ]}
          />
        ) : (
          <>
            <Field label="Target size (MB)" error={sizeError} hint="The result lands at or a little under this.">
              <input value={megabytes} disabled={job.busy} inputMode="decimal" onChange={(e) => change(setMegabytes)(e.target.value.replace(/[^\d.,]/g, ""))} className={INPUT} />
            </Field>
            <div className="mt-2 flex flex-wrap gap-2">
              {SIZE_PRESETS.map((size) => (
                <button key={size} type="button" disabled={job.busy} onClick={() => change(setMegabytes)(String(size))} className={clsx("rounded-md border px-2 py-1 text-xs", mb === size ? "border-brand-border bg-brand-soft text-fg" : "border-line text-fg-muted hover:text-fg")}>
                  {size} MB
                </button>
              ))}
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Resolution">
            <select value={resolution} disabled={job.busy} onChange={(e) => change(setResolution)(e.target.value)} className={INPUT}>
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sound">
            <select value={audio} disabled={job.busy} onChange={(e) => change(setAudio)(e.target.value)} className={INPUT}>
              {[128, 96, 64].map((k) => (
                <option key={k} value={k}>
                  {k} kbps
                </option>
              ))}
              <option value="0">Remove</option>
            </select>
          </Field>
        </div>
        {goal === "size" && <p className="mt-1.5 text-xs text-fg-subtle">For a small target, a lower resolution looks better than a blurry full-size video.</p>}
        <PartToKeep trim={trim} playerRef={playerRef} disabled={job.busy} duration={job.info?.duration ?? null} />
        <EngineNote>Location, phone model and dates aren&apos;t copied.</EngineNote>
        <div className="mt-5">
          <RunButton job={job} label="Compress video" icon={Minimize2} disabled={!!trim.error || !!sizeError} className={clsx(PRIMARY, "w-full")} onClick={compress} />
        </div>
      </ToolCard>
      {job.output && <OutputCard title={job.output.blob.size < file.size ? "Video compressed" : "Done, but it didn't get smaller"} outputs={[job.output]} replaceFileId={sameFormat(file, job.output) ? file.id : undefined} />}
    </MediaLayout>
  );
}

// ---------------------------------------------------------------- Convert Audio

export function ConvertAudioPanel({ file }: ToolPanelProps) {
  const job = useMediaJob(file);
  const playerRef = useRef<Player | null>(null);
  const change = useReset(job.clearOutput);
  const [target, setTarget] = useState<AudioTarget>("mp3");
  const [bitrates, setBitrates] = useState<Partial<Record<AudioTarget, number>>>({});
  const [channels, setChannels] = useState<"keep" | "2" | "1">("keep");
  const [normalize, setNormalize] = useState(false);
  const trim = useTrimField(job.clearOutput);
  const format = AUDIO_TARGETS[target];
  const bitrate = bitrates[target] ?? format.bitrate;

  const convert = () =>
    job.run(
      (info, input) => convertAudioJob(info, input, { target, bitrate, channels: channels === "keep" ? null : (Number(channels) as 1 | 2), normalize, trim: trim.value }),
      (j) => outputName(file, j, "converted"),
      () => (format.lossless ? "lossless" : `${bitrate} kbps`),
    );

  return (
    <MediaLayout file={file} job={job} playerRef={playerRef}>
      <ToolCard icon={AudioLines} title={file.kind === "video" ? "Save the sound" : "Convert audio"}>
        {file.kind === "video" && <p className="mt-2 text-sm text-fg-muted">The sound is taken from the video and saved on its own.</p>}
        <Segmented label="Format" value={target} onChange={change(setTarget)} disabled={job.busy} columns={3} options={(Object.keys(AUDIO_TARGETS) as AudioTarget[]).map((id) => ({ id, label: AUDIO_TARGETS[id].container.label }))} />
        {format.lossless ? (
          <p className="mt-2 text-xs text-fg-subtle">{target === "wav" ? "Uncompressed: the largest files, opened by everything." : "Lossless and about half the size of WAV."}</p>
        ) : (
          <Field label="Quality" hint="Higher is better and larger. 192 kbps is plenty for music, 64–96 for speech.">
            <select value={bitrate} disabled={job.busy} onChange={(e) => change((v: number) => setBitrates({ ...bitrates, [target]: v }))(Number(e.target.value))} className={INPUT}>
              {format.bitrates.map((k) => (
                <option key={k} value={k}>
                  {k} kbps
                </option>
              ))}
            </select>
          </Field>
        )}
        <Segmented
          label="Channels"
          value={channels}
          onChange={change(setChannels)}
          disabled={job.busy}
          options={[
            { id: "keep", label: "Keep" },
            { id: "2", label: "Stereo" },
            { id: "1", label: "Mono" },
          ]}
        />
        <Checkbox checked={normalize} onChange={change(setNormalize)} disabled={job.busy} label="Even out the loudness" hint="Makes quiet recordings louder and loud ones softer (to −16 LUFS, a common podcast level)." />
        <PartToKeep trim={trim} playerRef={playerRef} disabled={job.busy} duration={job.info?.duration ?? null} />
        <EngineNote>Titles, artist names, dates and cover art aren&apos;t copied.</EngineNote>
        <div className="mt-5">
          <RunButton job={job} label={`Convert to ${format.container.label}`} icon={AudioLines} disabled={!!trim.error} className={clsx(PRIMARY, "w-full")} onClick={convert} />
        </div>
      </ToolCard>
      {job.output && <OutputCard title="Audio ready" outputs={[job.output]} replaceFileId={file.kind === "audio" && sameFormat(file, job.output) ? file.id : undefined} />}
    </MediaLayout>
  );
}

// ---------------------------------------------------------------- Trim

export function TrimPanel({ file }: ToolPanelProps) {
  const job = useMediaJob(file, "Cutting");
  const playerRef = useRef<Player | null>(null);
  const change = useReset(job.clearOutput);
  const [exact, setExact] = useState(false);
  const trim = useTrimField(job.clearOutput);

  const cut = () =>
    job.run(
      (info, input) => trimJob(info, input, file.name, { start: trim.value!.start, end: trim.value!.end, exact }),
      (j) => outputName(file, j, "trimmed"),
    );

  return (
    <MediaLayout file={file} job={job} playerRef={playerRef}>
      <ToolCard icon={Clapperboard} title="Trim">
        <p className="mt-2 text-sm text-fg-muted">Play to the spot you want, then use the target buttons, or type the times.</p>
        <div className="mt-2">
          <TrimFields trim={trim} playerRef={playerRef} disabled={job.busy} duration={job.info?.duration ?? null} />
        </div>
        <Segmented
          label="Cut"
          hint={exact ? "Re-encodes the picture and sound to cut exactly where you asked. Slower, and very slightly lower quality." : "Instant and lossless. The start snaps to the nearest keyframe before it, so it can begin a moment early."}
          value={exact ? "exact" : "fast"}
          onChange={(v) => change(setExact)(v === "exact")}
          disabled={job.busy}
          options={[
            { id: "fast", label: "Fast" },
            { id: "exact", label: "Exact" },
          ]}
        />
        <EngineNote>The file keeps its format. Location, phone model and dates aren&apos;t copied.</EngineNote>
        <div className="mt-5">
          <RunButton job={job} label={trim.value ? `Keep ${trim.value.end !== null ? formatTime(trim.value.end - trim.value.start, 1) : "from " + formatTime(trim.value.start, 1)}` : "Choose a start or end"} icon={Clapperboard} disabled={!trim.value} className={clsx(PRIMARY, "w-full")} onClick={cut} />
        </div>
      </ToolCard>
      {job.output && <OutputCard title="Trimmed" outputs={[job.output]} replaceFileId={sameFormat(file, job.output) ? file.id : undefined} />}
    </MediaLayout>
  );
}

// ---------------------------------------------------------------- Video to GIF

export function GifPanel({ file }: ToolPanelProps) {
  const job = useMediaJob(file, "Making the animation");
  const playerRef = useRef<Player | null>(null);
  const change = useReset(job.clearOutput);
  const [target, setTarget] = useState<AnimationTarget>("gif");
  const [width, setWidth] = useState("480");
  const [fps, setFps] = useState(12);
  const [loop, setLoop] = useState(true);
  const trim = useTrimField(job.clearOutput);
  const duration = job.info?.duration ?? null;
  const length = trim.value ? (trim.value.end ?? duration ?? 0) - trim.value.start : duration;
  const label = ANIMATION_TARGETS[target].label;

  const make = () =>
    job.run(
      (info, input) => animationJob(info, input, { target, fps, width: width === "keep" ? null : Number(width), loop, trim: trim.value }),
      (j) => outputName(file, j, "animated"),
    );

  return (
    <MediaLayout file={file} job={job} playerRef={playerRef}>
      <ToolCard icon={ImagePlay} title="Make an animation">
        <Segmented
          label="Format"
          hint={target === "gif" ? "Plays everywhere, but files get big quickly." : "Several times smaller than GIF, with full colour. Most apps and browsers show it."}
          value={target}
          onChange={change(setTarget)}
          disabled={job.busy}
          options={[
            { id: "gif", label: "GIF" },
            { id: "webp", label: "Animated WebP" },
          ]}
        />
        <Field label="Width">
          <select value={width} disabled={job.busy} onChange={(e) => change(setWidth)(e.target.value)} className={INPUT}>
            {["720", "640", "480", "320", "240"].map((w) => (
              <option key={w} value={w}>
                {w} px
              </option>
            ))}
            <option value="keep">Keep the size</option>
          </select>
        </Field>
        <Slider label="Frames per second" value={fps} min={5} max={30} step={1} format={(v) => `${v}`} onChange={change(setFps)} />
        <Checkbox checked={loop} onChange={change(setLoop)} disabled={job.busy} label="Loop forever" />
        <PartToKeep trim={trim} playerRef={playerRef} disabled={job.busy} duration={duration} />
        {length !== null && length > 15 && <p className="mt-2 text-xs text-warning-text">That&apos;s {formatTime(length)} long. Animations work best at a few seconds: choose a shorter part to keep the file small.</p>}
        <EngineNote />
        <div className="mt-5">
          <RunButton job={job} label={`Make ${label === "GIF" ? "a GIF" : "an animated WebP"}`} icon={ImagePlay} disabled={!!trim.error} className={clsx(PRIMARY, "w-full")} onClick={make} />
        </div>
      </ToolCard>
      {job.output && <OutputCard title={`${label} ready`} outputs={[job.output]} />}
    </MediaLayout>
  );
}
