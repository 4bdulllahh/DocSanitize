import { describe, expect, it } from "vitest";
import { pickLocale } from "../locales";
import { msg } from "../msg";
import { createTranslator, pluralKey } from "../translate";

describe("msg", () => {
  it("returns English text unchanged, with template values filled in", () => {
    expect(msg("Merge PDF")).toBe("Merge PDF");
    const n = 3;
    expect(msg`Page ${n} doesn't exist.`).toBe("Page 3 doesn't exist.");
  });
});

describe("the translator", () => {
  const catalog = {
    "Download result": "Ergebnis herunterladen",
    "Close {name}": "{name} schließen",
    [pluralKey("{n} file", "{n} files")]: { one: "{n} Datei", other: "{n} Dateien" },
    "Page {0} doesn't exist.": "Seite {0} gibt es nicht.",
    "{0} saved inside the file": "{0} in der Datei gespeichert",
    "{#} earlier version": "{#} frühere Version",
    "{#} earlier versions": "{#} frühere Versionen",
    "Page {0}: “{1}”": "Seite {0}: „{1}“",
    "{#} files": "{#} Dateien",
    "From {0} to {1}": "Nach {1} von {0}",
  };
  const de = createTranslator("de", catalog);
  const en = createTranslator("en");

  it("translates and fills in values", () => {
    expect(de("Download result")).toBe("Ergebnis herunterladen");
    expect(de("Close {name}", { name: "a.pdf" })).toBe("a.pdf schließen");
    expect(de("Not in the catalog")).toBe("Not in the catalog");
    expect(en("Close {name}", { name: "a.pdf" })).toBe("Close a.pdf");
  });

  it("formats numbers for the language", () => {
    expect(de("Close {name}", { name: 12345 })).toBe("12.345 schließen");
    expect(createTranslator("ar").number(1234)).toBe("1,234");
  });

  it("picks plural forms by the language's rules", () => {
    expect(de.plural(1, "{n} file", "{n} files")).toBe("1 Datei");
    expect(de.plural(4, "{n} file", "{n} files")).toBe("4 Dateien");
    expect(en.plural(1, "{n} file", "{n} files")).toBe("1 file");
    expect(en.plural(0, "{n} file", "{n} files")).toBe("0 files");
    const ar = createTranslator("ar", { [pluralKey("{n} file", "{n} files")]: { zero: "لا ملفات", one: "ملف واحد", two: "ملفان", few: "{n} ملفات", many: "{n} ملفًا", other: "{n} ملف" } });
    expect([0, 1, 2, 3, 11, 100].map((n) => ar.plural(n, "{n} file", "{n} files"))).toEqual(["لا ملفات", "ملف واحد", "ملفان", "3 ملفات", "11 ملفًا", "100 ملف"]);
  });

  it("translates text made at run time, including the values inside it", () => {
    expect(de.dynamic("Page 7 doesn't exist.")).toBe("Seite 7 gibt es nicht.");
    expect(de.dynamic("3 earlier versions saved inside the file")).toBe("3 frühere Versionen in der Datei gespeichert");
    expect(de.dynamic("Download result")).toBe("Ergebnis herunterladen");
    expect(de.dynamic("  Download result ")).toBe("  Ergebnis herunterladen ");
    expect(de.dynamic("From Paris to Rome")).toBe("Nach Rome von Paris");
    expect(de.dynamic("Something else")).toBe("Something else");
    expect(en.dynamic("Page 7 doesn't exist.")).toBe("Page 7 doesn't exist.");
  });

  it("only takes numbers for counts, so names inside a text stay as they are", () => {
    expect(de.dynamic("Page 2: “My files”")).toBe("Seite 2: „My files“");
    expect(de.dynamic("12 files")).toBe("12 Dateien");
    // A comment that reads like a template isn't rebuilt.
    expect(de.dynamic("Page 2: “From Paris to Rome”")).toBe("Seite 2: „From Paris to Rome“");
  });
});

describe("choosing a language", () => {
  it("uses the first supported browser language", () => {
    expect(pickLocale(["de-AT", "en"])).toBe("de");
    expect(pickLocale(["pt-BR", "fr-CA"])).toBe("fr");
    expect(pickLocale(["ar-EG"])).toBe("ar");
    expect(pickLocale(["zh-CN"])).toBe("en");
    expect(pickLocale([])).toBe("en");
  });
});
