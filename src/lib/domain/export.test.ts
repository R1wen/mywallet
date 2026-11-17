import { describe, expect, it } from "vitest";
import { csvCell, purgeDate, toCsv } from "./export";

describe("csvCell", () => {
  it.each([
    ["simple", "simple"],
    ["a;b", '"a;b"'],
    ['dit "bonjour"', '"dit ""bonjour"""'],
    ["ligne\nsuivante", '"ligne\nsuivante"'],
    // Spreadsheet formula injection: the cell is read as text.
    ['=HYPERLINK("x")', '\'=HYPERLINK(""x"")'],
    ["+33 6", "'+33 6"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["-cmd", "'-cmd"],
    [null, ""],
  ])("%j -> %s", (value, cell) => {
    expect(csvCell(value)).toBe(cell.startsWith("'=") ? `"${cell}"` : cell);
  });

  it("keeps numbers and signed amounts as they are", () => {
    expect(csvCell(-1250)).toBe("-1250");
    expect(csvCell("-12,50", { amount: true })).toBe("-12,50");
  });
});

describe("toCsv", () => {
  it("writes a French CSV: BOM, semicolons, CRLF", () => {
    const csv = toCsv(
      [
        { key: "date", label: "Date" },
        { key: "label", label: "Libellé" },
        { key: "amount", label: "Montant", amount: true },
      ],
      [
        { date: "2026-11-17", label: "Carrefour; Market", amount: "-12,50" },
        { date: "2026-11-18", label: "Salaire", amount: "2100,00" },
      ],
    );
    expect(csv).toBe(
      '﻿Date;Libellé;Montant\r\n2026-11-17;"Carrefour; Market";-12,50\r\n2026-11-18;Salaire;2100,00\r\n',
    );
  });
});

describe("purgeDate", () => {
  it("purges seven days after the request", () => {
    expect(purgeDate(new Date("2026-11-17T10:00:00Z")).toISOString()).toBe(
      "2026-11-24T10:00:00.000Z",
    );
  });
});
