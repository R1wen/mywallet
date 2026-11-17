import { describe, expect, it } from "vitest";
import { buildMonthlyReport, type ReportInput } from "./report";

const input: ReportInput = {
  monthLabel: "octobre 2026",
  spentCents: 182_000,
  previousSpentCents: 165_000,
  incomeCents: 250_000,
  netCents: 61_000,
  categories: [
    {
      name: "Restaurants",
      currentCents: 30_000,
      previousCents: 18_000,
      deltaCents: 12_000,
      deltaPercent: 67,
    },
    {
      name: "Courses",
      currentCents: 40_000,
      previousCents: 45_000,
      deltaCents: -5_000,
      deltaPercent: -11,
    },
    {
      name: "Logement",
      currentCents: 90_000,
      previousCents: 90_000,
      deltaCents: 0,
      deltaPercent: 0,
    },
  ],
  budgets: [
    { name: "Restaurants", percent: 120, level: "over" },
    { name: "Courses", percent: 89, level: "warning" },
    { name: "Loisirs", percent: 40, level: "ok" },
  ],
  subscriptions: {
    untracked: [{ label: "Spotify", amountCents: 1199 }],
    increases: [{ label: "Netflix", fromCents: 1349, toCents: 1499 }],
  },
  anomalies: [{ label: "Darty", amountCents: 45_000, ratio: 6.2 }],
  receivablesCents: 4_200,
  goals: [{ name: "Japon", percent: 24 }],
};

describe("buildMonthlyReport", () => {
  it("writes the essentials of the month in plain French", () => {
    const r = buildMonthlyReport(input);
    const text = (title: string) => r.find((s) => s.title === title)?.lines;
    expect(text("En bref")).toEqual([
      "Dépenses : 1 820,00 €, en hausse de 10 % par rapport au mois précédent (1 650,00 €).",
      "Revenus : 2 500,00 €.",
      "Solde du mois : +610,00 €.",
    ]);
    expect(text("Ce qui a changé")).toEqual([
      "Restaurants : 300,00 € (+120,00 €, +67 %).",
      "Courses : 400,00 € (-50,00 €, -11 %).",
    ]);
    expect(text("Budgets")).toEqual([
      "Restaurants : dépassé (120 %).",
      "Courses : seuil d'alerte atteint (89 %).",
      "1 autre budget tenu.",
    ]);
    expect(text("Abonnements")).toEqual([
      "Spotify (11,99 € par mois) n'est pas suivi dans Récurrent.",
      "Netflix est passé de 13,49 € à 14,99 €.",
    ]);
    expect(text("À surveiller")).toEqual([
      "Darty : 450,00 €, 6,2 fois une dépense habituelle de cette catégorie.",
    ]);
    expect(text("À venir")).toEqual([
      "42,00 € à récupérer auprès de vos proches.",
      "Japon : 24 % atteint.",
    ]);
  });

  it("stays short on a quiet month", () => {
    const r = buildMonthlyReport({
      ...input,
      previousSpentCents: 0,
      categories: [],
      budgets: [],
      subscriptions: { untracked: [], increases: [] },
      anomalies: [],
      receivablesCents: 0,
      goals: [],
      netCents: -2_000,
    });
    expect(r.map((s) => s.title)).toEqual(["En bref"]);
    expect(r[0]!.lines).toEqual([
      "Dépenses : 1 820,00 €.",
      "Revenus : 2 500,00 €.",
      "Solde du mois : -20,00 €.",
    ]);
  });
});
