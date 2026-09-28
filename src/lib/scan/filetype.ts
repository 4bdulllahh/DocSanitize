import { plural, type Finding } from "./findings";

/*
 * What a file really is, from its first bytes (its "magic number") rather than its name, and
 * the tricks file names use to disguise programs: a wrong extension, a double extension or a
 * hidden right-to-left character that makes "invoice[RLO]fdp.exe" display as "invoiceexe.pdf".
 */

export type TypeCategory = "document" | "image" | "audio" | "video" | "archive" | "program" | "text" | "font" | "data";

export interface FileType {
  name: string;
  /** Extensions (without the dot) this format normally has. */
  extensions: string[];
  category: TypeCategory;
}

const t = (name: string, extensions: string, category: TypeCategory): FileType => ({ name, extensions: extensions.split(" "), category });

const TEXT_EXTENSIONS = "txt csv tsv md markdown log json xml html htm svg css js mjs ts tsx jsx yml yaml ini cfg conf toml sql sh bash zsh bat cmd ps1 psm1 vbs py rb pl php java c h cpp hpp cs go rs swift kt srt vtt ics vcf eml rtf tex bib gitignore env properties";

/** Extensions that run code when opened. */
const PROGRAM_EXTENSIONS = new Set("exe scr com pif bat cmd vbs vbe js jse wsf wsh hta ps1 psm1 msi msp jar lnk cpl reg dll iso img vhd vhdx apk app dmg pkg sh command scf url inf".split(" "));
const MACRO_EXTENSIONS = new Set("docm dotm xlsm xltm xlam pptm potm ppsm".split(" "));

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const startsWith = (bytes: Uint8Array, signature: number[], at = 0) => signature.every((b, i) => bytes[at + i] === b);

/** Names of the entries in a ZIP's central directory (without unpacking it). */
export function zipEntryNames(bytes: Uint8Array, limit = 5000): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is in the last 64 KB.
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) !== 0x06054b50) continue;
    const count = view.getUint16(i + 10, true);
    let at = view.getUint32(i + 16, true);
    const names: string[] = [];
    const decoder = new TextDecoder();
    for (let n = 0; n < Math.min(count, limit) && at + 46 <= bytes.length; n++) {
      if (view.getUint32(at, true) !== 0x02014b50) break;
      const nameLength = view.getUint16(at + 28, true);
      names.push(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return names;
  }
  return [];
}

function zipType(bytes: Uint8Array): FileType {
  const names = zipEntryNames(bytes);
  const has = (prefix: string) => names.some((n) => n.startsWith(prefix));
  if (names[0] === "mimetype" || ascii(bytes, 30, 8) === "mimetype") {
    const mime = ascii(bytes, 38, 60);
    if (mime.startsWith("application/epub+zip")) return t("EPUB e-book", "epub", "document");
    if (mime.includes("opendocument.text")) return t("OpenDocument text", "odt ott", "document");
    if (mime.includes("opendocument.spreadsheet")) return t("OpenDocument spreadsheet", "ods ots", "document");
    if (mime.includes("opendocument.presentation")) return t("OpenDocument presentation", "odp otp", "document");
  }
  if (names.includes("[Content_Types].xml")) {
    if (has("word/")) return t("Word document", "docx docm dotx dotm", "document");
    if (has("xl/")) return t("Excel workbook", "xlsx xlsm xltx xltm xlam", "document");
    if (has("ppt/")) return t("PowerPoint presentation", "pptx pptm potx potm ppsx ppsm", "document");
    if (has("visio/")) return t("Visio drawing", "vsdx vsdm", "document");
  }
  if (names.includes("AndroidManifest.xml")) return t("Android app (APK)", "apk", "program");
  if (names.includes("META-INF/MANIFEST.MF")) return t("Java program (JAR)", "jar", "program");
  return t("ZIP archive", "zip", "archive");
}

function ftypType(bytes: Uint8Array): FileType | null {
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  const brand = ascii(bytes, 8, 4);
  if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return t("HEIC image", "heic heif hif", "image");
  if (/^(avif|avis)$/.test(brand)) return t("AVIF image", "avif", "image");
  if (brand === "qt  ") return t("QuickTime video", "mov qt", "video");
  if (/^M4A /.test(brand)) return t("MPEG-4 audio", "m4a", "audio");
  if (/^3g/.test(brand)) return t("3GP video", "3gp 3g2", "video");
  if (/^crx /.test(brand)) return t("Canon raw photo", "cr3", "image");
  return t("MP4 video", "mp4 m4v", "video");
}

/** The file's real format, or null if it isn't recognised. */
export function detectType(bytes: Uint8Array): FileType | null {
  const head = ascii(bytes, 0, 16);
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) return t("PDF document", "pdf ai", "document");
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return t("PNG image", "png", "image");
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return t("JPEG image", "jpg jpeg jpe jfif", "image");
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return t("GIF image", "gif", "image");
  if (head.startsWith("RIFF")) {
    const kind = ascii(bytes, 8, 4);
    if (kind === "WEBP") return t("WebP image", "webp", "image");
    if (kind === "WAVE") return t("WAV audio", "wav", "audio");
    if (kind === "AVI ") return t("AVI video", "avi", "video");
  }
  const ftyp = ftypType(bytes);
  if (ftyp) return ftyp;
  if (head.startsWith("BM") && bytes.length > 26) return t("BMP image", "bmp dib", "image");
  if (head.startsWith("II*\0") || head.startsWith("MM\0*")) return t("TIFF image (or camera raw)", "tif tiff dng cr2 nef arw orf rw2 pef", "image");
  if (startsWith(bytes, [0, 0, 1, 0])) return t("Windows icon", "ico cur", "image");
  if (head.startsWith("8BPS")) return t("Photoshop document", "psd psb", "image");
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return zipType(bytes);
  if (head.startsWith("Rar!\x1a\x07")) return t("RAR archive", "rar", "archive");
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return t("7-Zip archive", "7z", "archive");
  if (startsWith(bytes, [0x1f, 0x8b])) return t("Gzip archive", "gz tgz gzip", "archive");
  if (head.startsWith("BZh")) return t("Bzip2 archive", "bz2 tbz2", "archive");
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return t("XZ archive", "xz txz", "archive");
  if (startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return t("Zstandard archive", "zst", "archive");
  if (head.startsWith("MSCF")) return t("Windows cabinet archive", "cab", "archive");
  if (ascii(bytes, 257, 5) === "ustar") return t("TAR archive", "tar", "archive");
  if ([0x8001, 0x8801, 0x9001].some((at) => ascii(bytes, at, 5) === "CD001")) return t("Disc image (ISO)", "iso", "program");
  if (head.startsWith("MZ")) return t("Windows program", "exe dll sys scr com cpl ocx drv efi mui", "program");
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return t("Linux program (ELF)", "so elf bin o", "program");
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]].some((s) => startsWith(bytes, s))) return t("Mac program (Mach-O)", "dylib bundle", "program");
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return t("Mac program or Java class", "class dylib", "program");
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return t("Office 97–2003 file or Windows Installer (OLE)", "doc dot xls xlt ppt pot pps msg msi pub vsd", "document");
  if (startsWith(bytes, [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0])) return t("Windows shortcut", "lnk", "program");
  if (startsWith(bytes, [0, 0x61, 0x73, 0x6d])) return t("WebAssembly module", "wasm", "program");
  if (head.startsWith("SQLite format 3")) return t("SQLite database", "sqlite sqlite3 db", "data");
  if (head.startsWith("ID3") || startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3]) || startsWith(bytes, [0xff, 0xf2])) return t("MP3 audio", "mp3", "audio");
  if (head.startsWith("fLaC")) return t("FLAC audio", "flac", "audio");
  if (head.startsWith("OggS")) return t("Ogg audio or video", "ogg oga ogv opus", "audio");
  if (head.startsWith("MThd")) return t("MIDI music", "mid midi", "audio");
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(bytes, 0, 64).includes("webm") ? t("WebM video", "webm", "video") : t("Matroska video", "mkv mka", "video");
  if (head.startsWith("FLV")) return t("Flash video", "flv", "video");
  if (head.startsWith("wOFF")) return t("WOFF font", "woff", "font");
  if (head.startsWith("wOF2")) return t("WOFF2 font", "woff2", "font");
  if (head.startsWith("OTTO")) return t("OpenType font", "otf", "font");
  if (startsWith(bytes, [0, 1, 0, 0, 0])) return t("TrueType font", "ttf ttc", "font");
  if (head.startsWith("{\\rtf")) return t("Rich Text document", "rtf doc", "document");
  return textType(bytes);
}

/** Text formats, when the start of the file decodes as text. */
function textType(bytes: Uint8Array): FileType | null {
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0) && !(startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]))) return null;
  let text: string;
  try {
    const utf16 = startsWith(bytes, [0xff, 0xfe]) ? "utf-16le" : startsWith(bytes, [0xfe, 0xff]) ? "utf-16be" : "utf-8";
    text = new TextDecoder(utf16, { fatal: utf16 === "utf-8" && sample.length === bytes.length }).decode(sample).replace(/^\uFEFF/, "").trimStart();
  } catch {
    return null;
  }
  // Mostly control characters: binary data we don't know.
  if ((text.match(/[\x00-\x08\x0e-\x1f]/g) ?? []).length > text.length * 0.05) return null;
  const lower = text.slice(0, 512).toLowerCase();
  if (lower.startsWith("#!")) return t("Script (Unix shell, Python…)", TEXT_EXTENSIONS, "program");
  if (/^@?echo off/.test(lower)) return t("Windows batch script", "bat cmd", "program");
  if (lower.includes("<svg")) return t("SVG image", `svg svgz ${TEXT_EXTENSIONS}`, "image");
  if (lower.startsWith("<!doctype html") || lower.startsWith("<html")) return t("Web page (HTML)", `html htm xhtml mht ${TEXT_EXTENSIONS}`, "text");
  if (lower.startsWith("<?xml")) return t("XML document", `xml ${TEXT_EXTENSIONS} xsd xsl rss atom plist kml gpx`, "text");
  return t("Plain text", TEXT_EXTENSIONS, "text");
}

const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/;
const extensionOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase().trim() : "");

export interface FileCheck {
  type: FileType | null;
  extension: string;
  findings: Finding[];
}

export function checkFile(name: string, bytes: Uint8Array): FileCheck {
  const type = detectType(bytes);
  const extension = extensionOf(name);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  if (BIDI.test(name)) {
    const shown = name.replace(new RegExp(BIDI.source, "g"), "⟨hidden direction character⟩");
    add({ id: "bidi", severity: "high", title: "The name hides its real ending", detail: "It contains an invisible character that reverses the text after it, a trick used to make a program look like a document. The real name is:", items: [shown] });
  }
  const parts = name.toLowerCase().split(".").slice(1).map((p) => p.trim());
  if (parts.length >= 2 && PROGRAM_EXTENSIONS.has(parts[parts.length - 1]) && /^(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|zip|mp4|mp3|csv|rtf)$/.test(parts[parts.length - 2])) {
    add({ id: "double", severity: "high", title: `Double extension: “.${parts[parts.length - 2]}.${parts[parts.length - 1]}”`, detail: `It's named to look like a .${parts[parts.length - 2]} file, but the last extension decides what it is: a program.` });
  } else if (/\s{3,}\.\w+$/.test(name)) {
    add({ id: "padding", severity: "high", title: "Spaces hide the real extension", detail: "The name is padded with spaces so the real extension falls out of view." });
  }

  if (!type) {
    add({ id: "unknown", severity: "info", title: "Format not recognised", detail: "Its contents don't match any format DocSanitize knows, so the extension can't be checked." });
  } else if (extension && !type.extensions.includes(extension)) {
    const dangerous = type.category === "program";
    add({
      id: "mismatch",
      severity: dangerous || PROGRAM_EXTENSIONS.has(extension) ? "high" : "medium",
      title: `Named .${extension}, but it's really: ${type.name}`,
      detail: dangerous ? "This is a program disguised as another kind of file. Don't open it." : `Its contents are a ${type.name.toLowerCase()} (usually .${type.extensions[0]}). A wrong extension is often harmless, but it's also a way to slip files past filters.`,
    });
  } else if (!extension) {
    add({ id: "no-extension", severity: "info", title: "No extension", detail: `The contents are a ${type.name.toLowerCase()} (usually .${type.extensions[0]}).` });
  }

  if (PROGRAM_EXTENSIONS.has(extension) || type?.category === "program") {
    add({ id: "program", severity: "high", title: "Opening this runs a program or script", detail: "Only open it if you trust where it came from and expected to receive a program." });
  } else if (MACRO_EXTENSIONS.has(extension) || (type?.category === "document" && zipEntryNames(bytes).some((n) => n.endsWith("vbaProject.bin")))) {
    add({ id: "macros", severity: "medium", title: "Can contain macros", detail: "Macro code can run when the document is opened if you allow it. Keep macros disabled unless you trust the sender." });
  }

  if (type?.category === "archive" && type.name === "ZIP archive") {
    const names = zipEntryNames(bytes);
    const programs = names.filter((n) => PROGRAM_EXTENSIONS.has(extensionOf(n)));
    if (programs.length) add({ id: "zip-programs", severity: "high", title: `Contains ${plural(programs.length, "program")} or ${programs.length === 1 ? "script" : "scripts"}`, items: programs.slice(0, 40) });
    add({ id: "zip", severity: "info", title: `An archive of ${plural(names.filter((n) => !n.endsWith("/")).length, "file")}`, items: names.filter((n) => !n.endsWith("/")).slice(0, 40) });
  }
  if (type && /svg|html/i.test(type.name)) {
    const text = new TextDecoder().decode(bytes.subarray(0, 1 << 20));
    if (/<script\b|\son\w+\s*=|javascript:/i.test(text)) add({ id: "active", severity: "medium", title: "Contains scripts", detail: `${type.name.startsWith("SVG") ? "This image" : "This page"} has code that runs when it's opened in a browser.` });
  }

  return { type, extension, findings };
}
