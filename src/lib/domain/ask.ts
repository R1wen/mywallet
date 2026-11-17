/**
 * Questions in natural language (ADR-040): "le modèle traduit, le code calcule". The model
 * only turns the question into a small structured query; everything here is pure and
 * deterministic: period expressions, names matched against the user's own lists, and
 * the sentence that tells how the question was understood.
 */
import { normalizeText } from "./categorize";
import { formatMonthFr, monthBounds, shiftMonth } from "./dates";

export const ASK_MEASURES = ["spent", "income", "count"] as const;
export type AskMeasure = (typeof ASK_MEASURES)[number];
export const ASK_GROUPS = ["category", "merchant", "month"] as const;
export type AskGroup = (typeof ASK_GROUPS)[number];

export type ResolvedPeriod = { from: string; to: string; label: string };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR = /^(\d{4})$/;
const LAST_N = /^last_(\d{1,2})_months$/;

/** Period expressions the model may return; anything else is refused. */
export function resolvePeriod(expr: string, today: string): ResolvedPeriod | null {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const ofMonth = (y: number, m: number) => ({ ...monthBounds(y, m), label: formatMonthFr(y, m) });
  if (expr === "this_month") return ofMonth(year, month);
  if (expr === "last_month") {
    const p = shiftMonth(year, month, -1);
    return ofMonth(p.year, p.month);
  }
  if (expr === "this_year")
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  const m = MONTH.exec(expr);
  if (m) return ofMonth(Number(m[1]), Number(m[2]));
  const y = YEAR.exec(expr);
  if (y) return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31`, label: y[1]! };
  const n = LAST_N.exec(expr);
  if (n) {
    const count = Number(n[1]);
    if (count < 1 || count > 24) return null;
    const start = shiftMonth(year, month, -count);
    const end = shiftMonth(year, month, -1);
    return {
      from: monthBounds(start.year, start.month).from,
      to: monthBounds(end.year, end.month).to,
      label: `les ${count} derniers mois`,
    };
  }
  return null;
}

/** A category or merchant named by the model, matched against mine; null if unsure. */
export function matchName<T extends { id: string; name: string }>(
  name: string,
  options: readonly T[],
): T | null {
  const wanted = normalizeText(name);
  if (!wanted) return null;
  const norm = options.map((o) => ({ o, n: normalizeText(o.name) }));
  const exact = norm.filter((x) => x.n === wanted);
  if (exact.length === 1) return exact[0]!.o;
  const partial = norm.filter(
    (x) =>
      x.n.startsWith(wanted) || x.n.split(" ").some((w) => w === wanted || w.startsWith(wanted)),
  );
  return partial.length === 1 ? partial[0]!.o : null;
}

/** "YYYY-MM" of every month between two days. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 120; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const MEASURE_LABELS: Record<AskMeasure, string> = {
  spent: "Dépenses",
  income: "Revenus",
  count: "Nombre d'achats",
};
const GROUP_LABELS: Record<AskGroup, string> = {
  category: "par catégorie",
  merchant: "par magasin",
  month: "par mois",
};

/** How the question was understood, shown above the answer. */
export function describeQuery(q: {
  measure: AskMeasure;
  periodLabel: string;
  category: string | null;
  merchant: string | null;
  groupBy: AskGroup | null;
}): string {
  return [
    MEASURE_LABELS[q.measure],
    q.category,
    q.merchant,
    q.periodLabel,
    q.groupBy ? GROUP_LABELS[q.groupBy] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
