/**
 * Monthly report (pure, ADR-041): deterministic French sentences from figures computed
 * by the server. No model writes it; every number comes from the data.
 */
import type { BudgetLevel } from "./budgets";
import { formatCents, type Cents } from "./money";

export type ReportInput = {
  monthLabel: string;
  spentCents: Cents;
  previousSpentCents: Cents;
  incomeCents: Cents;
  netCents: Cents;
  /** Category changes against last month, biggest first. */
  categories: {
    name: string;
    currentCents: Cents;
    previousCents: Cents;
    deltaCents: Cents;
    deltaPercent: number | null;
  }[];
  budgets: { name: string; percent: number; level: BudgetLevel }[];
  subscriptions: {
    untracked: { label: string; amountCents: Cents }[];
    increases: { label: string; fromCents: Cents; toCents: Cents }[];
  };
  anomalies: { label: string; amountCents: Cents; ratio: number }[];
  receivablesCents: Cents;
  goals: { name: string; percent: number }[];
};

export type ReportSection = { title: string; lines: string[] };

const plain = (s: string) => s.replace(/[  ]/g, " ");
const money = (c: Cents, sign: "auto" | "always" = "auto") => plain(formatCents(c, { sign }));
/** Changes smaller than this are not worth a line. */
const MIN_CHANGE = 20_00;
const MAX_CHANGES = 3;

export function buildMonthlyReport(r: ReportInput): ReportSection[] {
  const sections: ReportSection[] = [];

  const trend =
    r.previousSpentCents > 0
      ? (() => {
          const pct = Math.round(
            ((r.spentCents - r.previousSpentCents) * 100) / r.previousSpentCents,
          );
          const way =
            pct > 0 ? `en hausse de ${pct} %` : pct < 0 ? `en baisse de ${-pct} %` : "stables";
          return `, ${way} par rapport au mois précédent (${money(r.previousSpentCents)})`;
        })()
      : "";
  sections.push({
    title: "En bref",
    lines: [
      `Dépenses : ${money(r.spentCents)}${trend}.`,
      `Revenus : ${money(r.incomeCents)}.`,
      `Solde du mois : ${money(r.netCents, "always")}.`,
    ],
  });

  const changes = r.categories
    .filter((c) => Math.abs(c.deltaCents) >= MIN_CHANGE)
    .slice(0, MAX_CHANGES)
    .map((c) => {
      const pct =
        c.deltaPercent !== null
          ? `, ${c.deltaPercent > 0 ? "+" : ""}${c.deltaPercent} %`
          : ", nouveau";
      return `${c.name} : ${money(c.currentCents)} (${money(c.deltaCents, "always")}${pct}).`;
    });
  if (changes.length) sections.push({ title: "Ce qui a changé", lines: changes });

  if (r.budgets.length) {
    const flagged = r.budgets.filter((b) => b.level !== "ok");
    const kept = r.budgets.length - flagged.length;
    const lines = flagged.map((b) =>
      b.level === "over"
        ? `${b.name} : dépassé (${b.percent} %).`
        : `${b.name} : seuil d'alerte atteint (${b.percent} %).`,
    );
    if (kept) {
      lines.push(
        flagged.length
          ? `${kept} autre${kept > 1 ? "s" : ""} budget${kept > 1 ? "s" : ""} tenu${kept > 1 ? "s" : ""}.`
          : `Tous les budgets sont tenus.`,
      );
    }
    sections.push({ title: "Budgets", lines });
  }

  const subs = [
    ...r.subscriptions.untracked.map(
      (s) => `${s.label} (${money(s.amountCents)} par mois) n'est pas suivi dans Récurrent.`,
    ),
    ...r.subscriptions.increases.map(
      (s) => `${s.label} est passé de ${money(s.fromCents)} à ${money(s.toCents)}.`,
    ),
  ];
  if (subs.length) sections.push({ title: "Abonnements", lines: subs });

  if (r.anomalies.length) {
    sections.push({
      title: "À surveiller",
      lines: r.anomalies.map(
        (a) =>
          `${a.label} : ${money(a.amountCents)}, ${String(a.ratio).replace(".", ",")} fois une dépense habituelle de cette catégorie.`,
      ),
    });
  }

  const ahead = [
    ...(r.receivablesCents > 0
      ? [`${money(r.receivablesCents)} à récupérer auprès de vos proches.`]
      : []),
    ...r.goals.map((g) => `${g.name} : ${g.percent} % atteint.`),
  ];
  if (ahead.length) sections.push({ title: "À venir", lines: ahead });

  return sections;
}
