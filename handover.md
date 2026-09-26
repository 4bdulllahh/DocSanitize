# DocSanitize — Handover

_Last updated: 2026-09-27 · State: Milestones 1–4 complete and pushed to `origin/main` (github.com/4bdulllahh/DocSanitize)._

This file is the single source of truth for picking the project up in a fresh context. Read it top to bottom before writing code.

---

## 1. Start here (for the next session)

1. **Working protocol (user's hard rule):** build in milestones. At the end of **every** milestone, stop writing code and ask exactly:
   _"Milestone X complete. Shall I proceed to Milestone Y, or would you like me to generate a `handover.md` file?"_
   When the user approves the next milestone they also want the finished one **committed and pushed** to `origin/main`. Don't commit or push at any other time unless asked.
2. **Next up: Milestone 5** (Image ↔ PDF, PDF → images, Compress PDF). Plan in §11.
3. Read `AGENTS.md`: this is **Next.js 16.3** and its APIs differ from older versions. Its bundled docs are in `node_modules/next/dist/docs/`; check them before using a Next API you're unsure of.
4. Verify the baseline before changing anything:
   ```bash
   npm install
   npx playwright-core install chromium   # once per machine, for e2e
   npm run lint && npx tsc --noEmit && npm test   # 30 unit tests
   npm run build && npm run e2e                    # 3 browser suites against ./out
   ```

---

## 2. Product brief (from the user)

DocSanitize is a **100% client-side, open-source** privacy and PDF/image toolkit that replaces paid tools like Acrobat and iLovePDF. **No file may ever be uploaded.** Everything runs in the browser (Web Workers + client libraries), and the app is a static export.

- **Design:** navy `#263a81` as the brand/accent colour. Light **and** dark themes copied from the user's other app (https://paperless-bay-zeta.vercel.app/): warm cream/charcoal neutrals, with Paperless's orange accent replaced by navy. Feedback colours: emerald `#10b981` = clean/success, amber `#f59e0b` = warning/leaked data.
- **Layout:**
  - left sidebar listing the tools
  - a header with the badge **"100% Offline / Client-Side Engine"** and a GitHub star link
  - a central workspace where **each file opens in its own tab**
- **Feel:** fast, drag-and-drop heavy, no logins, no waiting on servers.

### Decisions the user has made (don't re-ask)
| Topic | Decision |
|---|---|
| Framework | Next.js App Router, `output: "export"` |
| PDF engine | **`@cantoo/pdf-lib`** (maintained fork with encryption), used for all PDF writing |
| Password protect/unlock | `@cantoo/pdf-lib` `encrypt()` / `load(…, { password })` |
| Redaction | **Rasterize** redacted pages (guaranteed removal; those pages lose selectable text) |
| Word/Excel → PDF | Best-effort fidelity is fine as long as it stays client-side. Low priority; can revisit after the app is done |
| Offline PWA + strict CSP | **Yes**, in Milestone 9 |
| Theme | Paperless light/dark neutrals + navy accent (implemented) |
| License | MIT, holder **Abdullah** (`LICENSE` exists) |
| GitHub | https://github.com/4bdulllahh/DocSanitize (in `src/config/site.ts`) |

---

## 3. Status

| # | Milestone | Status | Commit |
|---|---|---|---|
| 1 | Shell: Next/Tailwind, header, sidebar, Zustand store, themes | ✅ | `1dc01d0` |
| 2 | Multi-tab workspace + dropzone | ✅ | `a94ed81` |
| 3 | Privacy engine: metadata audit / strip / verify (PDF, JPEG, PNG, WebP) | ✅ | `4decddd` |
| 4 | Merge, Split, Organize (visual page grid) | ✅ | `b474d6b` |
| 5 | Image ↔ PDF, PDF → images, Compress | ⏭ next | |
| 6 | Office conversions (PDF → Word/Excel, Word/Excel → PDF) | planned | |
| 7 | Security: Protect, Unlock, Redact | planned | |
| 8 | Markup: E-Sign, Watermark, Page numbers | planned | |
| 9 | Open-source polish: README + Deploy to Vercel, CSP, PWA/offline | planned | |

**Tools live in the UI:** Sanitize Metadata, Merge PDF, Split PDF, Organize Pages. All others show a "Soon" badge and a "coming soon" card (the file still opens in a tab with a preview).

---

## 4. Stack

| Package | Version | Used for |
|---|---|---|
| next | 16.3.6 | App Router, static export, Turbopack |
| react / react-dom | 19.2.8 | uses `useEffectEvent` (stable in 19.2) |
| tailwindcss | 4 | CSS-first config in `globals.css` (`@theme`) |
| zustand | 5 | workspace (tabs) store and toast store |
| lucide-react | 1.x | icons. **No brand icons**: GitHub mark is inlined (`GithubIcon.tsx`) |
| clsx | 2 | class names |
| @cantoo/pdf-lib | 2.11 | all PDF writing/editing (fork of pdf-lib; also has `encrypt`) |
| pdfjs-dist | 6.3 | page rendering/thumbnails (**v6 API**, see §9) |
| exifr | 7.1 | decoding EXIF/GPS/IPTC blocks |
| @dnd-kit/core, sortable, modifiers, utilities | 6 / 10 / 9 / 3 | drag-and-drop sorting |
| fflate | 0.8 | ZIP output |
| vitest (dev) | 5 | unit tests (`src/**/*.test.ts`) |
| playwright-core, serve (dev) | 1.63 / 14 | e2e scripts in `e2e/` |
| @types/node (dev) | 24 | matches Node 24; vitest 5 requires ≥22 |

Environment the project was built on: Windows 11, Node 24.19, npm 11.

---

## 5. Commands

| Command | What it does |
|---|---|
| `npm run dev` | `predev` copies pdf.js assets → `public/pdfjs/`, then `next dev` |
| `npm run build` | `prebuild` copies pdf.js assets; `next build` → static site in `out/`; `postbuild` runs `scripts/fix-export-segments.mjs` |
| `npm test` | vitest, 30 unit tests (metadata engine + PDF assembly + page ranges) |
| `npm run e2e [-- filter]` | serves `out/` on :3123 and runs `e2e/*.mjs` in headless Chromium; artifacts go to `e2e/.output/` (git-ignored) |
| `npm run lint` | ESLint (ignores `out/`, `.next/`, `public/pdfjs/`) |
| `npx tsc --noEmit` | type-check (`out/` excluded in tsconfig) |

---

## 6. Repository map

```
src/
  app/
    layout.tsx            Root layout: fonts (self-hosted Geist), pre-paint theme <script>, <AppShell>
    globals.css           Theme tokens (light/dark) + Tailwind @theme mapping. READ THIS before styling
    page.tsx              Home: hero, promises, tool grid by category
    tools/[tool]/page.tsx One statically generated page per tool (generateStaticParams, dynamicParams=false)
    not-found.tsx
  config/site.ts          name, tagline, description, githubUrl
  lib/
    tools.ts              ★ Tool registry: id, name, description, category, icon, accepts, multiFile, status
    files.ts              FileKind detection, accept strings, formatBytes, createId
    errors.ts             ProcessingError(message, code: encrypted|unsupported|corrupt|invalid), errorMessage()
    worker-rpc.ts         ★ Typed postMessage RPC: exposeWorkerApi() in workers, createWorkerClient() on the page
    download.ts           downloadBlob()
    zip.ts                zipFiles() (fflate, store-only), withSuffix()
    theme.ts              THEME_STORAGE_KEY, THEME_INIT_SCRIPT (inline pre-paint script)
    metadata/             ★ Privacy engine (pure; runs in metadata.worker)
      index.ts            detectFormat (magic bytes), auditMetadata, stripMetadata (strip + re-audit)
      types.ts            MetadataEntry/Report, StripOptions (+defaults), StripResult, MetadataError
      classify.ts         sensitivity rules (high/medium/low), humanize(), formatValue(), entry()
      xmp.ts              worker-safe XMP reader (regex tokenizer; no DOMParser in workers)
      exif.ts             exifr wrapper + orientation-only EXIF builder
      jpeg.ts png.ts webp.ts  container parsers: audit + lossless strip
      pdf.ts              PDF audit + strip (Info, XMP on any object, ID, PieceInfo, annots, attachments, JS,
                          EXIF inside embedded JPEG photos, incremental revisions)
      bytes.ts            binary helpers, inflate()
      client.ts           page-side API: auditFile(blob), stripFile(blob, options)
      __tests__/          fixtures.ts (builders for leaky PDF/JPEG/PNG/WebP) + metadata.test.ts
    pdf/
      load.ts             ★ loadPdf (updateMetadata:false, encrypted → ProcessingError), createPdf, savePdf
                          (rewrite:true), collectGarbage (purges unreachable objects)
      assemble.ts         mergePdfs, extractPages, rearrangePages (runs in pdf.worker)
      ranges.ts           parsePageRanges("1-3, 5, 8-"), formatPageRanges, chunkPages
      client.ts           page-side API: mergeFiles, extractFromFile, rearrangeFile (return Blobs)
      render.ts           pdf.js loader (lazy), openPdfForRendering → { doc, destroy }, withRenderSlot queue
      __tests__/pdf.test.ts
  workers/
    metadata.worker.ts    exposes { audit, strip }
    pdf.worker.ts         exposes { merge, extract, rearrange }
    pdfjs.worker.ts       just imports pdfjs-dist's worker (it self-initialises)
  store/
    workspace.ts          ★ open files = tabs (in-memory File objects), active tab, status/output, revision
    toast.ts              toasts + imperative toast()
  hooks/
    useAddFiles.ts        validate kind for the tool, skip/focus duplicates, toasts
    useFileInputs.ts      window-wide drop (+overlay state), paste, beforeunload warning
    useTheme.ts           data-theme on <html>, localStorage, follows OS until chosen
  components/
    shell/                AppShell (header+sidebar+toaster+unload warning), Header, Sidebar, OfflineBadge,
                          ThemeToggle, Toaster, GithubIcon
    workspace/            Workspace (tabs/dropzone/overlay), FileTabs, FilePanel (summary + tool panel),
                          FilePreview (image / PDF first page), Dropzone (+DropOverlay)
    pdf/                  usePdfDocument(blob) hook, PageThumbnail (lazy, rotation via CSS, fixed box)
    files/KindIcon.tsx
    tools/
      ToolView.tsx        tool header + <Workspace>
      ToolCard.tsx        home grid card
      panels/
        registry.tsx      ★ TOOL_PANELS: tool id → next/dynamic panel (code-split per tool)
        shared/           OutputCard (download / ZIP / open in tabs / replace tab), PdfStates, PRIMARY/SECONDARY
        sanitize/         SanitizePanel, AuditCard, useAudit
        merge/ split/ organize/   (organize also has usePageHistory: undo/redo reducer)
scripts/
  copy-pdfjs-assets.mjs   copies pdfjs-dist cmaps/standard_fonts/wasm/iccs → public/pdfjs (git-ignored)
  fix-export-segments.mjs works around a Next 16 static-export bug on Windows (see §9)
e2e/                      run.mjs + workspace.mjs (M2) + sanitize.mjs (M3) + organize.mjs (M4)
```

---

## 7. Architecture

### Data flow
1. **Routing:** `/tools/<id>/` is prerendered for every entry in `TOOLS`. `ToolView` renders the tool header and `<Workspace tool>`.
2. **Opening files:** drop anywhere, the picker, or paste → `useAddFiles(tool)` → `useWorkspaceStore.addFiles()`.
   - Files the tool can't accept are rejected with a toast.
   - Duplicates (same name + size + lastModified) are skipped and their tab is focused.
3. **Tabs are global:** they persist across tools. That's deliberate, so tools can be chained (e.g. sanitize → merge).
   - An open file that the current tool can't take shows an "incompatible" notice with links to tools that can.
4. **FilePanel:** shows the file summary, then the tool's panel from `TOOL_PANELS`, or a coming-soon card plus preview.
   - Panels receive `{ tool, file, files }`, where `files` is every open file the tool accepts, in tab order.
   - Single-file tools are keyed `${file.id}:${file.revision}`, so replacing a tab's content remounts the panel.
   - Multi-file tools are keyed by `tool.id`, so their state survives switching tabs. The summary is hidden for them.
5. **Heavy work goes through workers:** the panel calls `lib/<area>/client.ts`, which calls a worker via `createWorkerClient`, which runs a pure function from `lib/<area>/*.ts`.
   - Arguments and results transfer their `ArrayBuffer`s, so always pass a **fresh** copy (`new Uint8Array(await blob.arrayBuffer())`).
   - `ProcessingError` codes survive the worker boundary.
6. **Results:** use `OutputCard` to download (a ZIP when there are several files), open in new tabs (`addFiles`), or replace the tab (`replaceFileContent` bumps `revision`).
   - Per-file status (`processing`/`done`/`error`) shows as an icon on the tab.

### Rendering (pdf.js 6)
- `render.ts` lazy-imports `pdfjs-dist` and sets `GlobalWorkerOptions.workerPort` to our bundled `pdfjs.worker.ts`. Assets load from `/pdfjs/...` (same origin).
- `usePdfDocument(blob)` opens the file on mount and destroys it on unmount. **In v6, `destroy()` lives on the loading task, not on `PDFDocumentProxy`**, hence the `{ doc, destroy }` return shape.
- `PageThumbnail` renders only when scrolled into view (IntersectionObserver), through a 3-slot render queue. Rotation is CSS-only, and the page is fitted inside a fixed box (no layout shift).

### Theme
- Tokens live in `globals.css`: `--canvas`, `--surface`, `--surface-muted`, `--surface-sunken`, `--line(-strong)`, `--fg(-muted|-subtle)`, `--brand(-hover|-fg|-soft|-text|-border)`, `--success/warning/danger(-soft|-text)`, `--elev-1/2`.
- Tailwind utilities map to them: `bg-surface`, `text-fg-muted`, `border-line`, `bg-brand`, `text-brand-text`, `shadow-elev-1`, and so on. The `dark:` variant follows `[data-theme="dark"]`.
- **Never use raw palette colours** (`slate-*`, `white`, …) in components; use the tokens so both themes work. The one exception is `text-white` on `bg-danger` badges.
- `--brand` is always `#263a81` (fills). `--brand-text` is lighter in dark mode for readable navy text.

---

## 8. Conventions and invariants (must keep)

- **Never add metadata to user files.**
  - Load with `loadPdf()` (`updateMetadata: false`), create with `createPdf()`, save with `savePdf()`.
  - `savePdf` uses `rewrite: true`, never an incremental append. `@cantoo/pdf-lib` otherwise appends to the original bytes when a document was loaded for incremental updates.
- **Removed content must really be gone.** pdf-lib writes every parsed object, even unreachable ones, so call `collectGarbage(doc)` after deleting pages or metadata.
- **No network requests at runtime**, apart from same-origin static assets. No CDNs, analytics or font services.
  - `next/font` self-hosts the fonts at build time.
  - e2e suites assert that the only origin contacted is localhost. Keep that assertion in new suites.
- **Workers:** keep heavy work in `lib/*` as pure functions (so they're unit-testable in Node), expose them in a worker via `exposeWorkerApi`, and call them via `createWorkerClient`. No `DOMParser` in workers.
- **Errors:** throw `ProcessingError` with a user-facing message and a code. UIs treat `encrypted` specially: they link to `/tools/unlock`.
- **React hooks pattern:** no synchronous `setState` in effects (the lint rule enforces it).
  - Store async results together with their input, e.g. `useState<{ blob, state }>`, and derive "loading" when the input changed. See `useAudit` / `usePdfDocument`.
  - Use `useEffectEvent` for callbacks read inside effects.
- **Adding a tool:**
  1. Write pure logic in `src/lib/<area>/` with vitest tests.
  2. Expose it in a worker, or add it to an existing one.
  3. Add a page-side client function.
  4. Build the panel in `src/components/tools/panels/<tool>/`.
  5. Register it in `registry.tsx` via `next/dynamic` (`ssr: false`).
  6. Flip the tool's `status` to `"ready"` in `src/lib/tools.ts`.
  7. Add an e2e suite in `e2e/` that **checks downloaded bytes**, not just the UI.
  8. Check light, dark and 390 px mobile screenshots.
- **UX conventions:**
  - The action column sits on the right on desktop and **first** on mobile (`order-first lg:order-0`).
  - The primary button uses the `PRIMARY` class and secondary buttons `SECONDARY` (both exported from `OutputCard.tsx`).
  - Result download buttons are labelled "Download result" / "Download edited PDF", so they're never confused with the summary's "Download".
- Output filenames: `withSuffix(name, "clean" | "organized" | "part-01" …)`.

---

## 9. Gotchas already solved (don't rediscover them)

- **Next 16 on Windows:** the static export writes segment-prefetch files as nested folders (it builds the filename with `path.relative`, which produces backslashes). The browser then gets 404s. `scripts/fix-export-segments.mjs` flattens them in `postbuild`; it does nothing on Linux or Vercel.
- **Turbopack workers:** `new Worker(new URL("../../workers/x.worker.ts", import.meta.url), { type: "module" })` works. The build also copies the worker's **source** into `out/_next/static/media/`, which is harmless; `out` is excluded from `tsc`.
- **pdf.js 6:**
  - no `isEvalSupported` option
  - `render({ canvas, viewport })`
  - its worker self-initialises when imported inside a worker
  - standard 14 fonts render with system fonts, so `/pdfjs/standard_fonts` is rarely fetched. CMaps and WASM are used for CJK and JBIG2/JPX content.
- **@cantoo/pdf-lib:**
  - Removing every page and re-inserting them corrupts the page tree. `rearrangePages` instead rebuilds a flat `Kids` array after copying inherited `Resources`/`MediaBox`/`CropBox`/`Rotate` onto each page.
  - `save()` defaults `addDefaultPage: true`; `savePdf` disables it.
- **exifr:**
  - Can't read WebP and only partially reads PNG, hence our own container parsers.
  - Its `Options` type isn't exported; use `Parameters<typeof exifr.parse>[1]`.
  - It names tag `0xA431` `SerialNumber`.
- **dnd-kit:**
  - Use `MouseSensor` (distance 5) + `TouchSensor` (250 ms long-press, so the grid still scrolls on phones) + `KeyboardSensor` with `keyboardCodes.start: ["Space"]`, which leaves Enter free for selecting.
  - In e2e, keyboard drags need about 200 ms between key presses.
- **PowerShell 5.1 (the user's primary shell):**
  - `Get-Content` without `-Encoding utf8` mangles UTF-8. One em dash was corrupted this way.
  - Paths containing `[tool]` are treated as wildcards (use `-LiteralPath`); this once blanked `src/app/tools/[tool]/page.tsx`.
  - Prefer the Bash tool with Python for multi-file text edits.
- **`npm install` warnings about `allow-scripts`** are expected (npm 11 policy) and harmless.
- **Vitest hides `console.log` for passing tests.** Write to a file if you need to inspect output.

---

## 10. Testing and verification

- **Unit (30 tests):**
  - `src/lib/metadata/__tests__/metadata.test.ts`: every format's audit and strip, verification reaches zero tags, lossless JPEG scan data, WebP flag clearing, a PDF with every leak type including an incremental revision, and encrypted-PDF errors.
  - `src/lib/pdf/__tests__/pdf.test.ts`: page ranges, merge order and no producer, extract groups, rearrange order/rotation, deleted-page purge, nested page trees.
- **Fixtures:** `src/lib/metadata/__tests__/fixtures.ts` builds a leaky PDF, JPEG, PNG and WebP (EXIF with GPS/serial, XMP, text chunks, attachments, JS, comments, revisions). It uses relative imports only, so Node 24 can import it directly (the e2e suites do).
- **E2E (`npm run build && npm run e2e`):** all suites passed at handover.
  - `workspace.mjs`: tabs, dropzone, drag & drop, paste, keyboard, reorder, unload warning
  - `sanitize.mjs`: audit, strip, verify, download bytes, batch, locked PDF
  - `organize.mjs`: organize, split, ZIP, merge, preview
- **Quality bar used so far:**
  - check screenshots in light, dark and mobile (390 px)
  - no console errors
  - no network origins other than localhost
  - pixel-identical output for lossless image stripping (verified for M3)

---

## 11. Roadmap and plans for the next milestones

### Milestone 5: Image ↔ PDF, PDF → images, Compress
**Images → PDF** (`images-to-pdf`, multi-file; panel pattern like Merge: sortable list of images)
- Options:
  - page size: fit image / A4 / Letter
  - orientation: auto / portrait / landscape
  - margin
  - fit or fill
- JPEG: **run `stripJpeg` first**, otherwise EXIF/GPS gets embedded in the PDF. Then `embedJpg`.
- PNG: `embedPng` (after stripping).
- WebP: pdf-lib can't embed it. Decode with `createImageBitmap`, draw to an `OffscreenCanvas`, re-encode to PNG or JPEG.
- Respect EXIF orientation: `createImageBitmap(blob, { imageOrientation: "from-image" })` when re-encoding, or rotate the page for raw JPEG embeds.
- Where decoding is needed, run it in a worker (`OffscreenCanvas` is available in workers).

**PDF → images** (`pdf-to-images`)
- Render with pdf.js at the chosen DPI (72/150/300) to a canvas, then `toBlob` as JPEG (quality slider), PNG or WebP.
- Page selection reuses `parsePageRanges` and the Split grid.
- Several images download as a ZIP via `OutputCard`.
- Cap the canvas size, since browsers limit canvases to about 16k px per side.

**Compress PDF** (`compress`)
- For each image XObject with `Filter /DCTDecode` (plain JPEG, DeviceRGB or DeviceGray, no SMask):
  1. decode in a worker (`createImageBitmap`)
  2. downscale to a target DPI based on the largest placement (or simply max pixel dimensions)
  3. re-encode JPEG at the quality preset
  4. replace the stream and update `Width`/`Height`
- Skip CMYK, Indexed and masked images at first.
- Then `collectGarbage` and `savePdf` with object streams.
- Presets: Light / Balanced / Strong.
- Show before and after sizes, and **keep the original if the result is bigger**.
- Optional checkbox: "also remove metadata" (reuse `stripPdf`).

### Milestone 6: Office conversions (best effort, client-side only)
- **PDF → Word:** pdf.js `getTextContent()` per page. Group items into lines and paragraphs by y and font size, then write a `.docx` with the `docx` package (headings from font size, page breaks between pages).
- **PDF → Excel:** cluster text items into rows (by y) and columns (by x gaps) into one sheet per page.
  - Library: SheetJS is no longer maintained on npm (the registry `xlsx` is outdated); its current builds come from its own CDN tarball.
  - Alternative: `exceljs`. **Ask the user** if unsure.
- **Word → PDF:** `mammoth` (docx → semantic HTML), then lay out simple HTML (paragraphs, headings, lists, basic tables, images) with pdf-lib text drawing and an embedded font.
  - Non-Latin text needs `@pdf-lib/fontkit` with a bundled TTF. Check whether `@cantoo/pdf-lib` needs `registerFontkit`.
  - Rasterizing HTML via SVG `foreignObject` is an alternative, but produces non-selectable text.
- **Excel → PDF:** read the sheets, then draw paginated tables with pdf-lib.
- Be upfront in the UI that fidelity is approximate.

### Milestone 7: Security
- **Protect:**
  - `loadPdf` → `doc.encrypt({ userPassword, ownerPassword, permissions })` → save.
  - Verify which AES variant `@cantoo/pdf-lib` writes, and prefer AES-256.
  - Add a password strength hint.
  - Permissions: print / copy / modify toggles.
- **Unlock:**
  - `PDFDocument.load(bytes, { password })` (a new variant of `loadPdf`), then save **without** encryption.
  - Handle owner-password-only files, which open without a password.
  - pdf.js needs the password too for previews (`getDocument({ password })` or the `onPassword` callback).
  - Test that the output is unencrypted.
  - After this, update the `encrypted` error UIs, which already link to `/tools/unlock`.
- **Redact:**
  1. Draw boxes over the pdf.js-rendered page.
  2. On apply, rasterize each affected page at about 200 DPI.
  3. Paint the boxes solid black on the raster.
  4. Replace the page with a single image of the same size, dropping its annotations.
  5. Suggest running Sanitize afterwards (or strip automatically).
  6. Verify with pdf.js `getTextContent()` that redacted pages contain no text.

### Milestone 8: Markup
- **E-Sign:**
  - Capture: a signature pad on canvas (pointer events, smoothing, undo) or an uploaded PNG/JPG, with an optional "remove white background" step.
  - Placement: drag and resize over the pdf.js page.
  - Output: `embedPng` + `drawImage`, converting coordinates for `CropBox` and page `Rotate`.
  - Multiple placements across pages.
- **Watermark:** text (font, size, colour, opacity, rotation, position or tiled) or an image. Draw it with pdf-lib on every page or selected pages. Standard fonts only cover WinAnsi text, so non-Latin text needs fontkit and an embedded TTF.
- **Page numbers:** format (`{n}`, `{n} / {total}`, `Page {n}`), position (6 spots), margin, start number, skip the first page, font size.

### Milestone 9: Open-source polish
- **README:**
  - features, privacy model, screenshots
  - a "Deploy to Vercel" button: `https://vercel.com/new/clone?repository-url=https://github.com/4bdulllahh/DocSanitize`
  - self-hosting on any static host, development commands, testing
  - the MIT licence (the `LICENSE` file already exists)
- **CSP:**
  - A `vercel.json` header gives Vercel a real header; also add a production-only `<meta>` fallback for other hosts.
  - The key guard: `connect-src 'self'`.
  - Next's static export uses inline scripts, and the theme init script is inline too: allow them with `'unsafe-inline'` or per-page hashes.
  - Also needed: `worker-src 'self' blob:`, `'wasm-unsafe-eval'` for pdf.js WASM, `img-src 'self' blob: data:`, `object-src 'none'`, `form-action 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (header only).
  - Test that every tool still works under the CSP.
- **PWA/offline:**
  - a `manifest.webmanifest` and icons
  - a handwritten `public/sw.js` with a precache list generated in `postbuild` from the files in `out/` (pages, `_next/static`, `/pdfjs`)
  - network-first for HTML and cache-first for hashed assets
  - an "installable, works offline" indicator
- **Hosting note:** asset paths assume the site is served from the domain root. For a sub-path host (e.g. a GitHub Pages project site), set `basePath` and make `render.ts`'s `ASSETS` respect it.
- Consider a GitHub Actions workflow (lint, typecheck, unit tests, build, and e2e on Linux).

---

## 12. Known limitations and tech debt

- Merge and split lose bookmarks and links between pages (pages are copied into a new document). Organize keeps them.
- The metadata engine doesn't treat visible content as metadata (comment text, form field values, hidden text layers). Redaction (M7) is for that.
- HEIC/AVIF images aren't supported: browsers can't decode them for preview, and there's no stripper for them.
- Metadata inside images embedded in PDFs is only handled for plain `DCTDecode` JPEGs.
- The multi-download "Download N clean files" in Sanitize triggers separate downloads. It could use a ZIP (`zipFiles`) instead.
- The home page tool grid has no search; that's fine for 17 tools.
- e2e suites are plain Node scripts using `playwright-core`, not the `@playwright/test` runner. Migrating is optional.

---

## 13. Persistent notes outside the repo
Claude Code's per-project memory (`~/.claude/projects/…DocSanitize/memory/`) also holds the user's decisions and the milestone protocol, so new sessions in this folder load them automatically. This file is the complete reference either way.
