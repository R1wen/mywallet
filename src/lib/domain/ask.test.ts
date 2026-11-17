import { describe, expect, it } from "vitest";
import { describeQuery, matchName, monthsBetween, resolvePeriod } from "./ask";

describe("resolvePeriod", () => {
  const today = "2026-11-17";
  it.each([
    ["this_month", { from: "2026-11-01", to: "2026-11-30", label: "novembre 2026" }],
    ["last_month", { from: "2026-10-01", to: "2026-10-31", label: "octobre 2026" }],
    ["2026-02", { from: "2026-02-01", to: "2026-02-28", label: "février 2026" }],
    ["2025", { from: "2025-01-01", to: "2025-12-31", label: "2025" }],
    ["this_year", { from: "2026-01-01", to: "2026-12-31", label: "2026" }],
    ["last_3_months", { from: "2026-08-01", to: "2026-10-31", label: "les 3 derniers mois" }],
    ["last_12_months", { from: "2025-11-01", to: "2026-10-31", label: "les 12 derniers mois" }],
  ])("%s", (expr, period) => {
    expect(resolvePeriod(expr, today)).toEqual(period);
  });

  it("rejects anything else", () => {
    expect(resolvePeriod("2026-13", today)).toBeNull();
    expect(resolvePeriod("last_40_months", today)).toBeNull();
    expect(resolvePeriod("drop table", today)).toBeNull();
  });
});

describe("matchName", () => {
  const options = [
    { id: "1", name: "Restaurants" },
    { id: "2", name: "Restauration rapide" },
    { id: "3", name: "Courses" },
    { id: "4", name: "Café" },
  ];
  it("matches exactly, ignoring case and accents, then a unique prefix or word", () => {
    expect(matchName("restaurants", options)?.id).toBe("1");
    expect(matchName("CAFE", options)?.id).toBe("4");
    expect(matchName("course", options)?.id).toBe("3");
    expect(matchName("rapide", options)?.id).toBe("2");
  });
  it("returns null when ambiguous or unknown", () => {
    expect(matchName("resta", options)).toBeNull();
    expect(matchName("voyages", options)).toBeNull();
    expect(matchName("", options)).toBeNull();
  });
});

describe("monthsBetween", () => {
  it("lists the months of a range", () => {
    expect(monthsBetween("2026-08-01", "2026-10-31")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthsBetween("2025-12-01", "2026-01-31")).toEqual(["2025-12", "2026-01"]);
  });
});

describe("describeQuery", () => {
  it("says how the question was understood", () => {
    expect(
      describeQuery({
        measure: "spent",
        periodLabel: "octobre 2026",
        category: "Restaurants",
        merchant: null,
        groupBy: null,
      }),
    ).toBe("Dépenses · Restaurants · octobre 2026");
    expect(
      describeQuery({
        measure: "count",
        periodLabel: "2026",
        category: null,
        merchant: "Amazon",
        groupBy: "month",
      }),
    ).toBe("Nombre d'achats · Amazon · 2026 · par mois");
  });
});
