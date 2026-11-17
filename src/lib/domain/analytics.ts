/**
 * Analyses (pure, ADR-039): month comparison, forgotten or rising subscriptions, unusual
 * expenses, end-of-month forecast, "et si" simulator, return and warranty deadlines.
 * Amounts are positive cents of "ma dépense réelle" unless stated otherwise.
 */
import { normalizeText } from "./categorize";
import { daysInMonth } from "./dates";
import type { Cents } from "./money";
import { daysBetweenInclusive } from "./recurrence";

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const daysFrom = (a: string, b: string) =>
  a <= b ? daysBetweenInclusive(a, b) - 1 : -(daysBetweenInclusive(b, a) - 1);

/* -------------------------------------------------------------------------- */
/* Month comparison                                                            */
/* -------------------------------------------------------------------------- */

export type CategoryComparison = {
  categoryId: string | null;
  currentCents: Cents;
  previousCents: Cents;
  /** Average of the months before (3 by default). */
  averageCents: Cents;
  deltaCents: Cents;
  /** Change against last month in percent, null when last month was 0. */
  deltaPercent: number | null;
};

export function compareCategories(
  current: ReadonlyMap<string | null, Cents>,
  previous: ReadonlyMap<string | null, Cents>,
  average: ReadonlyMap<string | null, Cents>,
): CategoryComparison[] {
  const keys = new Set([...current.keys(), ...previous.keys()]);
  return [...keys]
    .map((categoryId) => {
      const currentCents = current.get(categoryId) ?? 0;
      const previousCents = previous.get(categoryId) ?? 0;
      const deltaCents = currentCents - previousCents;
      return {
        categoryId,
        currentCents,
        previousCents,
        averageCents: average.get(categoryId) ?? 0,
        deltaCents,
        deltaPercent: previousCents > 0 ? Math.round((deltaCents * 100) / previousCents) : null,
      };
    })
    .filter((r) => r.currentCents !== 0 || r.previousCents !== 0)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}

/* -------------------------------------------------------------------------- */
/* Subscriptions                                                               */
/* -------------------------------------------------------------------------- */

export type Charge = {
  id: string;
  date: string;
  amountCents: Cents;
  merchantId: string | null;
  label: string;
};

/** Same merchant, or same label once dates and references are removed. */
export function subscriptionKey(c: { merchantId: string | null; label: string }): string {
  if (c.merchantId) return `m:${c.merchantId}`;
  const words = normalizeText(c.label)
    .split(" ")
    .filter((w) => w && !/\d/.test(w));
  return `l:${words.join(" ")}`;
}

export type Subscription = {
  key: string;
  merchantId: string | null;
  label: string;
  count: number;
  firstDate: string;
  lastDate: string;
  lastAmountCents: Cents;
  /** Price before the current one (the same when it never changed). */
  previousAmountCents: Cents;
  increase: { fromCents: Cents; toCents: Cents; sinceDate: string } | null;
  nextDate: string;
  dayOfMonth: number;
};

const MIN_CHARGES = 3;
const MIN_GAP = 25;
const MAX_GAP = 35;
/** A charge missing for longer than this means the subscription stopped. */
const STOPPED_AFTER_DAYS = 40;
/** Amounts may vary by this share of the median (taxes, small price changes). */
const AMOUNT_TOLERANCE = 0.2;

function nextMonthly(last: string, day: number): string {
  let y = Number(last.slice(0, 4));
  let m = Number(last.slice(5, 7)) + 1;
  if (m > 12) {
    m = 1;
    y++;
  }
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Monthly charges: at least three in a row about a month apart, of a stable amount, the
 * last one recent. Reports a price rise when the current amount is above the previous.
 */
export function detectSubscriptions(charges: readonly Charge[], today: string): Subscription[] {
  const groups = new Map<string, Charge[]>();
  for (const c of charges) {
    if (c.amountCents <= 0) continue;
    const key = subscriptionKey(c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: Subscription[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // Trailing run of charges about a month apart.
    const run = [sorted[sorted.length - 1]!];
    for (let i = sorted.length - 2; i >= 0; i--) {
      const gap = daysFrom(sorted[i]!.date, run[0]!.date);
      if (gap < MIN_GAP || gap > MAX_GAP) break;
      run.unshift(sorted[i]!);
    }
    if (run.length < MIN_CHARGES) continue;
    const last = run[run.length - 1]!;
    if (daysFrom(last.date, today) > STOPPED_AFTER_DAYS) continue;
    const usual = median(run.map((c) => c.amountCents));
    if (run.some((c) => Math.abs(c.amountCents - usual) > usual * AMOUNT_TOLERANCE)) continue;

    let since = run.length - 1;
    while (since > 0 && run[since - 1]!.amountCents === last.amountCents) since--;
    const before = since > 0 ? run[since - 1]!.amountCents : last.amountCents;
    const day = Math.max(...run.slice(-3).map((c) => Number(c.date.slice(8, 10))));
    out.push({
      key,
      merchantId: last.merchantId,
      label: last.label,
      count: run.length,
      firstDate: run[0]!.date,
      lastDate: last.date,
      lastAmountCents: last.amountCents,
      previousAmountCents: before,
      increase:
        last.amountCents > before
          ? { fromCents: before, toCents: last.amountCents, sinceDate: run[since]!.date }
          : null,
      nextDate: nextMonthly(last.date, day),
      dayOfMonth: day,
    });
  }
  return out.sort((a, b) => b.lastAmountCents - a.lastAmountCents || a.key.localeCompare(b.key));
}

/* -------------------------------------------------------------------------- */
/* Unusual expenses                                                            */
/* -------------------------------------------------------------------------- */

export type CategorizedCharge = Charge & { categoryId: string | null };
export type Anomaly = {
  id: string;
  label: string;
  date: string;
  amountCents: Cents;
  usualCents: Cents;
  /** Amount divided by the usual one, one decimal. */
  ratio: number;
};

const MIN_SAMPLES = 5;
const ANOMALY_RATIO = 3;
/** Small amounts never alert (a 3 € coffee is not an event). */
const ANOMALY_MIN_GAP = 30_00;

/** Expenses at least 3 times the usual size (median) of their category, and 30 € more. */
export function detectAnomalies(
  current: readonly CategorizedCharge[],
  history: readonly CategorizedCharge[],
): Anomaly[] {
  const byCategory = new Map<string | null, number[]>();
  for (const h of history) {
    byCategory.set(h.categoryId, [...(byCategory.get(h.categoryId) ?? []), h.amountCents]);
  }
  return current
    .flatMap((c) => {
      const samples = byCategory.get(c.categoryId) ?? [];
      if (samples.length < MIN_SAMPLES) return [];
      const usual = median(samples);
      if (usual <= 0) return [];
      if (c.amountCents < usual * ANOMALY_RATIO || c.amountCents - usual < ANOMALY_MIN_GAP) {
        return [];
      }
      return [
        {
          id: c.id,
          label: c.label,
          date: c.date,
          amountCents: c.amountCents,
          usualCents: usual,
          ratio: Math.round((c.amountCents * 10) / usual) / 10,
        },
      ];
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/* -------------------------------------------------------------------------- */
/* End-of-month forecast                                                       */
/* -------------------------------------------------------------------------- */

export type Forecast = { projectedCents: Cents; daysLeft: number; dailyCents: Cents };

/**
 * Balance expected on the last day: today's spendable balance, plus planned recurring
 * flows still to come (reste à vivre), minus everyday spending at the usual daily pace
 * (last months), or at this month's pace when there is no history.
 */
export function forecastMonthEnd(input: {
  balanceCents: Cents;
  plannedNetCents: Cents;
  variableSpentCents: Cents;
  usualDailyCents: Cents | null;
  today: string;
}): Forecast {
  const year = Number(input.today.slice(0, 4));
  const month = Number(input.today.slice(5, 7));
  const day = Number(input.today.slice(8, 10));
  const daysLeft = daysInMonth(year, month) - day;
  const dailyCents =
    input.usualDailyCents ?? Math.round(Math.max(input.variableSpentCents, 0) / day);
  return {
    projectedCents: input.balanceCents + input.plannedNetCents - dailyCents * daysLeft,
    daysLeft,
    dailyCents,
  };
}

/* -------------------------------------------------------------------------- */
/* "Et si" simulator                                                           */
/* -------------------------------------------------------------------------- */

export type Scenario =
  | { kind: "cut"; categoryId: string | null; percent: number }
  | { kind: "add"; monthlyCents: Cents }
  | { kind: "remove"; monthlyCents: Cents };

export type Simulation = {
  baselineNetCents: Cents;
  netCents: Cents;
  monthlyDeltaCents: Cents;
  yearlyDeltaCents: Cents;
  goalMonths?: { before: number | null; after: number | null };
};

/** Monthly savings with changes applied to an average month (income − my spending). */
export function simulate(
  baseline: { incomeCents: Cents; spendingByCategory: ReadonlyMap<string | null, Cents> },
  scenarios: readonly Scenario[],
  goal?: { remainingCents: Cents },
): Simulation {
  const spent = [...baseline.spendingByCategory.values()].reduce((s, v) => s + v, 0);
  const baselineNetCents = baseline.incomeCents - spent;
  let delta = 0;
  for (const s of scenarios) {
    if (s.kind === "cut") {
      const base = baseline.spendingByCategory.get(s.categoryId) ?? 0;
      delta += Math.round((Math.max(base, 0) * Math.min(Math.max(s.percent, 0), 100)) / 100);
    } else if (s.kind === "add") delta -= s.monthlyCents;
    else delta += s.monthlyCents;
  }
  const netCents = baselineNetCents + delta;
  const months = (net: Cents) =>
    goal && net > 0 ? Math.ceil(Math.max(goal.remainingCents, 0) / net) : null;
  return {
    baselineNetCents,
    netCents,
    monthlyDeltaCents: delta,
    yearlyDeltaCents: delta * 12,
    ...(goal ? { goalMonths: { before: months(baselineNetCents), after: months(netCents) } } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Return and warranty reminders                                               */
/* -------------------------------------------------------------------------- */

export type Deadline = {
  id: string;
  label: string;
  kind: "return" | "warranty";
  date: string;
  daysLeft: number;
};

export const RETURN_NOTICE_DAYS = 7;
export const WARRANTY_NOTICE_DAYS = 30;

/** Returns ending within a week and warranties within a month, soonest first. */
export function upcomingDeadlines(
  receipts: readonly {
    id: string;
    label: string;
    returnDeadline: string | null;
    warrantyUntil: string | null;
  }[],
  today: string,
): Deadline[] {
  const out: Deadline[] = [];
  for (const r of receipts) {
    const checks = [
      { kind: "return" as const, date: r.returnDeadline, notice: RETURN_NOTICE_DAYS },
      { kind: "warranty" as const, date: r.warrantyUntil, notice: WARRANTY_NOTICE_DAYS },
    ];
    for (const c of checks) {
      if (!c.date) continue;
      const daysLeft = daysFrom(today, c.date);
      if (daysLeft >= 0 && daysLeft <= c.notice) {
        out.push({ id: r.id, label: r.label, kind: c.kind, date: c.date, daysLeft });
      }
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label));
}
