import { ProcessingError } from "../errors";

/*
 * The browser's built-in, on-device translator (the Translator and LanguageDetector APIs, in
 * Chrome and Edge on desktop). The browser downloads a language pack once and translates locally;
 * DocSanitize sends nothing anywhere. Browsers without the API get a clear message instead.
 */

export type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface Monitor {
  addEventListener(type: "downloadprogress", listener: (event: Event & { loaded: number }) => void): void;
}

interface CreateOptions {
  monitor?: (monitor: Monitor) => void;
  signal?: AbortSignal;
}

interface BrowserTranslator {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(options: { sourceLanguage: string; targetLanguage: string } & CreateOptions): Promise<BrowserTranslator>;
}

interface DetectorApi {
  availability(): Promise<Availability>;
  create(options?: CreateOptions): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>; destroy(): void }>;
}

const api = () => (globalThis as { Translator?: TranslatorApi }).Translator;
const detectorApi = () => (globalThis as { LanguageDetector?: DetectorApi }).LanguageDetector;

/** Whether this browser has the built-in translator. */
export const translatorSupported = () => typeof api()?.create === "function";

/** "available": ready; "downloadable"/"downloading": the browser fetches a language pack first. */
export async function pairAvailability(source: string, target: string): Promise<Availability> {
  try {
    return (await api()?.availability({ sourceLanguage: source, targetLanguage: target })) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * The document's language, if the browser's language detector is ready without a download.
 * Returns null when unsure or unavailable (the user picks the language then).
 */
export async function detectLanguage(sample: string): Promise<string | null> {
  const detector = detectorApi();
  if (!detector || sample.trim().length < 20) return null;
  try {
    if ((await detector.availability()) !== "available") return null;
    const instance = await detector.create();
    try {
      const [best] = await instance.detect(sample);
      return best && best.confidence >= 0.5 && best.detectedLanguage !== "und" ? best.detectedLanguage : null;
    } finally {
      instance.destroy();
    }
  } catch {
    return null;
  }
}

export interface Translator {
  translate(text: string): Promise<string>;
  destroy(): void;
}

/**
 * A translator for a language pair. Call it straight from a click: if the language pack needs
 * downloading, the browser only allows that in response to the user.
 */
export async function createTranslator(source: string, target: string, onDownload?: (fraction: number) => void, signal?: AbortSignal): Promise<Translator> {
  const translator = api();
  if (!translator) throw new ProcessingError("This browser has no built-in translator. Open DocSanitize in Chrome or Edge on a computer.", "unsupported");
  const pair = { sourceLanguage: source, targetLanguage: target };
  if ((await pairAvailability(source, target)) === "unavailable") throw new ProcessingError("Your browser's translator can't translate between these two languages.", "unsupported");
  let instance: BrowserTranslator;
  try {
    instance = await translator.create({
      ...pair,
      signal,
      monitor: (m) => m.addEventListener("downloadprogress", (e) => onDownload?.(e.loaded)),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new ProcessingError("The browser needs your go-ahead to download this language pack. Click Translate again.", "invalid");
    }
    throw new ProcessingError("The browser couldn't prepare its translator for these languages. Check you have enough disk space, then try again.", "unsupported");
  }
  return {
    translate: async (text) => {
      const parts = chunks(text);
      const out: string[] = [];
      for (const part of parts) out.push((await instance.translate(part, { signal })).trim());
      return out.join(" ");
    },
    destroy: () => instance.destroy(),
  };
}

/** Long paragraphs are translated a few sentences at a time (the translator has an input limit). */
export function chunks(text: string, max = 1000): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/gu) ?? [text];
  const parts: string[] = [];
  let part = "";
  for (const sentence of sentences) {
    if (part && part.length + sentence.length > max) {
      parts.push(part.trim());
      part = "";
    }
    part += sentence;
    while (part.length > max) {
      // A "sentence" longer than the limit: cut at a space.
      const cut = part.lastIndexOf(" ", max) > 0 ? part.lastIndexOf(" ", max) : max;
      parts.push(part.slice(0, cut).trim());
      part = part.slice(cut);
    }
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}
