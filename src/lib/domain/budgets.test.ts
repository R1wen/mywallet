import { describe, expect, it } from "vitest";
import {
  budgetActive,
  budgetStatus,
  crossedLevel,
  expectedSpend,
  goalProgress,
  periodBounds,
  spentInScope,
} from "./budgets";

describe("periodBounds", () => {
  it.each([
    ["monthly", "2026-02-14", { from: "2026-02-01", to: "2026-02-28" }],
    ["monthly", "2028-02-29", { from: "2028-02-01", to: "2028-02-29" }],
    ["monthly", "2026-12-31", { from: "2026-12-01", to: "2026-12-31" }],
    ["yearly", "2026-07-04", { from: "2026-01-01", to: "2026-12-31" }],
  ] as const)("%s %s", (period, day, bounds) => {
    expect(periodBounds(period, day)).toEqual(bounds);
  });
});

describe("budgetActive", () => {
  const nov = { from: "2026-11-01", to: "2026-11-30" };
  it("applies from its start month, until its end", () => {
    expect(budgetActive({ startsOn: "2026-11-01", endsOn: null }, nov)).toBe(true);
    expect(budgetActive({ startsOn: "2026-11-15", endsOn: null }, nov)).toBe(true);
    expect(budgetActive({ startsOn: "2026-12-01", endsOn: null }, nov)).toBe(false);
    expect(budgetActive({ startsOn: "2026-01-01", endsOn: "2026-10-31" }, nov)).toBe(false);
  });
});

describe("budgetStatus", () => {
  it.each([
    [40_000, 0, 80, { percent: 0, remainingCents: 40_000, level: "ok" }],
    [40_000, 31_999, 80, { percent: 79, remainingCents: 8_001, level: "ok" }],
    [40_000, 32_000, 80, { percent: 80, remainingCents: 8_000, level: "warning" }],
    [40_000, 40_000, 80, { percent: 100, remainingCents: 0, level: "warning" }],
    [40_000, 40_001, 80, { percent: 100, remainingCents: -1, level: "over" }],
    [40_000, 60_000, 100, { percent: 150, remainingCents: -20_000, level: "over" }],
    [40_000, -500, 80, { percent: 0, remainingCents: 40_500, level: "ok" }],
  ] as const)("amount %i spent %i alert %i", (amountCents, spentCents, alertPercent, out) => {
    expect(budgetStatus({ amountCents, spentCents, alertPercent })).toEqual(out);
  });
});

describe("crossedLevel", () => {
  it("reports a level only when it rises", () => {
    expect(crossedLevel("ok", "warning")).toBe("warning");
    expect(crossedLevel("warning", "over")).toBe("over");
    expect(crossedLevel("ok", "over")).toBe("over");
    expect(crossedLevel("warning", "warning")).toBeNull();
    expect(crossedLevel("over", "warning")).toBeNull();
  });
});

describe("expectedSpend", () => {
  const nov = { from: "2026-11-01", to: "2026-11-30" };
  it("follows a straight line over the period", () => {
    expect(expectedSpend(30_000, nov, "2026-11-15")).toBe(15_000);
    expect(expectedSpend(30_000, nov, "2026-11-30")).toBe(30_000);
    expect(expectedSpend(30_000, nov, "2026-10-31")).toBe(0);
    expect(expectedSpend(30_000, nov, "2026-12-02")).toBe(30_000);
  });
});

describe("spentInScope", () => {
  const spent = new Map<string | null, number>([
    ["food", 1000],
    ["food.groceries", 2500],
    ["fun", 700],
    [null, 300],
  ]);
  const parentOf = new Map([["food.groceries", "food"]]);
  it("adds the children of a main category", () => {
    expect(spentInScope("food", spent, parentOf)).toBe(3500);
    expect(spentInScope("food.groceries", spent, parentOf)).toBe(2500);
  });
  it("counts every expense for a global budget", () => {
    expect(spentInScope(null, spent, parentOf)).toBe(4500);
  });
});

describe("goalProgress", () => {
  it("computes progress and the monthly effort until the target date", () => {
    expect(
      goalProgress(
        { targetCents: 350_000, savedCents: 85_000, targetDate: "2027-09-01" },
        "2026-11-17",
      ),
    ).toEqual({
      percent: 24,
      remainingCents: 265_000,
      achieved: false,
      monthsLeft: 10,
      monthlyNeededCents: 26_500,
      late: false,
    });
  });

  it("rounds the monthly effort up to the cent", () => {
    const p = goalProgress(
      { targetCents: 1000, savedCents: 0, targetDate: "2027-02-10" },
      "2026-11-17",
    );
    expect(p.monthsLeft).toBe(3);
    expect(p.monthlyNeededCents).toBe(334);
  });

  it("is achieved at the target, late after the date", () => {
    expect(
      goalProgress({ targetCents: 1000, savedCents: 1200, targetDate: null }, "2026-11-17"),
    ).toMatchObject({
      percent: 100,
      remainingCents: 0,
      achieved: true,
      monthsLeft: null,
      monthlyNeededCents: null,
    });
    expect(
      goalProgress({ targetCents: 1000, savedCents: 100, targetDate: "2026-11-01" }, "2026-11-17"),
    ).toMatchObject({ late: true, monthsLeft: 0, monthlyNeededCents: 900 });
  });

  it("treats a target this month as one month left", () => {
    expect(
      goalProgress({ targetCents: 1000, savedCents: 0, targetDate: "2026-11-30" }, "2026-11-17"),
    ).toMatchObject({ monthsLeft: 1, monthlyNeededCents: 1000, late: false });
  });
});
