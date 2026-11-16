/** Date helpers. The app's calendar is always Europe/Paris. Months are 1-12. */

export const PARIS_TZ = "Europe/Paris";

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be 1-12, got ${month}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts a Date or a calendar day "YYYY-MM-DD". A calendar day is pinned to
 * noon UTC so it renders as the same day in Paris whatever the DST offset.
 */
function toInstant(value: Date | string): Date {
  if (value instanceof Date) return value;
  if (ISO_DAY.test(value)) return new Date(`${value}T12:00:00Z`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`invalid date ${value}`);
  return d;
}

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in Paris as "YYYY-MM-DD". */
export function toParisDateString(value: Date | string): string {
  return isoFormatter.format(toInstant(value));
}

const shortFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const longFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDateFr(value: Date | string, style: "short" | "long" = "short"): string {
  return (style === "long" ? longFormatter : shortFormatter).format(toInstant(value));
}

const monthFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TZ,
  month: "long",
  year: "numeric",
});

export type MonthKey = { year: number; month: number };

/** Parses "YYYY-MM" (URL parameter `mois`); anything else is null. */
export function parseMonthKey(value: string | undefined | null): MonthKey | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function formatMonthKey({ year, month }: MonthKey): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** First and last calendar day of a month, as "YYYY-MM-DD". */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  const key = formatMonthKey({ year, month });
  return { from: `${key}-01`, to: `${key}-${String(daysInMonth(year, month)).padStart(2, "0")}` };
}

export function shiftMonth(year: number, month: number, delta: number): MonthKey {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

export function formatMonthFr(year: number, month: number): string {
  daysInMonth(year, month);
  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 15, 12)));
}
