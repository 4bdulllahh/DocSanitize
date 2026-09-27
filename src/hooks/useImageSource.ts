"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";
import { displayableImage } from "@/lib/image/convert";

/**
 * Show an image file in an <img>: the file itself, or a decoded copy for HEIC (which most browsers
 * can't display). The object URL is set on the element directly and revoked in the same effect,
 * so it's safe under StrictMode's double invocation. `onError` runs if the image can't be decoded.
 */
export function useImageSource(ref: RefObject<HTMLImageElement | null>, file: Blob, onError?: () => void) {
  const fail = useEffectEvent(() => onError?.());
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    displayableImage(file)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        if (ref.current) ref.current.src = url;
      })
      .catch(() => !cancelled && fail());
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, ref]);
}
