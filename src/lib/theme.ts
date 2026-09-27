export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "docsanitize:theme";

/**
 * Inlined in <head> so the theme is applied before first paint (no light flash in dark mode).
 * Uses the saved choice if there is one, otherwise the OS preference. Mirrored by useTheme().
 * The Content-Security-Policy allows it by its sha256 hash (scripts/secure-export.mjs).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})()`;
