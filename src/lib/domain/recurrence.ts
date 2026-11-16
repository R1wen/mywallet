/**
 * Recurrence dates for recurring rules (rent, salary, subscriptions, savings).
 * Calendar days are ISO "YYYY-MM-DD" strings in Europe/Paris; arithmetic is done in UTC
 * on day numbers so daylight saving changes never shift a date.
 */
import { daysInMonth } from "./dates";

export const RECURRENCE_FREQUENCIES = ["weekly", "monthly", "yearly"] as const;

/** Occurrences are generated (stored) at most this many months ahead (ADR-024). */
export const GENERATION_HORIZON_MONTHS = 12;
export type Frequency = (typeof RECURRENCE_FREQUENCIES)[number];

export type RecurrenceSpec = {
  frequency: Frequency;
  /** Every n weeks / months / years (>= 1). */
  interval: number;
  /** Monthly and yearly: requested day (1-31), clamped to the month length. Null = start day. */
  dayOfMonth: number | null;
  startOn: string;
  endOn: string | null;
};

const DAY_MS = 86_400_000;

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y!, m!, d!];
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
const dayNumber = (day: string) => {
  const [y, m, d] = parts(day);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

export function addDaysIso(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Number of calendar days from `from` to `to`, both included. */
export function daysBetweenInclusive(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

function clamped(year: number, month: number, day: number): string {
  return iso(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Occurrence dates within [from, to] (both included), sorted, bounded by start and end dates. */
export function occurrencesBetween(spec: RecurrenceSpec, from: string, to: string): string[] {
  const lo = from > spec.startOn ? from : spec.startOn;
  const hi = spec.endOn !== null && spec.endOn < to ? spec.endOn : to;
  if (lo > hi) return [];

  const interval = Math.max(1, Math.trunc(spec.interval));
  const [sy, sm, sd] = parts(spec.startOn);
  const [ly, lm] = parts(lo);
  const out: string[] = [];

  if (spec.frequency === "weekly") {
    const step = 7 * interval;
    const k = Math.ceil((dayNumber(lo) - dayNumber(spec.startOn)) / step);
    for (let d = addDaysIso(spec.startOn, k * step); d <= hi; d = addDaysIso(d, step)) out.push(d);
    return out;
  }

  const day = spec.dayOfMonth ?? sd;

  if (spec.frequency === "monthly") {
    const anchor = sy * 12 + (sm - 1);
    const first = ly * 12 + (lm - 1);
    const k = Math.max(0, Math.ceil((first - anchor) / interval));
    for (let i = anchor + k * interval; ; i += interval) {
      const d = clamped(Math.floor(i / 12), (i % 12) + 1, day);
      if (d > hi) break;
      if (d >= lo) out.push(d);
    }
    return out;
  }

  // yearly: same month as the start date
  const k = Math.max(0, Math.ceil((ly - sy) / interval));
  for (let y = sy + k * interval; ; y += interval) {
    const d = clamped(y, sm, day);
    if (d > hi) break;
    if (d >= lo) out.push(d);
  }
  return out;
}

/** Next occurrence on or after `day`, or null when the rule has ended. */
export function firstOccurrenceOnOrAfter(spec: RecurrenceSpec, day: string): string | null {
  const interval = Math.max(1, Math.trunc(spec.interval));
  const from = day > spec.startOn ? day : spec.startOn;
  const horizon =
    spec.frequency === "weekly"
      ? 7 * interval
      : spec.frequency === "monthly"
        ? 31 * (interval + 1)
        : 366 * (interval + 1);
  return occurrencesBetween(spec, from, addDaysIso(from, horizon))[0] ?? null;
}

/**
 * First day after the period (week, month, year) containing `day`. Used when a rule is
 * rescheduled: periods already handled (validated or skipped) must not get a new occurrence.
 */
export function startOfNextPeriod(frequency: Frequency, day: string): string {
  const [y, m] = parts(day);
  if (frequency === "weekly") return addDaysIso(day, 1);
  if (frequency === "monthly") return m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1);
  return iso(y + 1, 1, 1);
}

/** Period an occurrence belongs to: its month, its year, or the day itself for weekly rules. */
export function periodKey(frequency: Frequency, day: string): string {
  if (frequency === "monthly") return day.slice(0, 7);
  if (frequency === "yearly") return day.slice(0, 4);
  return day;
}

/** Cursor value meaning "nothing left to generate" for a rule that has ended. */
function parked(spec: RecurrenceSpec, fallback: string): string {
  return spec.endOn !== null ? addDaysIso(spec.endOn, 1) : fallback;
}

/**
 * Generation step (ADR-024): due dates from the cursor `nextRunOn` up to `through`, and the new
 * cursor. Storing the cursor plus a unique (rule, due date) makes generation idempotent.
 */
export function planGeneration(
  spec: RecurrenceSpec,
  nextRunOn: string,
  through: string,
): { dates: string[]; nextRunOn: string } {
  if (nextRunOn > through) return { dates: [], nextRunOn };
  const dates = occurrencesBetween(spec, nextRunOn, through);
  const after = addDaysIso(through, 1);
  const next = firstOccurrenceOnOrAfter(spec, after);
  return { dates, nextRunOn: next ?? parked(spec, after) };
}

/**
 * Cursor of a new (or rescheduled) rule: first date from today. Past dates are not generated:
 * they were most likely already recorded by hand, generating them would count them twice.
 */
export function initialNextRunOn(spec: RecurrenceSpec, today: string): string {
  return firstOccurrenceOnOrAfter(spec, today) ?? parked(spec, today);
}

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const dayText = (d: number) => (d === 1 ? "1er" : String(d));

/** French description, e.g. "Tous les mois, le 5" or "Toutes les 2 semaines, le vendredi". */
export function describeRecurrence(spec: RecurrenceSpec): string {
  const n = Math.max(1, Math.trunc(spec.interval));
  const [, sm, sd] = parts(spec.startOn);
  const day = spec.dayOfMonth ?? sd;
  switch (spec.frequency) {
    case "weekly": {
      const weekday = WEEKDAYS[new Date(dayNumber(spec.startOn) * DAY_MS).getUTCDay()];
      return `${n === 1 ? "Toutes les semaines" : `Toutes les ${n} semaines`}, le ${weekday}`;
    }
    case "monthly":
      return `${n === 1 ? "Tous les mois" : `Tous les ${n} mois`}, le ${dayText(day)}${
        day >= 29 ? " (ou le dernier jour)" : ""
      }`;
    case "yearly":
      return `${n === 1 ? "Tous les ans" : `Tous les ${n} ans`}, le ${dayText(day)} ${MONTHS[sm - 1]}`;
  }
}
