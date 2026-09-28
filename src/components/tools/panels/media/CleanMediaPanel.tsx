"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { CircleCheck, MapPinOff, ScanSearch, TriangleAlert } from "lucide-react";
import { probeMedia } from "@/lib/media/engine";
import { cleanJob, extensionOf } from "@/lib/media/jobs";
import { DETAIL_GROUPS, type DetailGroup, type MediaDetail } from "@/lib/media/probe";
import type { ToolPanelProps } from "../registry";
import { OutputCard, PRIMARY } from "../shared/OutputCard";
import { Layout, ToolCard } from "../shared/toolkit";
import { EngineNote, outputName, ResultCard, RunButton, SourceCard, useMediaJob } from "./MediaParts";
import { useT } from "@/store/locale";
import { msg } from "@/i18n/msg";


function DetailList({ details }: { details: MediaDetail[] }) {
  const t = useT();
  const groups = (Object.keys(DETAIL_GROUPS) as DetailGroup[]).filter((g) => details.some((d) => d.group === g));
  return (
    <div className="divide-y divide-line">
      {groups.map((group) => (
        <section key={group} className="py-3 first:pt-0 last:pb-0">
          <h3 className={clsx("text-xs font-semibold tracking-wider uppercase", group === "location" ? "text-danger-text" : "text-fg-subtle")}>{t(DETAIL_GROUPS[group])}</h3>
          <dl className="mt-1.5 space-y-1.5">
            {details
              .filter((d) => d.group === group)
              .map((d, i) => (
                <div key={`${d.label}-${d.where}-${i}`} className="grid gap-x-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-fg-muted">
                    {t.dynamic(d.label)}
                    {d.where !== "file" && <span className="text-xs text-fg-subtle"> · {d.where}</span>}
                  </dt>
                  <dd className="font-medium wrap-anywhere text-fg">{d.value}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Lists the descriptive details in a video or recording and copies it without them. */
export default function CleanMediaPanel({ file }: ToolPanelProps) {
  const t = useT();
  const job = useMediaJob(file, msg("Removing the details"));
  const [keepCover, setKeepCover] = useState(true);
  // What's left in the new file, read back from it.
  const [check, setCheck] = useState<{ blob: Blob; left: MediaDetail[] | null } | null>(null);
  const info = job.info;
  const output = job.output;

  useEffect(() => {
    if (!output) return;
    let active = true;
    probeMedia(new File([output.blob], output.name, { type: output.blob.type }))
      .then((result) => active && setCheck({ blob: output.blob, left: result.details }))
      .catch(() => active && setCheck({ blob: output.blob, left: null }));
    return () => {
      active = false;
    };
  }, [output]);
  const verified = output && check?.blob === output.blob ? check.left : undefined;

  const clean = () =>
    job.run(
      (facts, input) => cleanJob(facts, input, file.name, { keepCover }),
      (j) => outputName(file, j, "clean"),
      () => t("same picture and sound"),
    );

  const found = info?.details ?? [];
  return (
    <Layout
      main={
        <>
          <SourceCard file={file} info={info} />
          {info && (
            <section className="mt-4 rounded-xl border border-line bg-surface p-5" aria-label={t("Details found")}>
              <h2 className="flex items-center gap-2 font-semibold text-fg">
                {found.length ? <TriangleAlert className="size-4 text-warning" aria-hidden="true" /> : <CircleCheck className="size-4 text-success" aria-hidden="true" />}
                {found.length ? t.plural(found.length, "{n} detail found", "{n} details found") : t("No revealing details found")}
              </h2>
              {found.length > 0 ? (
                <div className="mt-4">
                  <DetailList details={found} />
                </div>
              ) : (
                <p className="mt-1 text-sm text-fg-muted">{t("This file carries no location, device, date or name details.")}</p>
              )}
            </section>
          )}
          {output && <ResultCard output={output} />}
        </>
      }
      actions={
        <>
          <ToolCard icon={MapPinOff} title={t("Remove metadata")}>
            <p className="mt-2 text-sm text-fg-muted">
              {t("Phones and apps store where and when a video was recorded, the device model and software, and names and comments. This copies the picture and sound untouched into a new file without them.")}
            </p>
            {info?.cover && (
              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={keepCover} disabled={job.busy} onChange={(e) => {
                    setKeepCover(e.target.checked);
                    job.clearOutput();
                  }} className="mt-0.5 size-4 shrink-0 accent-brand" />
                <span>
                  <span className="block text-sm font-medium text-fg">{t("Keep the cover picture")}</span>
                  <span className="block text-xs text-fg-muted">{t("The album art or thumbnail stays; its description doesn't.")}</span>
                </span>
              </label>
            )}
            <EngineNote>{t("Nothing is re-encoded, so it's quick and the quality doesn't change. Chapters and timed metadata tracks are removed too.")}</EngineNote>
            <div className="mt-5">
              {info ? (
                <RunButton job={job} label={found.length ? t.plural(found.length, "Remove {n} detail", "Remove {n} details") : t("Save a clean copy anyway")} icon={MapPinOff} className={clsx(PRIMARY, "w-full")} onClick={clean} />
              ) : (
                <RunButton job={job} label={t("Check this file")} icon={ScanSearch} className={clsx(PRIMARY, "w-full")} onClick={job.inspect} />
              )}
            </div>
          </ToolCard>
          {output && (
            <>
              <OutputCard title={t("Details removed")} outputs={[output]} replaceFileId={extensionOf(output.name) === extensionOf(file.name) ? file.id : undefined} />
              <p className={clsx("flex items-start gap-2 rounded-lg p-3 text-sm", verified?.length ? "bg-warning-soft text-fg" : "bg-surface-muted text-fg-muted")} role="status">
                {verified === undefined
                  ? t("Checking the new file…")
                  : verified === null
                    ? t("The new file couldn't be read back to check it.")
                    : verified.length === 0
                      ? t("Checked the new file: none of these details are left.")
                      : t.plural(verified.length, "Checked the new file: {n} detail couldn't be removed ({details}).", "Checked the new file: {n} details couldn't be removed ({details}).", { details: t.list(verified.map((d) => t.dynamic(d.label))) })}
              </p>
            </>
          )}
        </>
      }
    />
  );
}
