import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  formatDateFr,
  formatMonthFr,
  isLeapYear,
  isValidIsoDay,
  monthBounds,
  parseMonthKey,
  shiftMonth,
  PARIS_TZ,
  toParisDateString,
} from "./dates";

const n = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

describe("isLeapYear", () => {
  it.each([
    [2024, true],
    [2025, false],
    [2000, true],
    [1900, false],
    [2100, false],
  ])("%i -> %s", (y, expected) => expect(isLeapYear(y)).toBe(expected));
});

describe("daysInMonth", () => {
  it("handles every month length (month is 1-12)", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("rejects invalid months", () => {
    expect(() => daysInMonth(2026, 0)).toThrow();
    expect(() => daysInMonth(2026, 13)).toThrow();
  });
});

describe("toParisDateString", () => {
  it("uses the Paris calendar day, not UTC", () => {
    // 23:30 UTC on 31 Dec = 00:30 on 1 Jan in Paris (winter, UTC+1)
    expect(toParisDateString(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    // 22:30 UTC on 30 Jun = 00:30 on 1 Jul in Paris (summer, UTC+2)
    expect(toParisDateString(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(toParisDateString(new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
  });
});

describe("formatDateFr", () => {
  it("formats short French dates in Paris time", () => {
    expect(n(formatDateFr(new Date("2026-11-15T10:00:00Z")))).toBe("15 nov. 2026");
    expect(n(formatDateFr("2026-03-01"))).toBe("1 mars 2026");
  });

  it("supports a long style", () => {
    expect(formatDateFr("2026-11-15", "long")).toBe("dimanche 15 novembre 2026");
  });
});

describe("formatMonthFr", () => {
  it("formats month and year", () => {
    expect(formatMonthFr(2026, 11)).toBe("novembre 2026");
  });
});

it("exposes the Paris time zone", () => {
  expect(PARIS_TZ).toBe("Europe/Paris");
});

describe("month keys", () => {
  it.each([
    ["2026-11", { year: 2026, month: 11 }],
    ["2024-02", { year: 2024, month: 2 }],
    ["2026-13", null],
    ["2026-1", null],
    ["abc", null],
    ["", null],
    [undefined, null],
  ])("parseMonthKey(%j)", (input, expected) => {
    expect(parseMonthKey(input)).toEqual(expected);
  });

  it.each([
    [2026, 11, { from: "2026-11-01", to: "2026-11-30" }],
    [2024, 2, { from: "2024-02-01", to: "2024-02-29" }],
    [2025, 12, { from: "2025-12-01", to: "2025-12-31" }],
  ])("monthBounds(%d, %d)", (y, m, expected) => {
    expect(monthBounds(y, m)).toEqual(expected);
  });

  it.each([
    [2026, 11, 1, { year: 2026, month: 12 }],
    [2026, 12, 1, { year: 2027, month: 1 }],
    [2026, 1, -1, { year: 2025, month: 12 }],
    [2026, 3, -14, { year: 2025, month: 1 }],
  ])("shiftMonth(%d, %d, %d)", (y, m, delta, expected) => {
    expect(shiftMonth(y, m, delta)).toEqual(expected);
  });
});

describe("isValidIsoDay", () => {
  it.each([
    ["2026-11-16", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-1-01", false],
    ["", false],
  ])("%j -> %s", (input, expected) => {
    expect(isValidIsoDay(input)).toBe(expected);
  });
});
