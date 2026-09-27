# DocSanitize

**A private PDF and image toolkit that runs entirely in your browser.** Strip hidden metadata, merge and split, convert to and from Word and Excel, redact, sign, password-protect and compress. Your files are never uploaded, because there is no server to upload them to.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F4bdulllahh%2FDocSanitize&project-name=docsanitize&repository-name=docsanitize)
[![CI](https://github.com/4bdulllahh/DocSanitize/actions/workflows/ci.yml/badge.svg)](https://github.com/4bdulllahh/DocSanitize/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-263a81.svg)](LICENSE)

## Tools

| | Tool | What it does |
| --- | --- | --- |
| **Privacy** | Sanitize Metadata | Lists the hidden data in PDFs, JPEGs, PNGs and WebPs (author, GPS location, camera, edit history, XMP) and removes it, then re-reads the result to confirm it's clean. |
| **Organize** | Merge PDF | Combines PDFs in the order you choose. |
| | Split PDF | Extracts page ranges or splits a document into separate files. |
| | Organize Pages | Reorders, rotates and deletes pages on a drag-and-drop grid. |
| **Security** | Protect PDF | Encrypts with a password (AES-256) and sets printing, copying and editing permissions. |
| | Unlock PDF | Removes the password (RC4, AES-128 or AES-256) from a PDF you have the password for. |
| | Redact PDF | Blacks out areas or search matches and permanently removes the text, images and form fields underneath. |
| **Convert** | Images to PDF | Turns JPG, PNG and WebP images into one PDF, respecting photo orientation. |
| | PDF to Images | Exports pages as JPG, PNG or WebP. |
| | PDF to Word | Extracts text into an editable `.docx`, keeping headings and paragraphs. |
| | PDF to Excel | Extracts tables into an `.xlsx` spreadsheet. |
| | Word to PDF | Converts `.docx` to PDF, keeping headings, lists, tables, links and images. |
| | Excel to PDF | Converts `.xlsx`, `.xls`, `.ods` and `.csv` sheets into paginated PDF tables. |
| **Optimize and markup** | Compress PDF | Shrinks a PDF by downscaling and re-encoding its images. |
| | E-Sign PDF | Draws, types or uploads a signature and places it on the page. |
| | Watermark | Stamps text or an image on the pages you choose, on top of or behind the content. |
| | Page Numbers | Adds page numbers in the position and format you choose. |

Files open once and stay in the tab, so you can run several tools on the same document in turn. Every result is previewed before you download it.

## How your files stay on your device

- **No server.** DocSanitize is a static website: HTML, JavaScript and a few font and decoder files. All processing runs in your browser, in background threads (Web Workers).
- **The browser enforces it.** Every page has a Content-Security-Policy with `connect-src 'self'`, so the browser itself refuses to send data to any other site, even if the code tried. Inline scripts are allowed only by their exact hashes, which blocks injected code. You can check this in your browser's developer tools (Network and Console tabs).
- **Nothing is stored.** Files are held in memory for the life of the tab and discarded when you close it. There are no cookies, no analytics and no accounts. Signatures you create are kept only until the tab closes.
- **Works offline.** After your first visit, a service worker caches the app (about 9 MB), so it keeps working with no connection. It caches the app's own files only, never yours.
- **Clean output.** Documents DocSanitize creates carry no author, software or tracking metadata. Photos embedded into PDFs have their EXIF and GPS data removed first.
- **Tested.** The browser test suites fail if the app makes any request to another origin or breaks the security policy. One suite also checks that uploads and injected scripts are blocked, and that the tools work with the network switched off.

## Deploy your own

DocSanitize builds to a folder of static files (`out/`) that any static host can serve. It must be served from the root of a domain or subdomain, not from a sub-path.

### Vercel

Click **Deploy with Vercel** above, or import the repository in the Vercel dashboard. The defaults work as is. The security headers in [`vercel.json`](vercel.json) are applied automatically.

### Netlify or Cloudflare Pages

Use build command `npm run build` and output directory `out`. The build writes an `out/_headers` file with the same security headers, which both hosts read.

### Anything else (nginx, Caddy, S3, GitHub Pages with a custom domain, a USB stick)

```bash
npm ci
npm run build   # static site in ./out
```

Upload the contents of `out/`. Every page already contains its Content-Security-Policy as a `<meta>` tag, so the main protection applies even where you can't set headers. If you can set headers, copy them from [`vercel.json`](vercel.json). They add `frame-ancestors 'none'` (no embedding in other sites) and a few standard hardening headers. For nginx:

```nginx
server {
  # listen, server_name, TLS …
  root /var/www/docsanitize/out;

  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy no-referrer always;

  location / { try_files $uri $uri/index.html $uri.html =404; }
  # "Cache-Control: no-cache" so updates are noticed; `expires` keeps the headers above,
  # whereas an add_header here would replace them.
  location = /sw.js { expires -1; }
  error_page 404 /404.html;
}
```

The header allows `'unsafe-inline'` only because hashes can't be listed per page in a header. The `<meta>` policy on each page narrows it to that page's own scripts, and browsers enforce both.

## Development

Requires Node.js 22.18 or later (the browser tests import TypeScript fixtures directly).

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload (no service worker). |
| `npm run build` | Static export to `out/`, then adds the CSP to each page and generates `out/sw.js`. |
| `npm run lint` | ESLint. |
| `npx tsc --noEmit` | Type check (after a build or `npm run dev`, which generate the route types). |
| `npm test` | Unit tests (Vitest, in Node): the PDF, image, metadata and Office logic. |
| `npm run e2e` | Browser tests against the built site. Run `npm run build` first. |

The browser tests use Playwright's Chromium. Install it once per machine with `npx playwright-core install chromium`. They serve `out/` with the headers from `vercel.json`, drive every tool like a user would, and check the downloaded files with independent readers (pdf.js, mammoth, SheetJS). Screenshots are written to `e2e/.output/`. Run one suite with `npm run e2e -- security`.

### How it's built

- [Next.js](https://nextjs.org) (App Router) with `output: "export"`: a static site, no server runtime.
- [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) for editing PDFs, including AES-256 encryption.
- [pdf.js](https://mozilla.github.io/pdf.js/) for rendering and text extraction. Its fonts, CMaps and decoders are served from the same origin (`scripts/copy-pdfjs-assets.mjs`).
- [mammoth](https://github.com/mwilliamson/mammoth.js) to read `.docx` and [SheetJS](https://sheetjs.com) to read spreadsheets. `.docx` and `.xlsx` files are written by our own small writers, so they carry no document properties.
- [fflate](https://github.com/101arrowz/fflate) for ZIP downloads and Office packages. Liberation Sans (from pdf.js) is embedded in the PDFs we generate.
- Tailwind CSS, with light and dark themes.

```
src/
  app/              routes, manifest and icons
  components/       app shell, tool panels, shared PDF views
  lib/metadata/     metadata readers and strippers (PDF, JPEG, PNG, WebP)
  lib/pdf/          merge, split, compress, security, redaction, stamps
  lib/office/       PDF <-> Word/Excel, and the PDF layout engine
  workers/          Web Worker entry points
scripts/            build steps: pdf.js assets, CSP, service worker, icons
e2e/                browser test suites
```

## Limitations

- **Scanned PDFs** have no text layer, so PDF to Word and PDF to Excel have nothing to extract. There is no OCR.
- **Redacted pages become images.** That guarantees nothing survives underneath, but text on those pages can no longer be selected. Other pages are unchanged.
- **E-Sign adds a visible signature**, not a certificate-based digital signature.
- **Word and Excel to PDF are best effort.** Headings, lists, tables, links and images are kept, but complex layouts, text boxes and charts are not. Text uses Liberation Sans, which covers Latin, Greek and Cyrillic; other scripts show as "?" and you get a warning when that happens.
- **Very large files** are limited by your device's memory.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint`, `npm test` and, for UI changes, `npm run build && npm run e2e` before opening a pull request. Changes must keep everything in the browser: no network requests other than the app's own files, and no metadata added to users' files.

To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Abdullah
