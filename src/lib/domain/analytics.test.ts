import { describe, expect, it } from "vitest";
import {
  compareCategories,
  detectAnomalies,
  detectSubscriptions,
  forecastMonthEnd,
  median,
  simulate,
  subscriptionKey,
  upcomingDeadlines,
} from "./analytics";

describe("median", () => {
  it.each([
    [[], 0],
    [[5], 5],
    [[1, 9, 3], 3],
    [[1, 2, 3, 10], 3], // (2 + 3) / 2 rounded half up
  ])("%j -> %i", (values, m) => {
    expect(median(values)).toBe(m);
  });
});

describe("compareCategories", () => {
  it("compares with last month and the 3-month average, biggest change first", () => {
    const rows = compareCategories(
      new Map([
        ["resto", 30_000],
        ["courses", 40_000],
        ["new", 5_000],
      ]),
      new Map([
        ["resto", 18_000],
        ["courses", 41_000],
        ["gone", 2_000],
      ]),
      new Map([
        ["resto", 20_000],
        ["courses", 40_000],
      ]),
    );
    expect(rows).toEqual([
      {
        categoryId: "resto",
        currentCents: 30_000,
        previousCents: 18_000,
        averageCents: 20_000,
        deltaCents: 12_000,
        deltaPercent: 67,
      },
      {
        categoryId: "new",
        currentCents: 5_000,
        previousCents: 0,
        averageCents: 0,
        deltaCents: 5_000,
        deltaPercent: null,
      },
      {
        categoryId: "gone",
        currentCents: 0,
        previousCents: 2_000,
        averageCents: 0,
        deltaCents: -2_000,
        deltaPercent: -100,
      },
      {
        categoryId: "courses",
        currentCents: 40_000,
        previousCents: 41_000,
        averageCents: 40_000,
        deltaCents: -1_000,
        deltaPercent: -2,
      },
    ]);
  });
});

const tx = (date: string, amountCents: number, merchantId: string | null, label = "x") => ({
  id: `${merchantId}-${date}`,
  date,
  amountCents,
  merchantId,
  label,
});

describe("subscriptionKey", () => {
  it("uses the merchant, else the label without dates and references", () => {
    expect(subscriptionKey({ merchantId: "m1", label: "x" })).toBe("m:m1");
    expect(
      subscriptionKey({ merchantId: null, label: "PRLV SEPA FREE MOBILE 12/10 REF 8842" }),
    ).toBe("l:prlv sepa free mobile ref");
  });
});

describe("detectSubscriptions", () => {
  const today = "2026-11-17";
  const spotify = [
    tx("2026-07-12", 1099, "spotify"),
    tx("2026-08-12", 1099, "spotify"),
    tx("2026-09-12", 1099, "spotify"),
    tx("2026-10-12", 1199, "spotify"),
    tx("2026-11-12", 1199, "spotify"),
  ];

  it("finds monthly charges of a stable amount and flags a price rise", () => {
    const [s] = detectSubscriptions(spotify, today);
    expect(s).toEqual({
      key: "m:spotify",
      merchantId: "spotify",
      label: "x",
      count: 5,
      firstDate: "2026-07-12",
      lastDate: "2026-11-12",
      lastAmountCents: 1199,
      previousAmountCents: 1099,
      increase: { fromCents: 1099, toCents: 1199, sinceDate: "2026-10-12" },
      nextDate: "2026-12-12",
      dayOfMonth: 12,
    });
  });

  it("ignores irregular, too few, stopped or very variable charges", () => {
    const groceries = [
      tx("2026-09-02", 4500, "lidl"),
      tx("2026-09-09", 3200, "lidl"),
      tx("2026-10-01", 8100, "lidl"),
      tx("2026-11-03", 2500, "lidl"),
    ];
    const twice = [tx("2026-10-05", 999, "netflix"), tx("2026-11-05", 999, "netflix")];
    const stopped = [
      tx("2026-05-01", 2000, "gym"),
      tx("2026-06-01", 2000, "gym"),
      tx("2026-07-01", 2000, "gym"),
    ];
    expect(detectSubscriptions([...groceries, ...twice, ...stopped], today)).toEqual([]);
  });

  it("tolerates month-end drift (31st, 30th, 28th)", () => {
    const rent = [
      tx("2026-07-31", 5000, null, "PRLV LOYER 07"),
      tx("2026-08-31", 5000, null, "PRLV LOYER 08"),
      tx("2026-09-30", 5000, null, "PRLV LOYER 09"),
      tx("2026-10-31", 5000, null, "PRLV LOYER 10"),
    ];
    const [s] = detectSubscriptions(rent, today);
    expect(s).toMatchObject({
      key: "l:prlv loyer",
      count: 4,
      nextDate: "2026-11-30",
      increase: null,
    });
  });
});

describe("detectAnomalies", () => {
  const history = [
    {
      id: "h1",
      date: "2026-08-01",
      amountCents: 2000,
      categoryId: "resto",
      merchantId: "a",
      label: "A",
    },
    {
      id: "h2",
      date: "2026-08-15",
      amountCents: 2500,
      categoryId: "resto",
      merchantId: "b",
      label: "B",
    },
    {
      id: "h3",
      date: "2026-09-10",
      amountCents: 1800,
      categoryId: "resto",
      merchantId: "c",
      label: "C",
    },
    {
      id: "h4",
      date: "2026-09-20",
      amountCents: 2200,
      categoryId: "resto",
      merchantId: "d",
      label: "D",
    },
    {
      id: "h5",
      date: "2026-10-05",
      amountCents: 2100,
      categoryId: "resto",
      merchantId: "e",
      label: "E",
    },
  ];

  it("flags an expense far above the usual size in its category", () => {
    const current = [
      {
        id: "c1",
        date: "2026-11-10",
        amountCents: 9000,
        categoryId: "resto",
        merchantId: "f",
        label: "Gastro",
      },
      {
        id: "c2",
        date: "2026-11-11",
        amountCents: 3000,
        categoryId: "resto",
        merchantId: "g",
        label: "Bistro",
      },
    ];
    expect(detectAnomalies(current, history)).toEqual([
      {
        id: "c1",
        label: "Gastro",
        date: "2026-11-10",
        amountCents: 9000,
        usualCents: 2100,
        ratio: 4.3,
      },
    ]);
  });

  it("needs enough history and a meaningful gap", () => {
    expect(
      detectAnomalies([{ ...history[0]!, id: "x", amountCents: 9000 }], history.slice(0, 3)),
    ).toEqual([]);
    // 3x the usual but only 2,10 € more than... small amounts never alert.
    const small = [
      {
        id: "s",
        date: "2026-11-01",
        amountCents: 300,
        categoryId: "cafe",
        merchantId: "k",
        label: "Café",
      },
    ];
    const cafes = Array.from({ length: 6 }, (_, i) => ({
      ...small[0]!,
      id: `k${i}`,
      amountCents: 100,
    }));
    expect(detectAnomalies(small, cafes)).toEqual([]);
  });
});

describe("forecastMonthEnd", () => {
  it("projects the balance with planned flows and the usual daily spending", () => {
    expect(
      forecastMonthEnd({
        balanceCents: 120_000,
        plannedNetCents: -45_000, // rent still to come
        variableSpentCents: 30_000,
        usualDailyCents: 2_000,
        today: "2026-11-17",
      }),
    ).toEqual({ projectedCents: 120_000 - 45_000 - 2_000 * 13, daysLeft: 13, dailyCents: 2_000 });
  });

  it("uses this month's pace when there is no history, and nothing after the last day", () => {
    expect(
      forecastMonthEnd({
        balanceCents: 0,
        plannedNetCents: 0,
        variableSpentCents: 34_000,
        usualDailyCents: null,
        today: "2026-11-17",
      }),
    ).toEqual({ projectedCents: -26_000, daysLeft: 13, dailyCents: 2_000 });
    expect(
      forecastMonthEnd({
        balanceCents: 500,
        plannedNetCents: 0,
        variableSpentCents: 0,
        usualDailyCents: 2_000,
        today: "2026-11-30",
      }).projectedCents,
    ).toBe(500);
  });
});

describe("simulate", () => {
  const baseline = {
    incomeCents: 250_000,
    spendingByCategory: new Map([
      ["resto", 20_000],
      ["courses", 40_000],
      ["autres", 140_000],
    ]),
  };

  it("adds up category cuts, new and cancelled subscriptions", () => {
    const r = simulate(baseline, [
      { kind: "cut", categoryId: "resto", percent: 25 },
      { kind: "add", monthlyCents: 1_500 },
      { kind: "remove", monthlyCents: 1_199 },
    ]);
    expect(r).toEqual({
      baselineNetCents: 50_000,
      netCents: 50_000 + 5_000 - 1_500 + 1_199,
      monthlyDeltaCents: 4_699,
      yearlyDeltaCents: 56_388,
    });
  });

  it("estimates when a goal is reached", () => {
    const r = simulate(baseline, [{ kind: "cut", categoryId: "courses", percent: 10 }], {
      remainingCents: 108_000,
    });
    expect(r.goalMonths).toEqual({ before: 3, after: 2 });
  });
});

describe("upcomingDeadlines", () => {
  it("lists returns within 7 days and warranties within 30, soonest first", () => {
    expect(
      upcomingDeadlines(
        [
          { id: "a", label: "Darty", returnDeadline: "2026-11-20", warrantyUntil: "2028-11-01" },
          { id: "b", label: "Fnac", returnDeadline: "2026-12-30", warrantyUntil: "2026-12-10" },
          { id: "c", label: "Ikea", returnDeadline: "2026-11-10", warrantyUntil: null },
          { id: "d", label: "Decathlon", returnDeadline: "2026-11-17", warrantyUntil: null },
        ],
        "2026-11-17",
      ),
    ).toEqual([
      { id: "d", label: "Decathlon", kind: "return", date: "2026-11-17", daysLeft: 0 },
      { id: "a", label: "Darty", kind: "return", date: "2026-11-20", daysLeft: 3 },
      { id: "b", label: "Fnac", kind: "warranty", date: "2026-12-10", daysLeft: 23 },
    ]);
  });
});
