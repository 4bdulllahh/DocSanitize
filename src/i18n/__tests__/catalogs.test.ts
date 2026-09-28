import { describe, expect, it } from "vitest";
import { catalogLanguages, findUnwrapped, PLURAL_SEPARATOR, readCatalog, scanKeys } from "../../../scripts/i18n-scan.mjs";
import { LOCALE_CODES, localeInfo } from "../locales";

type Entry = string | Record<string, string>;
const keys: Map<string, { area: string; plural?: [string, string] }> = scanKeys();
const placeholders = (text: string) => new Set(text.match(/\{[\w#]+\}/g) ?? []);

describe("interface text", () => {
  it("has no English left out of translation in the components", () => {
    const found: { file: string; line: number; text: string }[] = findUnwrapped();
    expect(found.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it("has a catalog for every language but English", () => {
    expect(catalogLanguages().sort()).toEqual(LOCALE_CODES.filter((c) => c !== "en").sort());
  });
});

describe.each(LOCALE_CODES.filter((c) => c !== "en"))("the %s catalog", (lang) => {
  const areas = readCatalog(lang) as Record<string, Record<string, Entry>>;
  const entries = Object.entries(areas).flatMap(([area, texts]) => Object.entries(texts).map(([key, value]) => ({ area, key, value })));
  const categories = new Intl.PluralRules(localeInfo(lang).tag).resolvedOptions().pluralCategories;

  it("translates every text, once", () => {
    const have = new Set(entries.map((e) => e.key));
    expect([...keys.keys()].filter((k) => !have.has(k))).toEqual([]);
    const seen = new Set<string>();
    expect(entries.filter((e) => (seen.has(e.key) ? true : (seen.add(e.key), false))).map((e) => e.key)).toEqual([]);
  });

  it("has nothing that's no longer used", () => {
    expect(entries.filter((e) => !keys.has(e.key)).map((e) => `${e.area}: ${e.key}`)).toEqual([]);
  });

  it("keeps the values to fill in, and every plural form the language needs", () => {
    const problems: string[] = [];
    for (const { key, value } of entries) {
      const plural = keys.get(key)?.plural;
      if (plural) {
        if (typeof value !== "object") {
          problems.push(`${key}: needs plural forms`);
          continue;
        }
        const allowed = new Set([...placeholders(plural[0]), ...placeholders(plural[1])]);
        for (const category of categories) if (!(category in value)) problems.push(`${key}: missing “${category}”`);
        for (const [category, form] of Object.entries(value)) {
          for (const p of placeholders(form)) if (!allowed.has(p)) problems.push(`${key} (${category}): unknown ${p}`);
          // The count may be left out of a form that names it ("one file"), but other values may not.
          for (const p of allowed) if (p !== "{n}" && !placeholders(form).has(p)) problems.push(`${key} (${category}): lost ${p}`);
        }
      } else {
        if (typeof value !== "string" || !value.trim()) {
          problems.push(`${key}: empty or not text`);
          continue;
        }
        const want = placeholders(key);
        const got = placeholders(value);
        // A template's {1}-style value may be dropped when it only spells an English ending ("s").
        for (const p of want) if (!got.has(p) && !/^\{[1-9]\}$/.test(p)) problems.push(`${key}: lost ${p}`);
        for (const p of got) if (!want.has(p)) problems.push(`${key}: unknown ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

it("uses the plural key separator the translator expects", () => {
  expect(PLURAL_SEPARATOR).toBe("||");
});
