/**
 * Matching of bank lines (or a validated receipt) with existing transactions (ADR-028):
 * same signed amount, dates at most 3 days apart. Pure and deterministic.
 */
import { addDaysIso, daysBetweenInclusive } from "./recurrence";
import { MATCH_WINDOW_DAYS } from "./receipts/validate";

export type Matchable = { date: string; amountCents: number };
export type Candidate = Matchable & { id: string };

const distance = (a: string, b: string) =>
  a <= b ? daysBetweenInclusive(a, b) - 1 : daysBetweenInclusive(b, a) - 1;

/**
 * Returns, for each line, the id of the matched candidate or null. Pairs are assigned
 * greedily from the smallest date gap, so each candidate is used at most once and the
 * result does not depend on the order of the lines.
 */
export function matchByAmountAndDate(
  lines: readonly Matchable[],
  candidates: readonly Candidate[],
  windowDays = MATCH_WINDOW_DAYS,
): (string | null)[] {
  const pairs: { line: number; cand: number; gap: number }[] = [];
  lines.forEach((l, li) => {
    candidates.forEach((c, ci) => {
      if (c.amountCents !== l.amountCents) return;
      const gap = distance(l.date, c.date);
      if (gap <= windowDays) pairs.push({ line: li, cand: ci, gap });
    });
  });
  pairs.sort((a, b) => a.gap - b.gap || a.line - b.line || a.cand - b.cand);

  const result: (string | null)[] = lines.map(() => null);
  const used = new Set<number>();
  for (const p of pairs) {
    if (result[p.line] !== null || used.has(p.cand)) continue;
    result[p.line] = candidates[p.cand]?.id ?? null;
    used.add(p.cand);
  }
  return result;
}

/** Dates of candidate movements for lines dated between `first` and `last`. */
export function reconcileWindow(
  first: string,
  last: string,
  windowDays = MATCH_WINDOW_DAYS,
): { from: string; to: string } {
  return { from: addDaysIso(first, -windowDays), to: addDaysIso(last, windowDays) };
}
