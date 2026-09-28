/*
 * Languages the browser's built-in translator (Chrome's on-device Translator API) handles. Pairs
 * are still checked with Translator.availability() before use.
 */

export interface TranslateLanguage {
  /** BCP 47 code, as the Translator API takes it. */
  code: string;
  name: string;
  /**
   * The built-in PDF font (Liberation Sans: Latin, Greek, Cyrillic) can write it, so a
   * translated PDF is possible. Other languages get the translated text as a .txt file.
   */
  pdf: boolean;
}

export const TRANSLATE_LANGUAGES: TranslateLanguage[] = [
  { code: "ar", name: "Arabic", pdf: false },
  { code: "bn", name: "Bengali", pdf: false },
  { code: "bg", name: "Bulgarian", pdf: true },
  { code: "zh", name: "Chinese (Simplified)", pdf: false },
  { code: "zh-Hant", name: "Chinese (Traditional)", pdf: false },
  { code: "hr", name: "Croatian", pdf: true },
  { code: "cs", name: "Czech", pdf: true },
  { code: "da", name: "Danish", pdf: true },
  { code: "nl", name: "Dutch", pdf: true },
  { code: "en", name: "English", pdf: true },
  { code: "fi", name: "Finnish", pdf: true },
  { code: "fr", name: "French", pdf: true },
  { code: "de", name: "German", pdf: true },
  { code: "el", name: "Greek", pdf: true },
  { code: "he", name: "Hebrew", pdf: false },
  { code: "hi", name: "Hindi", pdf: false },
  { code: "hu", name: "Hungarian", pdf: true },
  { code: "id", name: "Indonesian", pdf: true },
  { code: "it", name: "Italian", pdf: true },
  { code: "ja", name: "Japanese", pdf: false },
  { code: "kn", name: "Kannada", pdf: false },
  { code: "ko", name: "Korean", pdf: false },
  { code: "lt", name: "Lithuanian", pdf: true },
  { code: "mr", name: "Marathi", pdf: false },
  { code: "no", name: "Norwegian", pdf: true },
  { code: "pl", name: "Polish", pdf: true },
  { code: "pt", name: "Portuguese", pdf: true },
  { code: "ro", name: "Romanian", pdf: true },
  { code: "ru", name: "Russian", pdf: true },
  { code: "sk", name: "Slovak", pdf: true },
  { code: "sl", name: "Slovenian", pdf: true },
  { code: "es", name: "Spanish", pdf: true },
  { code: "sv", name: "Swedish", pdf: true },
  { code: "ta", name: "Tamil", pdf: false },
  { code: "te", name: "Telugu", pdf: false },
  { code: "th", name: "Thai", pdf: false },
  { code: "tr", name: "Turkish", pdf: true },
  { code: "uk", name: "Ukrainian", pdf: true },
  { code: "vi", name: "Vietnamese", pdf: false },
];

/** Our entry for a detected or browser language code such as "de-AT", "iw" or "zh-TW". */
export function translateLanguage(code: string | undefined): TranslateLanguage | undefined {
  if (!code) return undefined;
  const lower = code.toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(lower)) return TRANSLATE_LANGUAGES.find((l) => l.code === "zh-Hant");
  const base = { iw: "he", nb: "no", nn: "no" }[lower.split("-")[0]] ?? lower.split("-")[0];
  return TRANSLATE_LANGUAGES.find((l) => l.code === base);
}
