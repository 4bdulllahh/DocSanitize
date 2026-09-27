import { contentTypes, OFFICE_DOCUMENT_REL, relationships, XML_HEADER, xmlAttr, xmlText, zipPackage } from "./ooxml";

export type CellValue = string | number | null;

export interface SheetData {
  name: string;
  rows: CellValue[][];
}

const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** Excel's limit for one cell. */
const MAX_CELL_TEXT = 32_767;

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique (case-insensitively), not blank. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 3)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(value: CellValue, ref: string): string {
  if (value === null || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : "";
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value.slice(0, MAX_CELL_TEXT))}</t></is></c>`;
}

function sheetXml(rows: CellValue[][]): string {
  // Column widths from the longest value, in characters (Excel's unit), within sensible bounds.
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((v, c) => {
      const length = v === null ? 0 : String(v).length;
      widths[c] = Math.max(widths[c] ?? 0, length);
    });
  }
  const cols = widths.length
    ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(8, w + 2))}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const data = rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(v, `${columnName(c)}${r + 1}`)).join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  return `${XML_HEADER}<worksheet ${MAIN} ${REL_NS}>${cols}<sheetData>${data}</sheetData></worksheet>`;
}

const STYLES =
  XML_HEADER +
  `<styleSheet ${MAIN}>` +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** A minimal .xlsx with inline strings. No docProps, so no author, company or dates. */
export function writeXlsx(sheets: SheetData[]): Uint8Array {
  if (sheets.length === 0) sheets = [{ name: "Sheet1", rows: [] }];
  const names = sheetNames(sheets.map((s) => s.name));
  const parts: Record<string, string> = {
    "[Content_Types].xml": contentTypes(
      { rels: "application/vnd.openxmlformats-package.relationships+xml", xml: "application/xml" },
      {
        "/xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "/xl/styles.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
        ...Object.fromEntries(
          sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"]),
        ),
      },
    ),
    "_rels/.rels": relationships([{ ...OFFICE_DOCUMENT_REL, target: "xl/workbook.xml" }]),
    "xl/_rels/workbook.xml.rels": relationships([
      ...sheets.map((_, i) => ({ id: `rId${i + 1}`, type: "worksheet", target: `worksheets/sheet${i + 1}.xml` })),
      { id: `rId${sheets.length + 1}`, type: "styles", target: "styles.xml" },
    ]),
    "xl/workbook.xml":
      `${XML_HEADER}<workbook ${MAIN} ${REL_NS}><sheets>` +
      names.map((name, i) => `<sheet name="${xmlAttr(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets></workbook>",
    "xl/styles.xml": STYLES,
  };
  sheets.forEach((sheet, i) => (parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet.rows)));
  return zipPackage(parts);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
