// Interface text: collects every text to translate from the source (t("…"), t.plural(n, "…", "…"),
// msg("…"), msg`…`), finds English left unwrapped in components, and checks the catalogs.
//
//   node scripts/i18n-scan.mjs unwrapped            English in components that isn't translatable yet
//   node scripts/i18n-scan.mjs missing <lang>       keys a catalog lacks, grouped by area (JSON)
//   node scripts/i18n-scan.mjs stale <lang>         catalog entries no longer used
//   node scripts/i18n-scan.mjs index                regenerate each language's catalogs/<lang>/index.ts
//
// The unit test src/i18n/__tests__/catalogs.test.ts runs the same checks.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PLURAL_SEPARATOR = "||";
const CATALOGS = join(ROOT, "src", "i18n", "catalogs");

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "catalogs" || name === "node_modules") continue;
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) {
      yield path;
    }
  }
}

const rel = (path) => relative(ROOT, path).split(sep).join("/");

/** Which catalog file a key belongs in, from where it's first used. */
export function areaOf(file) {
  const panel = /^src\/components\/tools\/panels\/([\w-]+)\//.exec(file);
  if (panel) return panel[1] === "shared" ? "shell" : panel[1];
  const lib = /^src\/lib\/([\w-]+)\//.exec(file);
  if (lib) return `lib-${lib[1]}`;
  if (file.startsWith("src/workers/")) return "lib-workers";
  return "shell";
}

function parse(path) {
  const text = readFileSync(path, "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);

/** A msg`…` template as a key: values become {0}, {1}… */
function templateKey(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  let key = node.head.text;
  node.templateSpans.forEach((span, i) => (key += `{${i}}${span.literal.text}`));
  return key;
}

/** Errors whose message is shown to people (see src/lib/errors.ts). */
const ERRORS = new Set(["ProcessingError", "MetadataError"]);

/** The texts an error message argument can be: a literal, a msg`…`-style template, or either branch of a condition. */
function messageKeys(node) {
  if (!node) return [];
  if (ts.isParenthesizedExpression(node)) return messageKeys(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [templateKey(node)];
  if (ts.isConditionalExpression(node)) return [...messageKeys(node.whenTrue), ...messageKeys(node.whenFalse)];
  return [];
}

/** Every key in the source: Map<key, { area, files: Set, plural?: [one, other] }>. */
export function scanKeys(root = ROOT) {
  const keys = new Map();
  const add = (key, file, plural) => {
    if (!key.trim()) return;
    const entry = keys.get(key) ?? { area: areaOf(file), files: new Set(), plural };
    entry.files.add(file);
    keys.set(key, entry);
  };
  for (const path of sourceFiles(join(root, "src"))) {
    const file = rel(path);
    if (file.startsWith("src/i18n/")) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const [first, second, third] = node.arguments;
        if (ts.isIdentifier(callee) && (callee.text === "t" || callee.text === "msg")) {
          const key = literal(first);
          if (key !== null) add(key, file);
        } else if (ts.isIdentifier(callee) && callee.text === "plural" && file.startsWith("src/lib/")) {
          // The libraries' plural(n, "word", "words"?) helpers: "3 words" is matched as "{#} words".
          const one = literal(second);
          const many = third ? literal(third) : one !== null ? `${one}s` : null;
          if (one !== null && many !== null) {
            add(`{#} ${one}`, file);
            add(`{#} ${many}`, file);
          }
        } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "t" && callee.name.text === "plural") {
          const one = literal(second);
          const other = literal(third);
          if (one !== null && other !== null) add(`${one}${PLURAL_SEPARATOR}${other}`, file, [one, other]);
        }
      } else if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "msg") {
        add(templateKey(node.template), file);
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ERRORS.has(node.expression.text) && node.arguments?.length) {
        // Error messages for people are always translatable, without marking each one.
        for (const key of messageKeys(node.arguments[0])) add(key, file);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(path));
  }
  return keys;
}

// ---------------------------------------------------------------- Unwrapped English in components

/** Words that are the same in every language (names, formats, units). */
const SAME_EVERYWHERE =
  /^(DocSanitize|GitHub|PDFs?|JPG|JPEG|PNG|WebP|HEIC|HEIF|AVIF|BMP|TIFF|ICO|GIF|SVG|ZIP|MP3|MP4|M4A|WAV|FLAC|OGG|Opus|WebM|MOV|MKV|OCR|EXIF|XMP|IPTC|GPS|C2PA|SHA-?\d+|MD5|RSA|ECDSA|AES|PAdES|CMS|DOCX|XLSX|PPTX|HTML|Markdown|CSV|TXT|QR|URL|UTF-8|kbps|px|pt|dpi|mm|in|KB|MB|GB|fps|Ctrl|Shift|Alt|Enter|Esc|Tab|⌘K|A4|A3|A5|Letter|Legal|x|of)$/i;
const ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "label", "hint", "description", "detail", "text", "emptyText", "summary"]);
const PROPERTIES = new Set(["title", "description", "label", "hint", "detail", "text", "message", "summary", "noun"]);

const needsTranslation = (text) => {
  const words = text.match(/[\p{L}][\p{L}'’.-]*/gu) ?? [];
  return words.some((w) => /\p{Ll}{2,}/u.test(w) && !SAME_EVERYWHERE.test(w.replace(/[.’']+$/, "")));
};

/** English in .tsx files that doesn't go through t(): JSX text, text props, toast texts, template text. */
export function findUnwrapped(root = ROOT) {
  const found = [];
  for (const path of sourceFiles(join(root, "src"))) {
    if (!path.endsWith(".tsx")) continue;
    const file = rel(path);
    const source = parse(path);
    const lines = source.text.split("\n");
    const report = (node, text) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      if (/i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "")) return;
      found.push({ file, line: line + 1, text: text.trim().replace(/\s+/g, " ").slice(0, 100) });
    };
    const insideTranslation = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isCallExpression(p)) {
          const c = p.expression;
          if (ts.isIdentifier(c) && (c.text === "t" || c.text === "msg")) return true;
          if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "t") return true;
          // Class names, keys and other non-text arguments.
          if (ts.isIdentifier(c) && ["clsx", "cn", "useId", "require", "import", "querySelector", "querySelectorAll", "getElementById", "matchMedia", "createElement"].includes(c.text)) return true;
        }
        if (ts.isTaggedTemplateExpression(p) && ts.isIdentifier(p.tag) && p.tag.text === "msg") return true;
      }
      return false;
    };
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        if (needsTranslation(node.text)) report(node, node.text);
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        if (ATTRIBUTES.has(node.name.getText()) && needsTranslation(node.initializer.text)) report(node, node.initializer.text);
      } else if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer) || ts.isTemplateExpression(node.initializer))) {
        const name = node.name.getText().replace(/["']/g, "");
        const text = ts.isTemplateExpression(node.initializer) ? templateKey(node.initializer) : node.initializer.text;
        if (PROPERTIES.has(name) && needsTranslation(text) && !insideTranslation(node)) report(node, text);
      } else if ((ts.isStringLiteral(node) || ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !insideTranslation(node)) {
        // Text in a {…} shown on the page or in a text prop, including either side of a condition.
        let holder = node.parent;
        while (holder && (ts.isConditionalExpression(holder) || ts.isParenthesizedExpression(holder) || (ts.isBinaryExpression(holder) && ["&&", "||", "??", "+"].includes(holder.operatorToken.getText())))) holder = holder.parent;
        if (holder && ts.isJsxExpression(holder)) {
          const attr = holder.parent && ts.isJsxAttribute(holder.parent) ? holder.parent.name.getText() : null;
          const text = ts.isTemplateExpression(node) ? templateKey(node) : node.text;
          if ((attr === null || ATTRIBUTES.has(attr)) && needsTranslation(text.replace(/\{\d+\}/g, ""))) report(node, text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** Sentences in src/lib that aren't marked (a review aid: some are internal, such as log or format text). */
export function findLibSentences(root = ROOT, filter = "") {
  const found = [];
  for (const path of sourceFiles(join(root, "src"))) {
    const file = rel(path);
    if (!file.includes(filter) || file.startsWith("src/i18n/")) continue;
    const source = parse(path);
    const marked = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ["msg", "plural", "t", "clsx"].includes(p.expression.text)) return true;
        if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ts.isIdentifier(p.expression.expression) && p.expression.expression.text === "t") return true;
        if (ts.isJsxAttribute(p) && ["className", "style", "d", "points", "viewBox"].includes(p.name.getText())) return true;
        if (ts.isTaggedTemplateExpression(p) && ts.isIdentifier(p.tag) && p.tag.text === "msg") return true;
        if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && ERRORS.has(p.expression.text)) return true;
        if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
      }
      return false;
    };
    const visit = (node) => {
      let text = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) text = templateKey(node);
      if (text !== null && /\p{Ll}{2,} \p{L}{2,}/u.test(text) && !marked(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${file}:${line + 1}  ${text.slice(0, 110)}`);
      }
      if (!ts.isTemplateExpression(node) || true) ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/**
 * Mark the sentences findLibSentences reports in files matching `filter` (msg("…") around
 * strings, msg`…` for templates), except those whose text matches `skip`. Regular expressions,
 * other errors and XML are left alone. For review with git diff afterwards.
 */
/** "odt ott", "bit.ly t.co": lists of codes rather than sentences. */
const isTokenList = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 1 && !/[A-Z]/.test(text) && (words.every((w) => w.length <= 5 || w.includes(".")) || words.every((w) => w.includes(".")));
};

export function wrapLibSentences(filter, skip) {
  const byFile = new Map();
  for (const path of sourceFiles(join(ROOT, "src", "lib"))) {
    const file = rel(path);
    if (!file.includes(filter)) continue;
    const source = parse(path);
    const edits = [];
    const marked = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ["msg", "plural"].includes(p.expression.text)) return true;
        if (ts.isTaggedTemplateExpression(p)) return true;
        if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && (ERRORS.has(p.expression.text) || /Error$|RegExp/.test(p.expression.text))) return true;
        if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
      }
      return false;
    };
    const visit = (node) => {
      let text = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) text = templateKey(node);
      const parent = node.parent;
      const isKey = parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (text !== null && !isKey && /\p{Ll}{2,} \p{L}{2,}/u.test(text) && !/<\?xml|\\b|\(\?:/.test(text) && !(skip && skip.test(text)) && !isTokenList(text) && !marked(node)) {
        if (ts.isStringLiteral(node)) edits.push([node.getStart(), node.getEnd(), `msg(${node.getText()})`]);
        else edits.push([node.getStart(), node.getStart(), "msg"]);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (edits.length) byFile.set(path, { text: source.text, edits });
  }
  for (const [path, { text, edits }] of byFile) {
    let out = text;
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + replacement + out.slice(end);
    if (!out.includes('from "@/i18n/msg"')) {
      const lines = out.split("\n");
      let last = -1;
      for (let i = 0; i < lines.length; i++) if (/^import /.test(lines[i])) last = i;
      // The end of the last import statement.
      while (last >= 0 && !lines[last].trimEnd().endsWith(";")) last++;
      lines.splice(last + 1, 0, 'import { msg } from "@/i18n/msg";');
      out = lines.join("\n");
    }
    writeFileSync(path, out);
    console.log(`${rel(path)}: ${edits.length}`);
  }
}

// ---------------------------------------------------------------- Catalogs

export function catalogLanguages() {
  return readdirSync(CATALOGS).filter((name) => statSync(join(CATALOGS, name)).isDirectory());
}

/** A language's catalog files: { area: { key: translation } }. */
export function readCatalog(lang) {
  const dir = join(CATALOGS, lang);
  const areas = {};
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) areas[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, name), "utf8"));
  return areas;
}

export function missingKeys(lang, keys = scanKeys()) {
  const have = new Set(Object.values(readCatalog(lang)).flatMap((area) => Object.keys(area)));
  const byArea = {};
  for (const [key, { area, plural }] of keys) {
    if (have.has(key)) continue;
    (byArea[area] ??= {})[key] = plural ? { one: plural[0], other: plural[1] } : key;
  }
  return byArea;
}

export function staleKeys(lang, keys = scanKeys()) {
  return Object.entries(readCatalog(lang)).flatMap(([area, entries]) => Object.keys(entries).filter((k) => !keys.has(k)).map((k) => `${area}: ${k}`));
}

export function writeIndexes() {
  for (const lang of catalogLanguages()) {
    const areas = Object.keys(readCatalog(lang));
    const ident = (area) => area.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const lines = [
      "// Generated by `node scripts/i18n-scan.mjs index`: every catalog file for this language, merged.",
      'import type { Catalog } from "../../translate";',
      ...areas.map((a) => `import ${ident(a)} from "./${a}.json";`),
      "",
      `const catalog: Catalog = { ${areas.map((a) => `...${ident(a)}`).join(", ")} };`,
      "export default catalog;",
      "",
    ];
    writeFileSync(join(CATALOGS, lang, "index.ts"), lines.join("\n"));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, lang] = process.argv.slice(2);
  if (command === "unwrapped") {
    const found = findUnwrapped();
    for (const f of found) console.log(`${f.file}:${f.line}  ${f.text}`);
    console.log(`${found.length} unwrapped`);
  } else if (command === "missing") {
    console.log(JSON.stringify(missingKeys(lang), null, 2));
  } else if (command === "stale") {
    console.log(staleKeys(lang).join("\n"));
  } else if (command === "libtext") {
    const found = findLibSentences(ROOT, lang ?? "");
    console.log(found.join("\n"));
    console.log(`${found.length} unmarked sentences`);
  } else if (command === "wrap") {
    const skip = process.argv[4] ? new RegExp(process.argv[4]) : null;
    wrapLibSentences(lang ?? "", skip);
  } else if (command === "index") {
    writeIndexes();
  } else if (command === "count") {
    const keys = scanKeys();
    const areas = {};
    for (const { area } of keys.values()) areas[area] = (areas[area] ?? 0) + 1;
    console.log(keys.size, areas);
  } else {
    console.log("usage: node scripts/i18n-scan.mjs unwrapped | missing <lang> | stale <lang> | index | count");
  }
}
