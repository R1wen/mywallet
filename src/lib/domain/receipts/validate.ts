/**
 * Deterministic checks of an extracted receipt (pure). Produces a confidence score per
 * field and French messages shown on the review screen. Nothing here saves data.
 */
import { formatCents } from "../money";
import { normalizeMerchantName } from "../merchant";
import { addDaysIso, daysBetweenInclusive } from "../recurrence";
import type { ParsedReceipt } from "./parse";

export type ReviewField = "merchant" | "date" | "total" | "items" | "vat";
export type ReceiptIssue = { field: ReviewField; message: string };
export type ConfidenceLevel = "high" | "medium" | "low";

export type ReceiptValidation = {
  confidence: Record<ReviewField, number>;
  issues: ReceiptIssue[];
  level: ConfidenceLevel;
};

/** 1 cent per item line (rounding of weighed items), at least 2 cents. */
const itemsTolerance = (count: number) => Math.max(2, count);
const MAX_TOTAL_CENTS = 10_000_000;

export function validateReceipt(r: ParsedReceipt, today: string): ReceiptValidation {
  const issues: ReceiptIssue[] = [];
  const confidence: Record<ReviewField, number> = {
    merchant: 1,
    date: 1,
    total: 1,
    items: 1,
    vat: 1,
  };

  if (!r.merchantRaw) {
    confidence.merchant = 0;
    issues.push({ field: "merchant", message: "Magasin introuvable." });
  }

  if (!r.date) {
    confidence.date = 0;
    issues.push({ field: "date", message: "Date introuvable." });
  } else if (r.date > today) {
    confidence.date = 0.2;
    issues.push({ field: "date", message: "Date dans le futur." });
  } else if (daysBetweenInclusive(r.date, today) > 2 * 366) {
    confidence.date = 0.5;
    issues.push({ field: "date", message: "Date ancienne (plus de 2 ans)." });
  }

  if (r.totalCents === null) {
    confidence.total = 0;
    issues.push({ field: "total", message: "Total introuvable." });
  } else if (r.totalCents <= 0 || r.totalCents > MAX_TOTAL_CENTS) {
    confidence.total = 0;
    issues.push({ field: "total", message: "Total illisible." });
  }

  if (!r.items.length) {
    confidence.items = 0.5;
  } else if (r.totalCents !== null) {
    const sum = r.items.reduce((s, i) => s + i.totalCents, 0) + r.discountsCents;
    if (Math.abs(sum - r.totalCents) > itemsTolerance(r.items.length)) {
      confidence.items = 0.3;
      if (confidence.total === 1) confidence.total = 0.6;
      issues.push({
        field: "items",
        message: `La somme des articles (${formatCents(sum)}) diffère du total (${formatCents(r.totalCents)}).`,
      });
    }
  }

  if (!r.vat.length) {
    confidence.vat = 0.5;
  } else {
    const rateOk = r.vat.every(
      (v) => Math.abs(Math.round((v.baseCents * v.rateBp) / 10_000) - v.vatCents) <= 2,
    );
    const ttc = r.vat.reduce((s, v) => s + v.baseCents + v.vatCents, 0);
    const totalOk = r.totalCents === null || Math.abs(ttc - r.totalCents) <= r.vat.length * 2;
    if (!rateOk || !totalOk) {
      confidence.vat = 0.3;
      issues.push({
        field: "vat",
        message: rateOk
          ? "Les lignes de TVA ne correspondent pas au total."
          : "Le montant de TVA ne correspond pas au taux.",
      });
    }
  }

  const values = Object.values(confidence);
  const min = Math.min(...values);
  const level: ConfidenceLevel =
    confidence.total === 0 || confidence.date === 0 || min < 0.5
      ? "low"
      : min < 1
        ? "medium"
        : "high";
  return { confidence, issues, level };
}

/** Key used to spot the same purchase uploaded twice (another photo of the same ticket). */
export function duplicateKey(
  merchant: string | null,
  date: string | null,
  totalCents: number | null,
): string | null {
  if (!merchant || !date || totalCents === null) return null;
  // First word only: "CARREFOUR MARKET 0123" and "Carrefour" are the same shop.
  const first = normalizeMerchantName(merchant).split(" ")[0] ?? "";
  return `${first}|${date}|${totalCents}`;
}

/** Days around a receipt date in which a bank line may be matched (ADR-028). */
export const MATCH_WINDOW_DAYS = 3;

export function dateWindow(date: string): { from: string; to: string } {
  return { from: addDaysIso(date, -MATCH_WINDOW_DAYS), to: addDaysIso(date, MATCH_WINDOW_DAYS) };
}
