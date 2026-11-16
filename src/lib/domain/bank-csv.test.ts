import { describe, expect, it } from "vitest";
import {
  bankLineKeys,
  decodeCsv,
  extractBankLines,
  findHeaderRow,
  guessMapping,
  headerSignature,
  parseBankAmount,
  parseCsv,
} from "./bank-csv";

describe("decodeCsv", () => {
  it("strips the UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Libellé;x")]);
    expect(decodeCsv(bytes)).toBe("Libellé;x");
  });

  it("falls back to Windows-1252 for old bank exports", () => {
    // "Libellé" in Windows-1252: é = 0xE9
    const bytes = new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9]);
    expect(decodeCsv(bytes)).toBe("Libellé");
  });
});

describe("parseCsv", () => {
  it("detects the semicolon and handles quotes", () => {
    const { delimiter, rows } = parseCsv(
      'Date;Libellé;Montant\r\n01/11/2026;"CB ""LECLERC""; DRIVE";-45,20\r\n02/11/2026;VIR SALAIRE;2 100,00\r\n',
    );
    expect(delimiter).toBe(";");
    expect(rows).toEqual([
      ["Date", "Libellé", "Montant"],
      ["01/11/2026", 'CB "LECLERC"; DRIVE', "-45,20"],
      ["02/11/2026", "VIR SALAIRE", "2 100,00"],
    ]);
  });

  it("detects commas and tabs", () => {
    expect(parseCsv("a,b,c\n1,2,3").delimiter).toBe(",");
    expect(parseCsv("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
  });

  it("keeps a newline inside a quoted cell", () => {
    expect(parseCsv('a;b\n"x\ny";2').rows).toEqual([
      ["a", "b"],
      ["x\ny", "2"],
    ]);
  });
});

describe("parseBankAmount", () => {
  it.each([
    ["-45,20", -4520],
    ["2 100,00", 210000],
    ["2 100,00 €", 210000],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["-12.5", -1250],
    ["+3", 300],
    ["(12,00)", -1200],
    ["", null],
    ["abc", null],
    ["1,2,3", null],
  ])("%j -> %j", (input, expected) => {
    expect(parseBankAmount(input)).toBe(expected);
  });
});

const PREAMBLE_EXPORT = [
  ["Compte courant", "FR76 **** 1234"],
  ["Solde au 16/11/2026", "1 234,56"],
  [""],
  ["Date opération", "Date valeur", "Libellé", "Débit", "Crédit"],
  ["03/11/2026", "03/11/2026", "PRLV SEPA EDF", "78,40", ""],
  ["05/11/2026", "05/11/2026", "VIR SALAIRE ACME", "", "2 100,00"],
  ["06/11/2026", "06/11/2026", "CB CARREFOUR 05/11", "-45,20", ""],
  ["bad date", "", "X", "1,00", ""],
];

describe("header detection and mapping", () => {
  it("skips the preamble and maps debit/credit columns", () => {
    const header = findHeaderRow(PREAMBLE_EXPORT);
    expect(header).toBe(3);
    const mapping = guessMapping(PREAMBLE_EXPORT[header] ?? []);
    expect(mapping).toEqual({ date: 0, label: 2, amount: null, debit: 3, credit: 4 });
  });

  it("maps a single amount column", () => {
    expect(guessMapping(["Date", "Description", "Montant (EUR)", "Catégorie"])).toEqual({
      date: 0,
      label: 1,
      amount: 2,
      debit: null,
      credit: null,
    });
  });

  it("returns null when no date or amount column exists", () => {
    expect(guessMapping(["Nom", "Ville"])).toBeNull();
    expect(findHeaderRow([["a", "b"]])).toBe(-1);
  });

  it("builds a stable signature for presets", () => {
    expect(headerSignature([" Date opération", "LIBELLE ", "Débit", "Crédit"])).toBe(
      "date operation|libelle|debit|credit",
    );
  });
});

describe("extractBankLines", () => {
  it("signs debit and credit and reports bad rows", () => {
    const mapping = { date: 0, label: 2, amount: null, debit: 3, credit: 4 };
    const r = extractBankLines(PREAMBLE_EXPORT, 3, mapping);
    expect(r.lines).toEqual([
      { row: 5, date: "2026-11-03", label: "PRLV SEPA EDF", amountCents: -7840 },
      { row: 6, date: "2026-11-05", label: "VIR SALAIRE ACME", amountCents: 210000 },
      { row: 7, date: "2026-11-06", label: "CB CARREFOUR 05/11", amountCents: -4520 },
    ]);
    expect(r.errors).toEqual([{ row: 8, message: "Date illisible." }]);
  });

  it("skips empty rows and zero amounts", () => {
    const rows = [
      ["Date", "Libellé", "Montant"],
      ["", "", ""],
      ["01/11/2026", "INFO", "0,00"],
      ["01/11/2026", "", "-3,00"],
    ];
    const r = extractBankLines(rows, 0, {
      date: 0,
      label: 1,
      amount: 2,
      debit: null,
      credit: null,
    });
    expect(r.lines).toEqual([
      { row: 4, date: "2026-11-01", label: "Sans libellé", amountCents: -300 },
    ]);
    expect(r.errors).toEqual([]);
  });
});

describe("bankLineKeys", () => {
  it("numbers identical lines so two same-day coffees are both kept", () => {
    const line = { row: 2, date: "2026-11-01", label: "CB CAFE  DU COIN", amountCents: -250 };
    const keys = bankLineKeys("acc", [line, { ...line, row: 3 }, { ...line, amountCents: -300 }]);
    expect(keys).toEqual([
      "acc|2026-11-01|-250|cb cafe du coin|1",
      "acc|2026-11-01|-250|cb cafe du coin|2",
      "acc|2026-11-01|-300|cb cafe du coin|1",
    ]);
  });
});
