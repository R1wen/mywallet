import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  daysBetweenInclusive,
  describeRecurrence,
  firstOccurrenceOnOrAfter,
  initialNextRunOn,
  occurrencesBetween,
  periodKey,
  planGeneration,
  startOfNextPeriod,
  type RecurrenceSpec,
} from "./recurrence";

const monthly = (dayOfMonth: number, startOn: string, extra: Partial<RecurrenceSpec> = {}) =>
  ({ frequency: "monthly", interval: 1, dayOfMonth, startOn, endOn: null, ...extra }) as const;

describe("addDaysIso", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-03-29", 1, "2026-03-30"], // passage à l'heure d'été (Paris)
    ["2026-10-25", 1, "2026-10-26"], // retour à l'heure d'hiver
    ["2026-01-01", -1, "2025-12-31"],
  ])("%s + %d -> %s", (day, n, expected) => {
    expect(addDaysIso(day, n)).toBe(expected);
  });
});

describe("daysBetweenInclusive", () => {
  it.each([
    ["2026-11-16", "2026-11-30", 15],
    ["2026-11-30", "2026-11-30", 1],
    ["2028-02-01", "2028-02-29", 29],
    ["2026-03-01", "2026-03-31", 31], // mois avec changement d'heure
  ])("%s..%s -> %d", (from, to, n) => {
    expect(daysBetweenInclusive(from, to)).toBe(n);
  });
});

describe("occurrencesBetween — monthly", () => {
  it("clamps days 29-31 to the end of short months", () => {
    expect(occurrencesBetween(monthly(31, "2026-01-31"), "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it.each([
    [29, "2027-02-28"],
    [30, "2027-02-28"],
    [31, "2027-02-28"],
  ])("day %d in February of a common year -> %s", (day, expected) => {
    expect(occurrencesBetween(monthly(day, "2027-01-01"), "2027-02-01", "2027-02-28")).toEqual([
      expected,
    ]);
  });

  it.each([
    [29, "2028-02-29"],
    [30, "2028-02-29"],
    [31, "2028-02-29"],
    [28, "2028-02-28"],
  ])("day %d in February of a leap year -> %s", (day, expected) => {
    expect(occurrencesBetween(monthly(day, "2028-01-01"), "2028-02-01", "2028-02-29")).toEqual([
      expected,
    ]);
  });

  it("goes back to the requested day after a short month", () => {
    expect(occurrencesBetween(monthly(30, "2026-01-30"), "2026-02-01", "2026-03-31")).toEqual([
      "2026-02-28",
      "2026-03-30",
    ]);
  });

  it("skips a first month whose day falls before the start date", () => {
    expect(occurrencesBetween(monthly(5, "2026-11-20"), "2026-11-01", "2027-01-31")).toEqual([
      "2026-12-05",
      "2027-01-05",
    ]);
  });

  it("includes the start date itself and stops at the end date", () => {
    expect(
      occurrencesBetween(
        monthly(5, "2026-11-05", { endOn: "2027-01-05" }),
        "2026-01-01",
        "2027-12-31",
      ),
    ).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });

  it("respects the interval anchored on the start month", () => {
    expect(
      occurrencesBetween(monthly(15, "2026-01-15", { interval: 3 }), "2026-02-01", "2026-12-31"),
    ).toEqual(["2026-04-15", "2026-07-15", "2026-10-15"]);
  });

  it("uses the start day when no day of month is set", () => {
    expect(
      occurrencesBetween(
        { frequency: "monthly", interval: 1, dayOfMonth: null, startOn: "2026-01-31", endOn: null },
        "2026-02-01",
        "2026-03-31",
      ),
    ).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("crosses years and returns nothing for an empty or inverted window", () => {
    expect(occurrencesBetween(monthly(10, "2026-11-10"), "2026-12-01", "2027-01-31")).toEqual([
      "2026-12-10",
      "2027-01-10",
    ]);
    expect(occurrencesBetween(monthly(10, "2026-11-10"), "2026-12-11", "2026-12-31")).toEqual([]);
    expect(occurrencesBetween(monthly(10, "2026-11-10"), "2026-12-31", "2026-12-01")).toEqual([]);
  });
});

describe("occurrencesBetween — yearly and weekly", () => {
  it("moves 29 February to the 28th in common years", () => {
    const spec: RecurrenceSpec = {
      frequency: "yearly",
      interval: 1,
      dayOfMonth: null,
      startOn: "2028-02-29",
      endOn: null,
    };
    expect(occurrencesBetween(spec, "2028-01-01", "2032-12-31")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("repeats every n years", () => {
    const spec: RecurrenceSpec = {
      frequency: "yearly",
      interval: 2,
      dayOfMonth: 14,
      startOn: "2026-07-01",
      endOn: null,
    };
    expect(occurrencesBetween(spec, "2026-01-01", "2030-12-31")).toEqual([
      "2026-07-14",
      "2028-07-14",
      "2030-07-14",
    ]);
  });

  it("repeats every n weeks from the start date, across DST changes", () => {
    const spec: RecurrenceSpec = {
      frequency: "weekly",
      interval: 2,
      dayOfMonth: null,
      startOn: "2026-03-16",
      endOn: "2026-04-30",
    };
    expect(occurrencesBetween(spec, "2026-03-20", "2026-12-31")).toEqual([
      "2026-03-30",
      "2026-04-13",
      "2026-04-27",
    ]);
  });
});

describe("firstOccurrenceOnOrAfter", () => {
  it.each([
    ["2026-11-16", "2026-12-05"],
    ["2026-11-05", "2026-11-05"],
    ["2026-01-01", "2026-11-05"],
  ])("monthly on the 5th from %s -> %s", (day, expected) => {
    expect(firstOccurrenceOnOrAfter(monthly(5, "2026-11-05"), day)).toBe(expected);
  });

  it("returns null after the end date", () => {
    expect(
      firstOccurrenceOnOrAfter(monthly(5, "2026-01-05", { endOn: "2026-06-30" }), "2026-07-01"),
    ).toBeNull();
  });

  it("finds a yearly occurrence more than a year ahead", () => {
    const spec: RecurrenceSpec = {
      frequency: "yearly",
      interval: 4,
      dayOfMonth: null,
      startOn: "2028-02-29",
      endOn: null,
    };
    expect(firstOccurrenceOnOrAfter(spec, "2028-03-01")).toBe("2032-02-29");
  });
});

describe("planGeneration", () => {
  const spec = monthly(5, "2026-01-05", { endOn: "2027-02-05" });

  it("returns the due dates up to the horizon and moves the cursor past it", () => {
    expect(planGeneration(spec, "2026-11-05", "2026-12-31")).toEqual({
      dates: ["2026-11-05", "2026-12-05"],
      nextRunOn: "2027-01-05",
    });
  });

  it("is idempotent: a second run from the new cursor generates nothing new", () => {
    const first = planGeneration(spec, "2026-11-05", "2026-12-31");
    expect(planGeneration(spec, first.nextRunOn, "2026-12-31")).toEqual({
      dates: [],
      nextRunOn: "2027-01-05",
    });
  });

  it("parks the cursor after the end date once the rule is over", () => {
    expect(planGeneration(spec, "2027-01-05", "2027-06-30")).toEqual({
      dates: ["2027-01-05", "2027-02-05"],
      nextRunOn: "2027-02-06",
    });
  });
});

describe("initialNextRunOn", () => {
  it.each([
    ["start in the past: first date from today", "2026-01-05", "2026-11-16", "2026-12-05"],
    ["start today", "2026-11-16", "2026-11-16", "2026-12-05"],
    ["start in the future", "2027-03-01", "2026-11-16", "2027-03-05"],
  ])("%s", (_, startOn, today, expected) => {
    expect(initialNextRunOn(monthly(5, startOn), today)).toBe(expected);
  });

  it("falls back to the day after the end date when nothing is left", () => {
    expect(initialNextRunOn(monthly(5, "2026-01-05", { endOn: "2026-06-30" }), "2026-11-16")).toBe(
      "2026-07-01",
    );
  });
});

describe("startOfNextPeriod", () => {
  it.each([
    ["monthly", "2026-12-05", "2027-01-01"],
    ["monthly", "2026-02-28", "2026-03-01"],
    ["yearly", "2026-07-14", "2027-01-01"],
    ["weekly", "2026-11-16", "2026-11-17"],
  ] as const)("%s after %s -> %s", (frequency, day, expected) => {
    expect(startOfNextPeriod(frequency, day)).toBe(expected);
  });
});

describe("periodKey", () => {
  it.each([
    ["monthly", "2026-12-05", "2026-12"],
    ["yearly", "2026-12-05", "2026"],
    ["weekly", "2026-12-05", "2026-12-05"],
  ] as const)("%s %s -> %s", (frequency, day, key) => {
    expect(periodKey(frequency, day)).toBe(key);
  });
});

describe("describeRecurrence", () => {
  it.each<[RecurrenceSpec, string]>([
    [monthly(5, "2026-01-05"), "Tous les mois, le 5"],
    [monthly(1, "2026-01-01"), "Tous les mois, le 1er"],
    [monthly(31, "2026-01-31"), "Tous les mois, le 31 (ou le dernier jour)"],
    [monthly(10, "2026-01-10", { interval: 3 }), "Tous les 3 mois, le 10"],
    [
      { frequency: "weekly", interval: 1, dayOfMonth: null, startOn: "2026-11-16", endOn: null },
      "Toutes les semaines, le lundi",
    ],
    [
      { frequency: "weekly", interval: 2, dayOfMonth: null, startOn: "2026-11-20", endOn: null },
      "Toutes les 2 semaines, le vendredi",
    ],
    [
      { frequency: "yearly", interval: 1, dayOfMonth: 14, startOn: "2026-07-01", endOn: null },
      "Tous les ans, le 14 juillet",
    ],
  ])("%j -> %s", (spec, text) => {
    expect(describeRecurrence(spec)).toBe(text);
  });
});
