/**
 * Money helpers. Amounts are always integer cents (never floats).
 * Pure functions: no I/O, no framework imports.
 */

export type Cents = number;
export type CurrencyCode = string;

export const DEFAULT_CURRENCY: CurrencyCode = "EUR";

function assertCents(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer number of cents, got ${value}`);
  }
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: CurrencyCode): Intl.NumberFormat {
  let f = formatterCache.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatterCache.set(currency, f);
  }
  return f;
}

export type SignDisplay = "auto" | "always" | "never";

/** Formats cents as a French currency string, e.g. 123456 -> "1 234,56 €". */
export function formatCents(
  cents: Cents,
  options: { currency?: CurrencyCode; sign?: SignDisplay } = {},
): string {
  assertCents(cents);
  const { currency = DEFAULT_CURRENCY, sign = "auto" } = options;
  const abs = formatter(currency).format(Math.abs(cents) / 100);
  if (cents === 0 || sign === "never") return abs;
  if (cents < 0) return `-${abs}`;
  return sign === "always" ? `+${abs}` : abs;
}

const THOUSANDS_GROUPS = /^\d{1,3}(?:[.,]\d{3})+$/;

/**
 * Parses a user-typed amount into cents. Accepts French and English notations.
 * Comma is a decimal separator (max 2 decimals); a lone dot followed by exactly
 * 3 digits is a thousands separator ("1.234" = 1 234). Returns null if invalid.
 */
export function parseAmountToCents(input: string): Cents | null {
  let s = input.replace(/[\s\u00a0\u202f€]/g, "");
  let negative = false;
  if (s.startsWith("-") || s.startsWith("+")) {
    negative = s.startsWith("-");
    s = s.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart: string;
  let decPart = "";

  if (lastDot !== -1 && lastComma !== -1) {
    const decIdx = Math.max(lastDot, lastComma);
    const thousandsSep = decIdx === lastDot ? "," : ".";
    intPart = s.slice(0, decIdx);
    decPart = s.slice(decIdx + 1);
    if (intPart.includes(decIdx === lastDot ? "." : ",")) return null;
    const groups = intPart.split(thousandsSep);
    const [head = "", ...tail] = groups;
    if (!/^\d{1,3}$/.test(head) || tail.some((g) => !/^\d{3}$/.test(g))) return null;
    intPart = intPart.split(thousandsSep).join("");
  } else if (lastDot === -1 && lastComma === -1) {
    intPart = s;
  } else {
    const sep = lastDot !== -1 ? "." : ",";
    const count = s.split(sep).length - 1;
    if (count > 1) {
      if (!THOUSANDS_GROUPS.test(s)) return null;
      intPart = s.split(sep).join("");
    } else {
      const [a = "", b = ""] = s.split(sep);
      if (sep === "." && b.length === 3) {
        intPart = a + b;
      } else {
        intPart = a;
        decPart = b;
      }
    }
  }

  if (decPart.length > 2 || !/^\d*$/.test(decPart) || !/^\d+$/.test(intPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}

/** Splits an amount into `parts` shares; leftover cents go to the first shares. */
export function splitEvenly(total: Cents, parts: number): Cents[] {
  assertCents(total, "total");
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError(`parts must be a positive integer, got ${parts}`);
  }
  return allocateProportionally(total, Array<number>(parts).fill(1));
}

/**
 * Distributes `total` across `weights` pro rata using the largest remainder method.
 * The result always sums exactly to `total`. Ties go to the earliest index.
 * Works for negative totals (e.g. a discount) symmetrically.
 */
export function allocateProportionally(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, "total");
  if (weights.length === 0) throw new RangeError("weights must not be empty");
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new RangeError(`invalid weight ${w}`);
  }

  const weightSum = weights.reduce((a, b) => a + b, 0);
  const effective = weightSum === 0 ? weights.map(() => 1) : weights;
  const effectiveSum = weightSum === 0 ? weights.length : weightSum;

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const raw = effective.map((w) => (absTotal * w) / effectiveSum);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = absTotal - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i]! += 1;
    remaining -= 1;
  }

  return floors.map((v) => (v === 0 ? 0 : v * sign));
}

/** Cents as typed in an amount input ("12,50", "-3,05"), integer arithmetic only. */
export function centsToInput(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
