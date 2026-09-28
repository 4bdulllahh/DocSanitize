import { create } from "zustand";
import { DEFAULT_LOCALE, isLocale, localeInfo, LOCALE_STORAGE_KEY, type Locale } from "@/i18n/locales";
import { createTranslator, type Catalog, type Translator } from "@/i18n/translate";

/*
 * The interface language. Its catalog is loaded on first use (a separate chunk per language, kept
 * by the service worker for offline use). The choice is remembered in localStorage, like the theme.
 */

const CATALOGS: Record<Exclude<Locale, "en">, () => Promise<{ default: Catalog }>> = {
  ar: () => import("@/i18n/catalogs/ar"),
  de: () => import("@/i18n/catalogs/de"),
  es: () => import("@/i18n/catalogs/es"),
  fr: () => import("@/i18n/catalogs/fr"),
};

interface LocaleState {
  t: Translator;
  /** Switch language; `remember` saves it as the person's choice. */
  setLocale: (locale: Locale, remember?: boolean) => Promise<void>;
}

const english = createTranslator(DEFAULT_LOCALE);
let requested: Locale = DEFAULT_LOCALE;

function applyToDocument(locale: Locale) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = localeInfo(locale).dir;
  root.removeAttribute("data-locale-pending");
}

export const useLocaleStore = create<LocaleState>()((set) => ({
  t: english,
  setLocale: async (locale, remember = false) => {
    requested = locale;
    if (remember) {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        // Storage can be unavailable (private mode); the language still applies for this visit.
      }
    }
    let t = english;
    if (locale !== "en") {
      try {
        t = createTranslator(locale, (await CATALOGS[locale]()).default);
      } catch {
        // The catalog couldn't be loaded (offline before it was ever cached): stay in English.
        locale = "en";
      }
    }
    // A later choice wins over one still loading.
    if (requested !== locale && locale !== "en") return;
    applyToDocument(locale);
    set({ t });
  },
}));

/** Start in the language LOCALE_INIT_SCRIPT picked for <html lang>. */
export function syncLocaleFromDocument() {
  const lang = document.documentElement.lang;
  if (isLocale(lang) && lang !== "en") void useLocaleStore.getState().setLocale(lang);
  else document.documentElement.removeAttribute("data-locale-pending");
}

/** The translator for the interface language (components re-render when it changes). */
export const useT = () => useLocaleStore((s) => s.t);
