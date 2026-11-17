import { strToU8, zipSync } from "fflate";

/** Bytes in this realm's Uint8Array (fflate checks `instanceof`). */
const bytes = (text: string) => new Uint8Array(strToU8(text));

/**
 * Minimal single-sheet XLSX writer (ADR-042): text cells as inline strings, numbers as
 * numbers with a format, a bold frozen header. Enough for exports, with no heavy
 * dependency. Text never becomes a formula: cells are always written as strings.
 */

export type XlsxColumn = { label: string; width?: number; type?: "text" | "money" | "date" };
type Cell = string | number | null;

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
// Characters not allowed in XML 1.0 are dropped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string) => s.replace(INVALID_XML, "").replace(/[&<>"]/g, (c) => XML_ESCAPES[c]!);

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel serial number of a "YYYY-MM-DD" day (1900 date system). */
function excelDate(day: string): number {
  const ms = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  return ms / 86_400_000 + 25_569;
}

/** Styles: 0 default, 1 bold header, 2 money "# ##0,00 €", 3 date "dd/mm/yyyy". */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`;

export function buildXlsx(
  sheetName: string,
  columns: readonly XlsxColumn[],
  rows: readonly Cell[][],
): Uint8Array {
  const cell = (ref: string, value: Cell, type: XlsxColumn["type"], header = false): string => {
    if (value === null || value === "") return "";
    if (header)
      return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(String(value))}</t></is></c>`;
    if (type === "money" && typeof value === "number")
      return `<c r="${ref}" s="2"><v>${value}</v></c>`;
    if (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `<c r="${ref}" s="3"><v>${excelDate(value)}</v></c>`;
    }
    if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  };
  const all = [columns.map((c) => c.label), ...rows];
  const sheetRows = all
    .map((r, i) => {
      const cells = r
        .map((v, j) => cell(`${columnName(j)}${i + 1}`, v, columns[j]?.type, i === 0))
        .join("");
      return `<row r="${i + 1}">${cells}</row>`;
    })
    .join("");
  const cols = columns
    .map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const name = esc(sheetName.slice(0, 31));
  return zipSync({
    "[Content_Types].xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": bytes(sheet),
    "xl/styles.xml": bytes(STYLES),
  });
}
