"use client";

import { useEffect, useRef, useState } from "react";
import { KindIcon } from "@/components/files/KindIcon";
import type { WorkspaceFile } from "@/store/workspace";

export function FilePreview({ file }: { file: WorkspaceFile }) {
  return (
    <div className="flex min-h-72 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
        Preview
      </div>
      {file.kind === "image" ? (
        <ImagePreview file={file.file} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <KindIcon kind={file.kind} className="size-12 text-fg-subtle" strokeWidth={1.25} />
          <p className="text-sm text-fg-muted">Page previews are coming soon.</p>
        </div>
      )}
    </div>
  );
}

function ImagePreview({ file }: { file: File }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // The object URL is set on the element directly (not via state) so it is created and revoked
  // in the same effect — safe under StrictMode's double-invocation.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (imgRef.current) imgRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center bg-surface-muted p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, nothing to optimize */}
        <img
          ref={imgRef}
          alt={`Preview of ${file.name}`}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="max-h-[28rem] max-w-full rounded object-contain shadow-elev-1"
        />
      </div>
      {size && (
        <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">
          {size.w} × {size.h} px
        </p>
      )}
    </div>
  );
}
