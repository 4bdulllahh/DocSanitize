import data from "./languages.json";

/*
 * The OCR languages DocSanitize ships as add-ons: Tesseract's compact "best_int" models from the
 * @tesseract.js-data packages, which scripts/copy-addons.mjs copies to TESSDATA_DIR.
 */

export interface OcrLanguage {
  /** Tesseract's code, also the model's file name. */
  code: string;
  name: string;
  /** Download size in MB, shown before the first use. */
  mb: number;
  /** BCP 47 code, to preselect the language the browser uses. */
  bcp47: string;
}

export const OCR_LANGUAGES: OcrLanguage[] = data.languages;

/** Where the models are served from (the model version, not a package version, names the folder). */
export const TESSDATA_DIR = data.dir;

/** Size of the OCR engine itself (one build of the core, picked for the browser), in MB. */
export const OCR_ENGINE_MB = 3.8;

/** The language to preselect for a browser language such as "de-AT"; English otherwise. */
export function defaultOcrLanguage(browserLanguage: string | undefined): string {
  const lang = (browserLanguage ?? "").toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(lang)) return "chi_tra";
  const base = lang.split("-")[0];
  return OCR_LANGUAGES.find((l) => l.bcp47.split("-")[0] === base && l.code !== "chi_tra")?.code ?? "eng";
}
