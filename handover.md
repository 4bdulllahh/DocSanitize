# DocSanitize: maintainer guide (compact)

_Updated 2026-09-28 · v1.0.0 + M10–M15 · live at https://docsanitize.vercel.app (Vercel deploys `main`) · 46 tools · README has the full feature list._

## Resume here (session paused 2026-09-28)
- **M15 is finished but NOT committed** (the owner will say when to commit). Last commit: `5dd6c70` (M14). Verified: 222 unit tests, tsc, lint, all 14 e2e suites pass, light/dark/390 px screenshots checked.
- On "commit": `git add -A`, commit "Milestone 15: PowerPoint, text and image conversions, Compare PDFs" (end with the `Co-Authored-By` line), push to `origin/main`, then start M16.
- New deps in M15: `marked` (dependency) and `happy-dom` (dev dependency). The generated `.pptx` hasn't been opened in PowerPoint/Keynote by hand yet; the owner may want to try one.

## Working with the owner
- Build in milestones; stop after each and ask to continue. On approval, commit the finished milestone and push to `origin/main` (commit messages end with a `Co-Authored-By` line). Keep README and this file current, and keep this file short.
- **Next: M16** local media converter (ffmpeg.wasm; no link downloader) · M17 certificate signatures (.p12) + verify · M18 batch processing · M19 UI languages incl. RTL · then README/screenshots, v2.0.

## Rules the code must keep (tests enforce most)
| Rule | How |
| --- | --- |
| No file leaves the device; only same-origin requests | No CDNs/analytics; CSP `connect-src 'self'` (vercel.json); every e2e asserts localhost-only |
| Never add metadata | `loadPdf()`/`createPdf()`/`savePdf()` in `lib/pdf/load.ts`; hand-written docx/xlsx; JPEGs via `stripJpeg`; annotations get no `/T`, `/M`, `/CreationDate` |
| Removed means gone | `collectGarbage(doc)` after deleting; `pruneStrayPages(doc)` after `copyPages` (links copy their target pages); Edit text removes content-stream operators, not just covers |
| Nothing stored | Files/results in memory (Zustand); the SW caches app files only; localStorage holds the theme only |

## Decisions (don't re-ask)
Next.js 16 static export (`output: "export"`, trailing slashes) on Vercel (`framework: null`, `outputDirectory: out`) · PDF writing `@cantoo/pdf-lib` + `@cantoo/fontkit` · rendering `pdfjs-dist` 6 · AES-256 protect · redaction rasterises pages · SheetJS 0.20.3 from the cdn.sheetjs.com tarball · fonts: Liberation Sans (from pdf.js standard_fonts), Times/Courier standard fonts · theme: warm cream / charcoal, navy `#263a81` · MIT, "Abdullah" · HEIC via libheif-js **add-on**, AVIF via the browser · big optional parts are add-ons (first use, then cached), never precached · OCR: tesseract.js 7 add-on, 24 `best_int` languages (list in `lib/ocr/languages.json`), invisible text in a hand-built glyphless Type0 font · Translate: browser Translator API only (no online service); PDF output only for Latin/Greek/Cyrillic targets, others .txt · "keep technical data" = EXIF tag allow-list · Edit PDF: flattened or editable annotations; replaced text/white-out always in the page; notes always comments · Crop sets the CropBox only · Grayscale rewrites operators/images, `/Saturation` blend layer only where it can't · Inspect tools judge offline only (no URL lookups); Check Links flags, never visits · fake redaction/hidden text found by rendering + per-character pixel check · PPTX→PDF: own reader (placeholder/theme inheritance) + flow engine; PDF→PPTX: text boxes over a picture of the page with those runs removed (`strip-text.ts`); HTML/MD parsed on the page by the inert DOMParser (marked for MD), only data: pictures used · Compare: patience + Myers word diff, annotations via Edit PDF; Compare sits in Inspect.

## Commands
`npm run dev` · `npm run build` (prebuild copies pdf.js assets + add-ons; postbuild: export fix, CSP meta, `out/sw.js`) · `npm run lint` · `npm test` (222 Vitest tests, Node; HTML tests use happy-dom) · `npx tsc --noEmit` (after a build) · `npm run e2e [-- name]` (14 suites against `./out` with the vercel.json headers; needs `npx playwright-core install chromium` once) · `node scripts/screenshots.mjs` · `node scripts/make-icons.mjs`. Node 24 (≥22.18). Windows 11 dev, Ubuntu CI.

## Code map
- `src/lib/tools.ts` ★ tool list (id, name, description, category, icon, **keywords** for search, accepts, multiFile) + `searchTools()`. A page is generated per tool.
- `src/components/tools/panels/registry.tsx` ★ tool id → panel (`next/dynamic`, `ssr: false`). Panels get `{ tool, file, files }`.
- `panels/shared/toolkit.tsx` DocGate, Layout, ToolCard, useApply, usePageField, useLoaded, PageGrid, SelectionSummary · `shared/controls.tsx` Field, Segmented, Slider, ColorField, AnchorPicker · `OutputCard`, `StampPreview` (live preview by the real code), `ConversionParts`.
- Heavy work: panel → `lib/<area>/client.ts` → worker (`src/workers/*.worker.ts`, typed RPC in `lib/worker-rpc.ts`) → pure function in `lib/<area>/` (unit-tested in Node). Args/results **transfer** their buffers: pass copies.
- `lib/metadata/` audit/strip per format (jpeg, png, webp, heif, pdf), `exif.ts` (incl. `technicalOnlyExif`), `classify.ts`.
- `lib/pdf/`: `load.ts` ★, `assemble.ts` (merge/extract/rearrange/pruneStrayPages), `pages.ts`, `forms.ts`, `flatten.ts`, `info.ts` (properties + bookmarks), `grayscale.ts`, `markup.ts` (watermark, numbers, header/footer, Bates, signatures), `stamp.ts` ★ (displayed ↔ user-space geometry), `redact*.ts`, `security.ts`, `render.ts` (pdf.js), `edit/` ★ (Edit PDF: types, geometry, content-stream parser/text remover, fonts, apply, text-select).
- `lib/ocr/` engine.ts (tesseract client: render at 300 dpi, progress, cancel), result.ts, languages · `lib/pdf/ocr-layer.ts` + `glyphless-font.ts` · `lib/translate/` blocks (group lines), layout (fit), browser (Translator API) · `lib/pdf/translate.ts` → Edit PDF's `applyEdits` · `lib/pdf/edit/page-text.ts` (readPhrases, sampleColors; shared by Edit and Translate).
- `lib/scan/` (Inspect tools, `scan.worker.ts`): pii + pii-pdf, pdf-inspect (report + clean), pdf-visibility (render check), office-inspect + xml-tree (lossless OOXML edits; `removeParts` fixes rels + content types), filetype, hash (own MD5), links (URL/QR rules, punycode) + links-browser (jsQR), image-forensics + ela. `store/handoff.ts` passes boxes to Redact. FileKinds include `powerpoint` and `text` (.txt/.md/.html); tools accepting `unknown` take any file.
- `lib/convert/` (M15, client.ts on the page, rest in `office.worker`): pptx-model + pptx-to-pdf, pptx-write, html-blocks + text-document + text-to-pdf, pdf-to-text, compare + visual-diff. `flow.ts` now exports tokenize/wrap/drawLine/embedFonts and has mono (Courier), colour, quote, shade and rule. `lib/image/formats.ts` BMP/TIFF/ICO encoders + resize.
- `lib/image/` canvas decode/encode, `heic.ts` (add-on client), `convert.ts`, `prepare.ts` · `lib/office/` PDF↔Word/Excel.
- Edit PDF UI: `panels/edit/` (EditPanel, EditorCanvas, Toolbar, Inspector, ObjectLayer, useEditorState, usePageText).
- `scripts/`: copy-pdfjs-assets, copy-addons (+ `addons/heif.worker.js`), secure-export (CSP), build-service-worker (+ template), fix-export-segments (Windows export bug).
- `e2e/`: run.mjs + suites: workspace, sanitize, organize, convert, office, security, markup, offline, images, edit, pages, ocr (OCR + Translate, with a stand-in Translator), inspect (QR fixtures from the `qrcode` dev dependency), conversions (M15).

## Add a tool
Pure logic + Vitest test → worker method + client function → `TOOLS` entry (with keywords; add a `tools.test.ts` expectation) → panel using the toolkit + `registry.tsx` → e2e that **checks the downloaded bytes**, no console errors, localhost only → check light/dark/390 px screenshots → README feature list.

## Add-ons (big optional parts)
Copy the files in `scripts/copy-addons.mjs` to `public/addons/<name>-<version>/` (with the licence). The SW caches `/addons/*` on first request in `docsanitize-addons` (survives updates, pruned when a build drops a file); they're left out of the precache. Load by URL from a small client (like `lib/image/heic.ts`) with a clear "go online once" error. Extend `e2e/offline.mjs`.

## Traps already found
- **Next/Turbopack:** workers via `new Worker(new URL(...), { type: "module" })`; the SW must answer worker scripts and `?query` requests with a rebuilt `Response`; Next sends HEAD before prefetching; run `tsc` after `build`; edit only `vercel.json` for headers/CSP.
- **pdf.js 6:** pass one shared `PDFWorker.create({ port })` as `getDocument({ worker })` (a workerPort-owned worker is torn down when any doc closes → "worker is being destroyed"); `destroy()` is on the loading task; `render({ canvas, viewport })`; text content skips annotations and off-page text; `getFieldObjects()` can be null (count widget `fieldName`s).
- **@cantoo/pdf-lib:** encrypt() only encrypts streams (always save with object streams); save adds a default page unless told not to; `normalize()` wraps content in q/Q; keep `/Contents` an array after replacing it; `addToPage` pads widget rects by half the border; radio on-states may be "0"/"1" (names in `/Opt`); flatten without appearances throws; use `@cantoo/fontkit`; standard font metrics at `@cantoo/pdf-lib/standard-fonts`.
- **HEIF:** strip in place (zero the items + retype to `skip`), never move bytes (absolute offsets). Canvas only writes 3-channel JPEGs.
- **React:** never read an event inside a state updater (the E-Sign crash); no sync setState in effects (lint); the canvas pointer-down must `preventDefault()` or a newly opened text box loses focus; don't mutate variables during render (React compiler lint).
- **tesseract.js:** `workerBlobURL: false` (CSP), `cacheMethod: "none"` (SW caches), always pass `errorHandler` (a failed model download otherwise never settles `createWorker`), ignore logger progress after a failure. Worker requests can't be faked with Playwright routes (they never settle): hide the file in `out/` instead.
- **Translator API:** create it straight from the click (language-pack download needs user activation); the Playwright Chromium has the API, so tests hide or replace `globalThis.Translator`. pdf.js splits RTL lines into words, listed left to right.
- **e2e:** scope input locators to `main` (the header search dialog has an input); Edit PDF's sticky toolbar covers the page top (scroll targets mid-screen); rotated pages display landscape; `sizedJpeg()` fixtures aren't decodable (encode with canvas); `convert.mjs`/`edit.mjs` each timed out once in a full run and passed on rerun.
- **Canvas:** `OffscreenCanvas.convertToBlob` throws without a context (call `getContext` first); Playwright's Chromium writes WebP but not AVIF.
- **Windows/tooling:** tool-call text with `\uXXXX`/`\0` escapes gets decoded (build strings in code, grep for control chars); long heredocs with quotes + `${}` fail (write a script file); Python on Windows needs `newline=''`; HEIC fixtures need pillow-heif + Pillow 11.3 (12 breaks the owner's Streamlit).

## Known limitations
OCR doesn't deskew/rotate pages · Translate needs Chrome/Edge desktop; non-Latin/Greek/Cyrillic targets are text-only · redacted pages become images · signatures are visual (M17) · office and PowerPoint conversions best effort (no charts/SmartArt/EMF), Latin/Greek/Cyrillic only; HTML/MD ignore CSS and web pictures · Edit PDF's new text uses standard fonts, horizontal text only; text inside form XObjects is covered, not removed (warned) · crop/white-out hide, not remove · grayscale fallback keeps the colour data · dynamic XFA unsupported · Merge/Split drop links between pages · HEIC preview needs a 1.5 MB one-time download.
