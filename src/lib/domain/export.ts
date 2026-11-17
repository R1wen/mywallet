/**
 * Exports and account deletion (pure, ADR-042, 043).
 * CSV follows French spreadsheet habits: UTF-8 BOM, ";" separator, CRLF, decimal comma.
 * Cells that a spreadsheet would run as a formula (= + - @, tab, CR) are prefixed with
 * an apostrophe so a label typed on a receipt can never execute in Excel or Calc.
 */

const NEEDS_QUOTES = /[";\r\n]/;
const FORMULA = /^[=+\-@\t\r]/;

export type CsvColumn<K extends string = string> = { key: K; label: string; amount?: boolean };

export function csvCell(
  value: string | number | null | undefined,
  opts: { amount?: boolean } = {},
): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Our own signed amounts ("-12,50") are numbers, not formulas.
  if (typeof value === "string" && !opts.amount && FORMULA.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) || s.startsWith("'=") ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<K extends string>(
  columns: readonly CsvColumn<K>[],
  rows: readonly Record<K, string | number | null>[],
): string {
  const lines = [
    columns.map((c) => csvCell(c.label)).join(";"),
    ...rows.map((r) => columns.map((c) => csvCell(r[c.key], { amount: c.amount })).join(";")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Delay before an account asked for deletion is erased (ADR-043). */
export const DELETION_DELAY_DAYS = 7;

export function purgeDate(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_DELAY_DAYS * 24 * 60 * 60 * 1000);
}
