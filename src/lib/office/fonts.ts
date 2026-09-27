import type { FontFiles } from "./flow";

// Liberation Sans (SIL Open Font License) ships with pdfjs-dist; scripts/copy-pdfjs-assets.mjs
// copies it to public/pdfjs, so it's served from our own origin.
const FONT_DIR = "/pdfjs/standard_fonts/";

let loading: Promise<FontFiles> | null = null;

/** The fonts Word/Excel -> PDF embeds. Fetched once per worker, same origin only. */
export function loadFonts(): Promise<FontFiles> {
  loading ??= Promise.all(
    ["Regular", "Bold", "Italic", "BoldItalic"].map(async (style) => {
      const response = await fetch(`${FONT_DIR}LiberationSans-${style}.ttf`);
      if (!response.ok) throw new Error("The built-in fonts couldn't be loaded. Reload the page and try again.");
      return new Uint8Array(await response.arrayBuffer());
    }),
  ).then(([regular, bold, italic, boldItalic]) => ({ regular, bold, italic, boldItalic }));
  loading.catch(() => (loading = null));
  return loading;
}
