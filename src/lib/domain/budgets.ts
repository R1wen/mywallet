/**
 * Budgets (envelopes per category) and savings goals, pure (ADR-036, 037).
 * - An envelope caps "ma dépense réelle" of a category, its subcategories included, over a
 *   month or a year. No carry-over: each period starts again from the amount.
 * - Alert level: `warning` from the alert threshold (percent of the amount), `over` once
 *   the amount is exceeded.
 */
import { daysBetweenInclusive } from "./recurrence";
import { monthBounds } from "./dates";
import type { Cents } from "./money";

export const BUDGET_PERIODS = ["monthly", "yearly"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];
export type BudgetLevel = "ok" | "warning" | "over";
export type Bounds = { from: string; to: string };

/** The month or the year containing `day` (YYYY-MM-DD). */
export function periodBounds(period: BudgetPeriod, day: string): Bounds {
  const year = Number(day.slice(0, 4));
  if (period === "yearly") return { from: `${year}-01-01`, to: `${year}-12-31` };
  return monthBounds(year, Number(day.slice(5, 7)));
}

/** A budget counts for a period that overlaps its validity. */
export function budgetActive(b: { startsOn: string; endsOn: string | null }, bounds: Bounds) {
  return b.startsOn <= bounds.to && (b.endsOn === null || b.endsOn >= bounds.from);
}

export type BudgetStatus = { percent: number; remainingCents: Cents; level: BudgetLevel };

export function budgetStatus(b: {
  amountCents: Cents;
  spentCents: Cents;
  alertPercent: number;
}): BudgetStatus {
  const spent = Math.max(b.spentCents, 0);
  const level: BudgetLevel =
    spent > b.amountCents
      ? "over"
      : spent * 100 >= b.amountCents * b.alertPercent
        ? "warning"
        : "ok";
  return {
    percent: Math.floor((spent * 100) / b.amountCents),
    remainingCents: b.amountCents - b.spentCents,
    level,
  };
}

const RANK: Record<BudgetLevel, number> = { ok: 0, warning: 1, over: 2 };

/** The new level when a movement makes the budget cross a threshold upwards, else null. */
export function crossedLevel(before: BudgetLevel, after: BudgetLevel): BudgetLevel | null {
  return RANK[after] > RANK[before] ? after : null;
}

/** Spending expected by `today` at a steady pace (used to show whether I am ahead). */
export function expectedSpend(amountCents: Cents, bounds: Bounds, today: string): Cents {
  if (today < bounds.from) return 0;
  if (today >= bounds.to) return amountCents;
  const total = daysBetweenInclusive(bounds.from, bounds.to);
  const elapsed = daysBetweenInclusive(bounds.from, today);
  return Math.round((amountCents * elapsed) / total);
}

/**
 * Spending covered by a budget: its category and the subcategories (two levels, ADR-021),
 * or every expense for a global budget (`categoryId` null).
 */
export function spentInScope(
  categoryId: string | null,
  spentByCategory: ReadonlyMap<string | null, Cents>,
  parentOf: ReadonlyMap<string, string | null>,
): Cents {
  let total = 0;
  for (const [cat, cents] of spentByCategory) {
    if (categoryId === null || cat === categoryId || (cat && parentOf.get(cat) === categoryId)) {
      total += cents;
    }
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                       */
/* -------------------------------------------------------------------------- */

export type GoalProgress = {
  percent: number;
  remainingCents: Cents;
  achieved: boolean;
  /** Months left until the target month (at least 1 before the date, 0 once late). */
  monthsLeft: number | null;
  /** Saving needed each month to reach the target on time (rounded up). */
  monthlyNeededCents: Cents | null;
  late: boolean;
};

export function goalProgress(
  g: { targetCents: Cents; savedCents: Cents; targetDate: string | null },
  today: string,
): GoalProgress {
  const saved = Math.max(g.savedCents, 0);
  const remainingCents = Math.max(g.targetCents - saved, 0);
  const achieved = remainingCents === 0;
  const percent = Math.min(100, Math.floor((saved * 100) / g.targetCents));
  if (!g.targetDate || achieved) {
    return {
      percent,
      remainingCents,
      achieved,
      monthsLeft: null,
      monthlyNeededCents: null,
      late: false,
    };
  }
  const late = g.targetDate < today;
  const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  const monthsLeft = late ? 0 : Math.max(1, monthIndex(g.targetDate) - monthIndex(today));
  return {
    percent,
    remainingCents,
    achieved,
    monthsLeft,
    monthlyNeededCents: late ? remainingCents : Math.ceil(remainingCents / monthsLeft),
    late,
  };
}
