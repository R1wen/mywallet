/**
 * Bank statement CSV import (pure): decoding, CSV parsing, header detection, column
 * mapping and line extraction. French bank exports vary (separator, encoding, preamble
 * lines, one amount column or debit/credit columns); the user can always fix the mapping.
 */
import { parseReceiptDate } from "./receipts/parse";

export type ColumnMapping = {
  date: number;
  label: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
};

export type BankLine = { row: number; date: string; label: string; amountCents: number };
export type BankLineError = { row: number; message: string };

/** UTF-8 when valid, otherwise Windows-1252 (common in French bank exports). */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

const DELIMITERS = [";", ",", "\t", "|"] as const;

function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((v) => v.trim()));
}

/** Parses CSV text, picking the delimiter that gives the most consistent wide rows. */
export function parseCsv(text: string): { delimiter: string; rows: string[][] } {
  const sample = text.slice(0, 20_000);
  let best: { delimiter: string; score: number } = { delimiter: ";", score: -1 };
  for (const d of DELIMITERS) {
    const rows = splitRows(sample, d).filter((r) => r.length > 1);
    if (!rows.length) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    const [width, freq] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [
      0, 0,
    ];
    const score = freq * width;
    if (score > best.score) best = { delimiter: d, score };
  }
  return { delimiter: best.delimiter, rows: splitRows(text, best.delimiter) };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Normalized header joined with "|", used as the key of a saved column preset. */
export function headerSignature(header: readonly string[]): string {
  return header.map(norm).join("|");
}

const DATE_HEADERS =
  /^(date( (d )?(operation|op|comptable|comptabilisation|transaction))?|dateop|date de l operation)$/;
const VALUE_DATE = /valeur/;
const LABEL_HEADERS = /libelle|description|label|detail|intitule|nature|operation$|motif/;
const AMOUNT_HEADERS = /^(montant|amount|somme|valeur eur)/;
const DEBIT_HEADERS = /^debit/;
const CREDIT_HEADERS = /^credit/;

/** Guesses the columns from header names; null if no date or amount column is found. */
export function guessMapping(header: readonly string[]): ColumnMapping | null {
  const h = header.map(norm);
  const find = (re: RegExp, skip: (s: string) => boolean = () => false) =>
    h.findIndex((s) => re.test(s) && !skip(s));
  let date = find(DATE_HEADERS, (s) => VALUE_DATE.test(s));
  if (date < 0) date = find(/date/, (s) => VALUE_DATE.test(s));
  const amount = find(AMOUNT_HEADERS);
  const debit = find(DEBIT_HEADERS);
  const credit = find(CREDIT_HEADERS);
  const label = h.findIndex((s, i) => i !== date && LABEL_HEADERS.test(s) && !/date/.test(s));
  if (date < 0 || label < 0) return null;
  if (amount < 0 && (debit < 0 || credit < 0)) return null;
  return {
    date,
    label,
    amount: amount >= 0 ? amount : null,
    debit: amount >= 0 ? null : debit,
    credit: amount >= 0 ? null : credit,
  };
}

/** Index of the header row (bank exports often start with account info lines), or -1. */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  return rows.slice(0, 30).findIndex((r) => r.length >= 3 && guessMapping(r) !== null);
}

/** Parses a bank amount in French or English notation to cents, or null. */
export function parseBankAmount(input: string): number | null {
  let s = input.replace(/[\s  €]|EUR/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-+]/.test(s)) {
    negative = s.startsWith("-");
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let decPart = "";
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = Math.max(lastComma, lastDot);
    intPart = s.slice(0, dec).replace(/[.,]/g, "");
    decPart = s.slice(dec + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (sep === "," || !parts.slice(1).every((p) => p.length === 3)) return null;
      intPart = parts.join("");
    } else {
      intPart = parts[0] ?? "";
      decPart = parts[1] ?? "";
    }
  } else intPart = s;
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Extracts dated, signed lines below the header row. Row numbers are 1-based. */
export function extractBankLines(
  rows: readonly (readonly string[])[],
  headerIndex: number,
  mapping: ColumnMapping,
): { lines: BankLine[]; errors: BankLineError[] } {
  const lines: BankLine[] = [];
  const errors: BankLineError[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => c === "")) continue;
    const row = i + 1;
    const date = parseReceiptDate(r[mapping.date] ?? "");
    if (!date) {
      errors.push({ row, message: "Date illisible." });
      continue;
    }
    let amountCents: number | null;
    if (mapping.amount !== null) {
      amountCents = parseBankAmount(r[mapping.amount] ?? "");
    } else {
      const debit = parseBankAmount(r[mapping.debit ?? -1] ?? "");
      const credit = parseBankAmount(r[mapping.credit ?? -1] ?? "");
      amountCents = debit ? -Math.abs(debit) : credit !== null ? Math.abs(credit) : null;
    }
    if (amountCents === null) {
      errors.push({ row, message: "Montant illisible." });
      continue;
    }
    if (amountCents === 0) continue;
    const label = (r[mapping.label] ?? "").replace(/\s+/g, " ").trim() || "Sans libellé";
    lines.push({ row, date, label: label.slice(0, 200), amountCents });
  }
  return { lines, errors };
}

/**
 * Idempotency keys for imported lines (ADR-028): account, date, amount, normalized label
 * and the rank among identical lines, so re-importing an overlapping statement skips
 * lines already imported while two identical purchases on the same day both count.
 */
export function bankLineKeys(accountId: string, lines: readonly BankLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = `${accountId}|${l.date}|${l.amountCents}|${norm(l.label)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}
