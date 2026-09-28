/*
 * Interface languages. English is written in the code itself; every other language is a catalog
 * (src/i18n/catalogs/<code>/) keyed by the English text, loaded only when that language is chosen.
 */

export const LOCALES = [
  { code: "en", name: "English", dir: "ltr", tag: "en" },
  { code: "ar", name: "العربية", dir: "rtl", tag: "ar-u-nu-latn" },
  { code: "de", name: "Deutsch", dir: "ltr", tag: "de" },
  { code: "es", name: "Español", dir: "ltr", tag: "es" },
  { code: "fr", name: "Français", dir: "ltr", tag: "fr" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_CODES = LOCALES.map((l) => l.code) as Locale[];

export const LOCALE_STORAGE_KEY = "docsanitize:language";

export const localeInfo = (code: Locale) => LOCALES.find((l) => l.code === code)!;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as string[]).includes(value);
}

/** The first supported language among the browser's preferred ones ("de-AT" → "de"). */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const lang of preferred) {
    const base = lang.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * Inlined in <head>: sets <html lang dir> before first paint, from the saved choice or the
 * browser's languages (mirrors pickLocale). For a language other than English the page stays
 * hidden until its catalog has loaded (or a short timeout), so English doesn't flash first. The
 * Content-Security-Policy allows it by its sha256 hash (scripts/secure-export.mjs).
 */
export const LOCALE_INIT_SCRIPT = `(function(){var d=document.documentElement,c=${JSON.stringify(LOCALE_CODES)},l='en';try{var s=localStorage.getItem('${LOCALE_STORAGE_KEY}');var p=c.indexOf(s)>=0?[s]:(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en']);for(var i=0;i<p.length;i++){var b=String(p[i]).toLowerCase().split('-')[0];if(c.indexOf(b)>=0){l=b;break}}}catch(e){}d.lang=l;d.dir=l==='ar'?'rtl':'ltr';if(l!=='en'){d.setAttribute('data-locale-pending','');setTimeout(function(){d.removeAttribute('data-locale-pending')},2500)}})()`;
