# DocSanitize: maintainer guide

_Last updated 2026-09-28 · version 1.0.0 plus milestones 10–11 of the v2 roadmap (M10–M19, see the README) · live at https://docsanitize.vercel.app_

This guide is for whoever changes DocSanitize next, whether a person or an AI assistant. The [README](README.md) says what the app does. This file explains how the code fits together, the rules it must keep, how to make common changes, and the traps already found. Read sections 1 to 3 before changing anything.

---

## 1. Start here

1. **This is Next.js 16.3.** Its APIs differ from older versions. [AGENTS.md](AGENTS.md) points to the bundled docs in `node_modules/next/dist/docs/`; check them before using a Next API you're unsure of.
2. **Check the baseline** before changing anything:
   ```bash
   npm install
   npx playwright-core install chromium        # once per machine, for the browser tests
   npm run lint && npm test                     # 133 unit tests
   npm run build && npx tsc --noEmit            # tsc needs the route types the build generates
   npm run e2e                                  # 10 browser suites against ./out
   ```
3. **Deploying is pushing.** Vercel builds `main` on every push, and GitHub Actions runs the same checks (`.github/workflows/ci.yml`). After a push, check the live site (section 7.8).
4. **Working with Claude:** the owner builds in milestones. At the end of each one, stop and ask whether to continue. When the next milestone is approved, commit the finished one and push it to `origin/main`. Don't commit at other times unless asked. Commit messages end with a `Co-Authored-By` line.

---

## 2. Rules the code must keep

These are the product's promises. Every change must keep them, and the tests enforce most of them.

| Rule | How it's kept |
| --- | --- |
| **No file ever leaves the device.** No uploads, and no runtime requests except the site's own files. | No CDNs, analytics or font services; `next/font` self-hosts fonts and pdf.js assets are copied into `public/pdfjs`. The CSP has `connect-src 'self'`. Every e2e suite asserts that the only origin contacted is localhost. |
| **Never add metadata to users' files.** | Load PDFs with `loadPdf()` (`updateMetadata: false`), create them with `createPdf()`, save them with `savePdf()`. The `.docx` and `.xlsx` writers write no `docProps`. JPEGs embedded in PDFs go through `stripJpeg` first. |
| **Removed means gone.** | pdf-lib writes every parsed object, even unreachable ones, so call `collectGarbage(doc)` after deleting anything. `savePdf` always rewrites the file (never an incremental append) and uses object streams. Redaction rasterises the page. |
| **Nothing is stored.** | Files, results and signatures live in memory (Zustand), never in localStorage or IndexedDB. The service worker caches app files only, and `e2e/offline.mjs` checks that. The only thing in localStorage is the theme choice. |

---

## 3. Decisions already made (don't re-ask)

| Topic | Decision |
| --- | --- |
| Framework | Next.js App Router, `output: "export"`, `trailingSlash: true` (fully static) |
| PDF writing | `@cantoo/pdf-lib` (maintained fork with encryption), with `@cantoo/fontkit` (`@pdf-lib/fontkit` crashes when subsetting with this fork) |
| PDF rendering | `pdfjs-dist` 6, in its own worker |
| Encryption | AES-256 via `@cantoo/pdf-lib` `encrypt()`; a random owner password when none is given |
| Redaction | Rasterise redacted pages (guaranteed removal; those pages lose selectable text) |
| Spreadsheets | SheetJS 0.20.3 installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (the npm `xlsx` package is stale and has CVEs) |
| Word reading | mammoth; `.docx` and `.xlsx` writing is hand-rolled so no metadata is added |
| Fonts in generated PDFs | Liberation Sans from pdf.js's `standard_fonts` (Latin, Greek, Cyrillic) |
| Office conversion fidelity | Best effort is fine, as long as it stays client-side |
| Offline | Our own service worker, generated at build time, precaching every file, cache-first |
| CSP | `vercel.json` header plus a hash-based `<meta>` per page (section 7.4) |
| Theme | Light (warm cream) and dark (charcoal) neutrals from the owner's Paperless app, with navy `#263a81` as the accent |
| License | MIT, holder "Abdullah" |
| Hosting | Vercel, deploying `out/` as a static site (`framework: null` in `vercel.json`) |
| HEIC decoding | libheif-js (LGPL-3.0) as an **add-on**: plain files under `/addons/`, never bundled (section 6, Add-ons). AVIF uses the browser's decoder |
| Large optional parts | Downloaded from our own site on first use, then cached for offline use; never in the precache |
| v2 roadmap (agreed 2026-09-27) | M11 Edit PDF · M12 Fill PDF + page tools · M13 OCR + Translate · M14 scan tools · M15 conversions · M16 media converter · M17 certificate signatures · M18 batch · M19 interface languages |
| Translate PDF | The browser's built-in on-device Translator API (Chrome/Edge); other browsers get a "use Chrome or Edge" message. No online service, no bundled models |
| Link → MP4/MP3 | Not built: it needs a server and breaks the no-upload promise. M16 is a *local* media converter (ffmpeg.wasm add-on) instead |
| Keep technical data | An allow-list of EXIF tag numbers (`technicalOnlyExif` in `exif.ts`), never a classifier-based filter |
| Edit text | Remove the original text operators from the content stream (never just cover them); new text in Liberation Sans / Times / Courier |
| Edit PDF output | User picks flattened or editable annotations; replaced text and white-out always go into the page, notes always stay Text annotations; no /T, /M or /CreationDate on anything added |

---

## 4. Stack and commands

| Package | Version | Notes |
| --- | --- | --- |
| next | 16.3.6 | static export, Turbopack |
| react / react-dom | 19.2.8 | uses `useEffectEvent` |
| tailwindcss | 4 | CSS-first config in `src/app/globals.css` |
| @cantoo/pdf-lib, @cantoo/fontkit | 2.11 / 2.0 | all PDF writing |
| pdfjs-dist | 6.3 | v6 API (section 9) |
| mammoth | 1.13 | `.docx` reading |
| xlsx (SheetJS) | 0.20.3 from the CDN tarball | spreadsheet reading |
| exifr | 7.1 | EXIF decoding |
| libheif-js | 1.23 | HEIC decoding add-on (only its `libheif-wasm/libheif.{js,wasm}` are shipped) |
| fflate | 0.8 | ZIP |
| zustand | 5 | tabs, toasts, signatures |
| @dnd-kit/* | 6 / 10 / 9 / 3 | drag and drop |
| vitest, playwright-core, serve (dev) | 5 / 1.63 / 14 | tests |

Built on Windows 11 with Node 24; CI runs Ubuntu with Node 24. Node 22.18+ is needed because the e2e suites import TypeScript fixtures directly.

| Command | What it does |
| --- | --- |
| `npm run dev` | `predev` copies pdf.js assets into `public/pdfjs/` and add-ons into `public/addons/`, then `next dev` (no service worker) |
| `npm run build` | `prebuild` copies pdf.js assets and add-ons, then `next build` exports to `out/`. `postbuild` runs `fix-export-segments.mjs`, then `secure-export.mjs` (CSP `<meta>` and `_headers`), then `build-service-worker.mjs` (`out/sw.js`) |
| `npm test` | Vitest, 133 tests, in Node |
| `npm run e2e [-- name]` | serves `out/` on :3123 **with the `vercel.json` headers** and runs `e2e/*.mjs` in headless Chromium; screenshots go to `e2e/.output/` |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | type check, after a build or dev run |
| `node scripts/screenshots.mjs` | regenerates `docs/screenshots/*.webp` from the built site |
| `node scripts/make-icons.mjs` | regenerates the favicon, SVG icon, Apple icon and PWA icons |

---

## 5. Repository map

```
src/
  app/
    layout.tsx               fonts, metadata (Open Graph, theme colour), pre-paint theme <script>, <AppShell>
    globals.css              ★ theme tokens (light/dark) and Tailwind @theme mapping
    page.tsx                 home: hero, promises, <ToolDirectory> (filterable tool grid)
    tools/[tool]/page.tsx    one static page per tool (generateStaticParams, dynamicParams = false)
    manifest.ts              web app manifest (force-static)
    icon.svg apple-icon.png favicon.ico    generated by scripts/make-icons.mjs
  config/site.ts             name, tagline, description, live URL, GitHub URL
  lib/
    tools.ts                 ★ the tool list: id, name, description, category, icon, keywords, accepts, multiFile, status; searchTools()
    files.ts                 file kinds and accept strings, formatBytes, createId
    errors.ts                ProcessingError(message, code: encrypted | unsupported | corrupt | invalid)
    worker-rpc.ts            ★ typed postMessage RPC: exposeWorkerApi() / createWorkerClient()
    download.ts zip.ts       downloads, ZIP (fflate), withSuffix / replaceExtension
    password.ts              strength meter and generator
    theme.ts                 theme storage key and the inline pre-paint script
    metadata/                privacy engine (pure): index.ts (detect, audit, strip + re-audit), jpeg/png/webp/pdf.ts,
                             heif.ts (HEIC/HEIF/AVIF, in-place strip), exif.ts (incl. technicalOnlyExif), xmp.ts
                             (regex-based; no DOMParser in workers), classify.ts (sensitivity), client.ts
    pdf/
      load.ts                ★ loadPdf / createPdf / savePdf / collectGarbage
      assemble.ts ranges.ts  merge, extract, rearrange; "1-3, 5, 8-" page ranges
      images.ts              images → PDF layout (EXIF orientation, fit/fill, page sizes)
      compress.ts            image recompression presets
      rasterize.ts           page → image (canvas limits), used by PDF to Images and Redact
      security.ts            protect, unlock, inspect encryption
      redact.ts redact-search.ts annotations.ts    redaction and text/annotation search
      stamp.ts               ★ page geometry: displayed coordinates ↔ PDF user space for any rotation/crop box
      markup.ts              watermark, page numbers, signatures
      edit/                  ★ Edit PDF: types.ts (object model, display points), geometry.ts (bounds, move; no pdf-lib),
                             content.ts (content-stream parser + text remover), fonts.ts (glyph widths), apply.ts
                             (draw in upright space; flatten or annotations with appearances), text-select.ts
      render.ts              pdf.js loader and openPdfForRendering → { doc, destroy }
      client.ts              page-side API for pdf.worker
    office/
      extract.ts             pdf.js text + font styles per page
      text-layout.ts         ★ lines, columns, running headers, paragraphs, headings, table columns
      pdf-to-office.ts       text pages → .docx / .xlsx
      docx.ts xlsx.ts ooxml.ts   metadata-free OOXML writers
      flow.ts                ★ PDF layout engine (paragraphs, lists, tables, images, links)
      word.ts sheet.ts       .docx → PDF (mammoth tree), spreadsheets → PDF (SheetJS)
      fonts.ts client.ts     Liberation Sans loader; page-side API for office.worker
    image/                   canvas.ts (decode/encode, browser only), prepare.ts (images for PDF), heic.ts (client for the
                             HEIC add-on worker), convert.ts (convert, displayable copy, ICC carry-over)
  workers/                   metadata / pdf / office workers expose lib functions; pdfjs.worker just imports pdf.js's worker
  store/                     workspace.ts (★ open files = tabs), toast.ts
  hooks/                     useAddFiles, useFileInputs (drop, paste, unload warning), useTheme, useImageSource (<img> for any image incl. HEIC)
  components/
    shell/                   AppShell, Header, Sidebar, ToolSearch (Ctrl/⌘K dialog), OfflineBadge, ThemeToggle, Toaster, ServiceWorker
    workspace/               Workspace, FileTabs, FilePanel, FilePreview, Dropzone
    pdf/                     usePdfDocument, PageThumbnail, PageTile, usePageSelection, PageStage (page + overlay), PageStrip
    tools/panels/
      registry.tsx           ★ tool id → panel, via next/dynamic (ssr: false)
      shared/                controls.tsx (Field, Segmented, AnchorPicker, ColorField, Slider), OutputCard, PdfStates,
                             ConversionParts (fidelity notes, warnings, PDF result preview), StampPreview (live preview)
      edit/                  Edit PDF: EditPanel (state, keys, save), EditorCanvas (page + SVG overlay + gestures),
                             Toolbar, Inspector, ObjectLayer (SVG per object), model.ts (tools, defaults, fonts),
                             useEditorState (undo/redo, drafts per file), usePageText (phrases, colour sampling)
      <tool folders>         sanitize, merge, split, organize, security, redact, images-to-pdf, convert-image (HEIC to JPG),
                             pdf-to-images, pdf-to-office, office-to-pdf, compress, sign, markup (watermark + page numbers)
    tools/ToolCard, ToolDirectory   home grid cards and the filter box
scripts/
  copy-pdfjs-assets.mjs      pdfjs-dist cmaps / standard_fonts / wasm / iccs → public/pdfjs (git-ignored)
  copy-addons.mjs            add-ons → public/addons/<name>-<version>/ (git-ignored); addons/heif.worker.js is ours
  fix-export-segments.mjs    Windows-only Next export bug fix (section 9)
  secure-export.mjs          CSP <meta> per page (script hashes) + out/_headers, from vercel.json
  build-service-worker.mjs   out/sw.js from service-worker.template.js with the precache list and version
  service-worker.template.js the real service worker
  make-icons.mjs screenshots.mjs
public/
  addons/                    generated by copy-addons.mjs; served, but fetched on first use only
  sw.js                      development stand-in that removes a leftover production worker (replaced in out/ by the build)
  icons/                     PWA icons (generated)
e2e/                         run.mjs + one suite per area (section 8)
docs/screenshots/            README images (generated)
vercel.json                  ★ build settings and security headers (the single source of truth for headers)
```

---

## 6. How it works

### Files and tabs
- Files come in from a drop anywhere on the page, the file picker or a paste. `useAddFiles(tool)` checks the kind against the tool's `accepts`, skips duplicates (same name, size and modified time) and adds them to `useWorkspaceStore`.
- **Tabs are global and survive switching tools**, so tools can be chained. A tab the current tool can't take shows links to tools that can.
- `FilePanel` shows the file summary and then the tool's panel from `TOOL_PANELS`. Panels receive `{ tool, file, files }`.
- Single-file panels are keyed by `${file.id}:${file.revision}`, so replacing a tab's content remounts them. Multi-file panels (merge, images-to-pdf) are keyed by tool.

### Heavy work
Panel → `lib/<area>/client.ts` → worker via `createWorkerClient` → pure function in `lib/<area>/`.
- **Arguments and results transfer their ArrayBuffers**, which detaches them. Pass a fresh copy (`new Uint8Array(await blob.arrayBuffer())`) and copy anything you still need afterwards (see `watermarkFile` and `signFile` in `lib/pdf/client.ts`).
- `ProcessingError` codes survive the worker boundary. UIs treat `encrypted` specially and link to Unlock.
- Browser-only code (canvas, pdf.js rendering) lives in `lib/image/canvas.ts`, `lib/pdf/rasterize.ts`, `lib/office/extract.ts` and `lib/pdf/annotations.ts`; everything else runs in Node for the unit tests.

### Results
`OutputCard` offers download (a ZIP for several files), open in new tabs, or replace the tab (bumps `revision`). Stamp tools preview through `useStampPreview`: the first pages are extracted once, stamped with the real code after a 250 ms pause, and rendered by pdf.js.

### Rendering
`render.ts` lazy-loads pdf.js with our worker and same-origin assets. `usePdfDocument(blob)` opens a document and destroys it on unmount. `PageThumbnail` renders only when visible, through a 3-slot queue. `PageStage` renders one page at the panel's width and gives children its size for overlays (Redact and E-Sign).

### Images and add-ons
- The `image` kind covers JPEG, PNG, WebP, HEIC/HEIF and AVIF. Always decode through `decodeImage()` (`lib/image/canvas.ts`), which routes HEIC to the add-on. Show images with `useImageSource()`, not a raw object URL, and turn one into PDF-embeddable bytes with `asPngOrJpeg()`.
- **Add-ons** are big optional parts served from `/addons/<name>-<version>/` but left out of the precache. `copy-addons.mjs` copies them into `public/addons/`. The service worker caches each file on first request in a separate `docsanitize-addons` cache that survives updates, and prunes files a new build no longer lists. The version in the path makes an upgrade a new URL. Today there's one: `libheif-<v>/heif.worker.js`, a classic worker (so it can `importScripts` the Emscripten loader, which must not be bundled). It's used by `lib/image/heic.ts` from the page or from inside other workers, and its load error tells the user to go online once.
- HEIC metadata is stripped **in place** (`heif.ts`): items are zeroed and retyped to `skip`, and so are the references from them, because HEIF uses absolute offsets. Never "remove" bytes from a HEIF.

### Edit PDF
- **One coordinate space.** Objects (`lib/pdf/edit/types.ts`) are in points on the page as displayed: top-left origin, y down, rotation applied, CropBox (a pdf.js viewport at scale 1). The editor draws them in an SVG with that `viewBox`; `apply.ts` draws them in "upright" space (bottom-left origin) and one `cm` per page, from `uprightMatrix()`, maps that to user space for any rotation. Annotation appearances use the same drawing with the matrix as their form's `/Matrix`, so both outputs look identical.
- **Text metrics are shared.** `baselineOffset()` and `LINE_HEIGHT` in `types.ts` place the first baseline where CSS puts it, so SVG `<text>` and PDF text line up. The CSS font stacks in `model.ts` match the PDF fonts' metrics.
- **Edit text.** `usePageText` merges pdf.js runs into phrases and samples text and background colour from the rendered canvas. On save, `content.ts` follows the text state and swaps each matching show operator for `[n] TJ` of the same advance. The fonts it can measure are simple fonts with `/Widths`, the standard 14 via `@cantoo/pdf-lib/standard-fonts`, and Type0 with Identity encoding. Anything it can't reach produces a warning, never a silent leftover.
- **History.** `useEditorState` keeps undo/redo; changes with the same key merge (a drag uses a `gesture:n` key, sliders a property key within 1 s). Drafts are kept per `file.id:revision` in memory, so switching tools or tabs doesn't lose work.
- **Pointer handling.** The canvas calls `preventDefault()` on pointer-down; without it the browser moves focus away from a text box the same click opens, closing it at once.

### Search
`searchTools()` scores each word against the name (most), then `keywords`, then description and category; every word must match. `ToolSearch` (header, Ctrl/⌘K) and `ToolDirectory` (home) both use it. Give every new tool `keywords` for the words people would type.

### Theme
Tokens in `globals.css`: `--canvas`, `--surface(-muted|-sunken)`, `--line(-strong)`, `--fg(-muted|-subtle)`, `--brand(-hover|-fg|-soft|-text|-border)`, `--success/warning/danger(-soft|-text)`, `--elev-1/2`. Components use utilities such as `bg-surface`, `text-fg-muted` and `border-line`, **never raw palette colours**, so both themes work. The exceptions are page "paper" whites and `text-white` on danger badges.

---

## 7. How to change common things

### 7.1 Add a tool
1. Write the logic as pure functions in `src/lib/<area>/`, with Vitest tests next to the others.
2. Expose it in a worker (`src/workers/*.worker.ts`) and add a page-side function in `lib/<area>/client.ts`.
3. Add the tool to `TOOLS` in `src/lib/tools.ts` (id, name, description, category, icon, `keywords` for search, accepts, `status: "ready"`). Its page is generated automatically. Add a `searchTools` expectation in `lib/__tests__/tools.test.ts` if the obvious query should find it first.
4. Build the panel in `src/components/tools/panels/<tool>/` using the shared controls and `OutputCard`, and register it in `registry.tsx` with `next/dynamic` (`ssr: false`).
5. Add or extend an e2e suite that **checks the downloaded bytes**, not just the UI, and keeps the no-console-errors and localhost-only assertions.
6. Look at the screenshots in light, dark and at 390 px wide.

### 7.2 Rename a tool or change its description or category
Edit `src/lib/tools.ts`. The sidebar, home grid, tool header and page metadata all read from it. Update the README's feature list too.

### 7.3 Change the name, tagline, live URL or GitHub link
`src/config/site.ts`. The URL feeds Open Graph link previews. The manifest reads the name and tagline from here too.

### 7.4 Change the security headers or CSP
- Edit **only `vercel.json`**. The build turns it into each page's `<meta>` policy (replacing `'unsafe-inline'` in `script-src` with that page's script hashes and dropping header-only directives such as `frame-ancestors`) and into `out/_headers`. The e2e server sends the same headers.
- Anything new the app loads must come from the site itself. A new directive value (for example `blob:` for workers) is only needed if a test shows a violation: CSP violations appear as console errors and fail the suites.
- Inline scripts are allowed only by hash, and the hashes are computed at build time, so a new inline `<script>` just works; one added at runtime is blocked.
- Keep the README's nginx example in step with `vercel.json`.

### 7.5 Change colours or the logo
- Theme colours: `src/app/globals.css` (both theme blocks). The browser theme colours are in `layout.tsx` (`viewport.themeColor`) and `manifest.ts`.
- Logo and icons: edit the colours or shield path in `scripts/make-icons.mjs` and run it. The header mark is the lucide `Shield` icon in `Header.tsx`.

### 7.6 Change the service worker
- Edit `scripts/service-worker.template.js`, never `out/sw.js`. Rules to keep:
  - HEAD requests must be answered from the cache (Next checks a page exists before prefetching it).
  - Requests with a query string, and worker scripts, must get a **rebuilt** `Response`, because Turbopack workers read their settings from their own URL (section 9).
  - Install caches everything except add-ons; activation deletes old app caches (never `docsanitize-addons`) and prunes add-on files the build no longer lists; `skip-waiting` only comes from the update prompt.
  - Add-on requests (`ADDONS`, filled in by `build-service-worker.mjs` from `out/addons/`) are cache-first from `docsanitize-addons` and cached on first fetch.
- `src/components/shell/ServiceWorker.tsx` registers it (production only) and shows the "Reload now" toast.
- `e2e/offline.mjs` covers install, add-ons downloaded only on first use, offline use (including a HEIC conversion), the update prompt and the stand-in.

### 7.10 Add an add-on (OCR languages, ffmpeg…)
1. Copy its files in `scripts/copy-addons.mjs` to `public/addons/<name>-<version>/`, with its licence.
2. Load it by that URL from a small client like `lib/image/heic.ts`, with a clear error for "not downloaded yet and offline".
3. Nothing else: the service worker picks it up from `out/addons/`. Extend `offline.mjs` to use it once online and again offline.

### 7.7 Update the README screenshots
`npm run build && node scripts/screenshots.mjs`. The scenes, sample files and viewport sizes are in the script.

### 7.8 Release and check the live site
Push to `main`. Vercel runs `npm run build` and deploys `out/`. Then check:
```bash
curl -sI https://docsanitize.vercel.app/ | grep -i content-security-policy          # header policy
curl -s  https://docsanitize.vercel.app/ | grep -c 'http-equiv="Content-Security-Policy"'   # 1 = meta policy present
curl -s  https://docsanitize.vercel.app/sw.js | grep -c PRECACHE                    # ≥1 = real worker, not the stand-in
```
If `sw.js` is the stand-in or the `<meta>` is missing, Vercel is serving Next's own output instead of `out/`. Check `framework`, `buildCommand` and `outputDirectory` in `vercel.json`, and the project settings in the Vercel dashboard. Bump `version` in `package.json` and the README for notable releases.

### 7.9 Upgrade dependencies
- **pdfjs-dist:** `copy-pdfjs-assets.mjs` copies `cmaps`, `standard_fonts`, `wasm` and `iccs`; check they still exist. The office fonts come from `standard_fonts/LiberationSans-*.ttf`.
- **@cantoo/pdf-lib:** re-run `security.test.ts`. It checks that no strings leak in plaintext, which depends on object streams.
- **SheetJS:** install the new tarball URL from cdn.sheetjs.com (`npm i https://cdn.sheetjs.com/xlsx-<v>/xlsx-<v>.tgz`), not the npm package.
- **libheif-js:** re-run `metadata.test.ts` (it decodes stripped HEICs with libheif) and `e2e/images.mjs`. The add-on URL follows the version automatically.
- **Next.js:** read the upgrade notes in `node_modules/next/dist/docs`, then check that `fix-export-segments.mjs` and `secure-export.mjs` still match the export's layout, and run the full e2e.

---

## 8. Testing

**Unit tests (`npm test`, 120):**
| File | Covers |
| --- | --- |
| `lib/metadata/__tests__/metadata.test.ts` | every format's audit and strip, verification reaching zero, lossless JPEG data, PDF leaks including revisions, "keep technical data" per format, HEIC/AVIF in-place strip decoding to identical pixels (fixtures in `heif/`, made by `make-fixtures.py`) |
| `lib/__tests__/tools.test.ts` | tool search ranking |
| `lib/pdf/__tests__/edit.test.ts` | content-stream parser, text removal keeping later text in place (spacing, TJ kerning, standard and Type0 fonts), unreachable-text warning, every annotation type without author/date, flattening, upright text on rotated pages, text selection |
| `lib/pdf/__tests__/pdf.test.ts` | page ranges, merge, extract, rearrange, purging deleted pages |
| `images.test.ts`, `compress.test.ts` | image layout and orientation maths, recompression rules and presets |
| `security.test.ts` | protect/unlock round trips, real RC4/AES-128/AES-256 fixtures (`__tests__/encrypted/`, made with pypdf by `make-fixtures.py`), no plaintext leaks |
| `redact.test.ts` | rasterised pages contain no text, form fields and structure removed, text and annotation search |
| `markup.test.ts` | geometry against pdf.js on all rotations, watermark centring and tiling, page labels, signature placement |
| `office/__tests__/*.test.ts` | PDF → docx/xlsx structure, docx/xlsx → PDF layout, missing-glyph warnings |
| `lib/__tests__/password.test.ts` | strength and generator |

Fixtures (`metadata/__tests__/fixtures.ts`, `office/__tests__/fixtures.ts`) use relative imports only, so the e2e suites import them directly.

**Browser suites (`npm run build && npm run e2e`):**
| Suite | Covers |
| --- | --- |
| `workspace.mjs` | tabs, drop zone, paste, keyboard reordering, unload warning |
| `sanitize.mjs` | audit, strip, verify and downloaded bytes for every format; locked PDFs |
| `organize.mjs` | organize, split, ZIP, merge |
| `convert.mjs` | images → PDF, PDF → images, compress |
| `office.mjs` | all four office conversions, checked with mammoth, SheetJS and pdf.js |
| `security.mjs` | protect, unlock, redact (including a pixel check that form fields are blacked out) |
| `markup.mjs` | watermark, page numbers, e-sign placement accuracy, quick strokes don't crash the pad |
| `edit.mjs` | every Edit PDF tool used with the mouse and keyboard; saved PDF checked: edited line gone from the bytes, flattened vs editable annotations, rotated page |
| `images.mjs` | tool search (home filter, Ctrl+K), HEIC/AVIF sanitize with the category filters, keep technical data, HEIC to JPG, HEIC/AVIF to PDF |
| `offline.mjs` | security headers and CSP, blocked uploads and scripts, manifest, precache, add-on on first use, offline use, update prompt, dev stand-in |

Every suite also takes light, dark and 390 px screenshots, and fails on console errors or requests to other origins. `convert.mjs` timed out once in about ten full runs on Windows; it hasn't reproduced since.

---

## 9. Traps already found (don't rediscover them)

**Next.js / Turbopack**
- On Windows the static export writes segment-prefetch files as nested folders; `fix-export-segments.mjs` flattens them (it does nothing on Linux).
- Workers: `new Worker(new URL("../../workers/x.worker.ts", import.meta.url), { type: "module" })`. Turbopack passes the worker its chunk list in the URL's `#params=` fragment, and a worker's `location` is its response's URL, so a service worker must answer worker scripts with a rebuilt `Response`, not the cached one. The build also copies worker **sources** into `out/_next/static/media/`, which is harmless.
- In a static export, Next sends a `HEAD` request for a page before prefetching it.
- `LayoutProps`/`PageProps` types come from the build, so run `tsc` after `npm run build`.
- On Vercel, the Next.js preset serves Next's own output and skips `postbuild`. That's why `vercel.json` sets `framework: null` and `outputDirectory: "out"`.

**pdf.js 6**
- `destroy()` is on the loading task, not the document.
- `render({ canvas, viewport })`. There's no `convertToViewportRectangle`; use `convertToViewportPoint`.
- `getPermissions()` returns a Set. There's no eval, so no `isEvalSupported` concerns.
- Text content leaves out annotation and form-field text, and items that start off the page. It merges consecutive text on one baseline into one item. Count `OPS.showText` in the operator list when you need to count drawn strings.
- `FontFaceObject` exposes `bold`/`italic`/`black`/`name` only after `getOperatorList()`.

**@cantoo/pdf-lib**
- `encrypt()` defaults to AES-256 but encrypts only streams: strings outside object streams stay in plaintext. We always save with object streams.
- Its decrypting parser loses Info and ID for files with cross-reference streams; `unlockPdf` restores them from a raw parse.
- Removing and re-inserting every page corrupts the page tree, so `rearrangePages` rebuilds a flat `Kids` array.
- `save()` adds a default page unless told not to, which `savePdf` handles.
- `normalize()` wraps existing page content in `q`/`Q`.
- Use `@cantoo/fontkit`; `@pdf-lib/fontkit` crashes on subset encoding.

**Other libraries**
- mammoth needs `buffer` in Node and `arrayBuffer` in the browser (both are passed).
- SheetJS needs `cellStyles: true` to see hidden rows, columns and widths. CSV must be decoded as UTF-8 by us, falling back to windows-1252.
- exifr can't read WebP; its `Options` type isn't exported (`Parameters<typeof exifr.parse>[1]`).
- dnd-kit: `MouseSensor` (distance 5), `TouchSensor` (250 ms long press) and `KeyboardSensor` starting on Space; keyboard drags in e2e need about 200 ms between keys.
- The header's search dialog puts an `<input>` in every page's DOM (hidden while closed). Scope e2e input locators to `main`.
- Edit PDF's toolbar is sticky, so it covers the top of a scrolled page; `e2e/edit.mjs` scrolls each target point to mid-screen before clicking. Rotated pages are shown landscape (their displayed width is the page's height).
- The signature pad's button is "Save signature" (it sits next to "Save PDF" in the editor).
- `sizedJpeg()` in the metadata fixtures has no real image data: fine for metadata tests, not decodable. For a decodable JPEG, encode one with the browser's canvas (see `e2e/images.mjs`).
- The HEIC fixtures are made with pillow-heif and Pillow **11.3** (AVIF writing needs ≥ 11.3; Pillow 12 conflicts with Streamlit on the owner's machine).
- `serve` (used by e2e) matches header sources as globs, so `run.mjs` turns `/(.*)` into `/**`, and refuses to start if the CSP isn't being sent.

**React**
- **Never read an event inside a state updater** (`setX((s) => [...s, point(e)])`). React may run the updater later, during render, when `e.currentTarget` is null. That crashed E-Sign in 1.0.0 ("This page couldn't load"). Read the event first, then pass the value in.
- No synchronous `setState` in effects (the lint rule enforces it). Keep async results together with their input and derive "loading" from a mismatch; use `useEffectEvent` for callbacks read in effects. The `react-hooks/refs` rule rejects curried handlers that read refs.

**Windows and PowerShell**
- `Get-Content` without `-Encoding utf8` mangles UTF-8, and paths containing `[tool]` are treated as wildcards (use `-LiteralPath`).
- Files written by Python on Windows get CRLF endings unless you pass `newline=''`. `.gitattributes` normalises to LF.
- Tool-call text containing `\uXXXX` escapes (and `\0`) may be decoded into literal characters; build such strings in code instead, and grep for control characters afterwards.
- Long bash heredocs that contain both quotes and `${…}` sometimes fail to parse; write the script to a file instead.

---

## 10. Known limitations and ideas

- Scanned PDFs have no text to extract (no OCR).
- Redacted pages become images.
- E-Sign and Edit PDF signatures are visual, not certificate signatures (M17).
- Edited text uses a standard font, not the document's embedded one; only horizontal left-to-right text can be edited in place; text inside form XObjects is covered but not removed (with a warning).
- Office conversions are best effort; generated text covers Latin, Greek and Cyrillic only.
- Merge and Split drop bookmarks and links between pages (Organize keeps them).
- Metadata in images embedded in PDFs is only handled for plain JPEGs.
- HEIC previews and conversions need the decoder add-on downloaded once (about 1.5 MB); auditing and stripping HEIC don't.
- Converted HEICs carry the ICC profile only if the HEIC has one (`colr` of type `prof`); `nclx`-only colour isn't translated.
- The e2e suites are plain Node scripts with `playwright-core`, not the `@playwright/test` runner. Migrating is optional.
