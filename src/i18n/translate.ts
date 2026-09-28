import { localeInfo, type Locale } from "./locales";

/*
 * Catalogs map English text to its translation. Keys are the English text itself; `{name}` marks a
 * value filled in at run time, and `{0}`, `{1}`… the values of a msg`…` template. A plural is keyed
 * "<one>||<other>" and translated per plural category of the language (Arabic has six).
 */

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Catalog = Record<string, string | PluralForms>;
export type Params = Record<string, string | number>;

export const PLURAL_SEPARATOR = "||";
export const pluralKey = (one: string, other: string) => `${one}${PLURAL_SEPARATOR}${other}`;

export interface Translator {
  /** The translation of an English text, with `{name}` values filled in. */
  (text: string, params?: Params): string;
  /** "{n} file" / "{n} files", in the language's plural form for n (also available as {n}). */
  plural: (n: number, one: string, other: string, params?: Params) => string;
  /** Text made at run time by msg`…` (errors, findings from the workers): matched against the templates. */
  dynamic: (text: string) => string;
  number: (n: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: Date | number | string, options: Intl.DateTimeFormatOptions) => string;
  list: (items: string[], type?: "conjunction" | "disjunction") => string;
  /** A language's name in the interface language (English keeps `english`, the app's own name for it). */
  language: (bcp47: string, english: string) => string;
  locale: Locale;
  /** BCP 47 tag for Intl (Arabic keeps Latin digits). */
  tag: string;
  dir: "ltr" | "rtl";
}

interface Template {
  pattern: RegExp;
  translation: string;
  /** Its only value is a count ({#}). */
  countOnly: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Templates with positional values ({0}, {1}…, {#} for a count) as patterns, most specific (longest) first. */
function templatesOf(catalog: Catalog): Template[] {
  return Object.entries(catalog)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /\{(\d+|#)\}/.test(entry[0]))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([key, translation]) => {
      // "{#} files" (a count, from the libraries' plural helpers) only matches a number, so a
      // name such as "My files" inside another text is never taken for one.
      const parts = key.split(/\{(\d+|#)\}/);
      let source = "^";
      const order: string[] = [];
      parts.forEach((part, i) => {
        if (i % 2 === 0) source += escape(part);
        else {
          order.push(part);
          source += part === "#" ? "(\\d[\\d,.\\u00a0\\u202f]*)" : "([\\s\\S]*?)";
        }
      });
      const pattern = new RegExp(`${source}$`);
      // Remember which capture holds which value, so translations may reorder them.
      return { pattern: Object.assign(pattern, { order }), translation, countOnly: order.every((o) => o === "#") };
    });
}

export function createTranslator(locale: Locale, catalog: Catalog = {}): Translator {
  const { tag, dir } = localeInfo(locale);
  const numbers = new Intl.NumberFormat(tag);
  const rules = new Intl.PluralRules(tag);
  let templates: Template[] | null = null;

  const fill = (text: string, params?: Params) =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? (typeof params[name] === "number" ? numbers.format(params[name]) : String(params[name])) : whole)) : text;

  const t = ((text: string, params?: Params) => {
    const found = catalog[text];
    return fill(typeof found === "string" ? found : text, params);
  }) as Translator;

  t.plural = (n, one, other, params) => {
    const found = catalog[pluralKey(one, other)];
    const category = rules.select(n);
    const form = found && typeof found === "object" ? (found[category] ?? found.other) : category === "one" ? one : other;
    return fill(form, { n, ...params });
  };

  const dynamic = (text: string, depth: number): string => {
    // Keep surrounding spaces: sentence fragments are joined with them.
    const core = text.trim();
    if (!core) return text;
    const pad = (translated: string) => text.slice(0, text.indexOf(core)) + translated + text.slice(text.indexOf(core) + core.length);
    const found = catalog[core];
    if (typeof found === "string") return pad(found);
    if (depth > 3) return text;
    templates ??= templatesOf(catalog);
    for (const { pattern, translation, countOnly } of templates) {
      // Inside another text, only counts ("3 pages") are rebuilt: a value such as a comment or a
      // file name that happens to read like a template ("Send to Bob") is left alone.
      if (depth > 0 && !countOnly) continue;
      const match = pattern.exec(core);
      if (!match) continue;
      const order = (pattern as RegExp & { order: string[] }).order;
      const values: Record<string, string> = {};
      // Values can be texts made the same way ("3 earlier versions"): translate them too.
      order.forEach((index, i) => (values[index] = dynamic(match[i + 1], depth + 1)));
      return pad(translation.replace(/\{(\d+|#)\}/g, (whole, i: string) => values[i] ?? whole));
    }
    return text;
  };
  t.dynamic = (text) => (locale === "en" ? text : dynamic(text, 0));

  t.number = (n, options) => (options ? new Intl.NumberFormat(tag, options).format(n) : numbers.format(n));
  t.date = (value, options) => new Intl.DateTimeFormat(tag, options).format(new Date(value));
  t.list = (items, type = "conjunction") => new Intl.ListFormat(tag, { type }).format(items);
  let languages: Intl.DisplayNames | null = null;
  t.language = (bcp47, english) => {
    if (locale === "en") return english;
    try {
      languages ??= new Intl.DisplayNames([tag], { type: "language" });
      const name = languages.of(bcp47);
      return name && name !== bcp47 ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : english;
    } catch {
      return english;
    }
  };
  t.locale = locale;
  t.tag = tag;
  t.dir = dir;
  return t;
}
