import { describe, expect, it } from "vitest";
import { computeResteAVivre, plannedEffect } from "./reste-a-vivre";

const spendable = new Set(["courant", "especes"]);

describe("plannedEffect", () => {
  it.each([
    [
      "expense on a spendable account",
      { accountId: "courant", toAccountId: null, amountCents: -89_000 },
      -89_000,
    ],
    [
      "income on a spendable account",
      { accountId: "courant", toAccountId: null, amountCents: 245_000 },
      245_000,
    ],
    [
      "expense on a savings account",
      { accountId: "livret", toAccountId: null, amountCents: -500 },
      0,
    ],
    [
      "saving to a savings account",
      { accountId: "courant", toAccountId: "livret", amountCents: -20_000 },
      -20_000,
    ],
    [
      "transfer between spendable accounts",
      { accountId: "courant", toAccountId: "especes", amountCents: -5_000 },
      0,
    ],
    [
      "withdrawal from savings",
      { accountId: "livret", toAccountId: "courant", amountCents: -30_000 },
      30_000,
    ],
  ])("%s", (_, flow, expected) => {
    expect(plannedEffect(flow, spendable)).toBe(expected);
  });
});

describe("computeResteAVivre", () => {
  const base = {
    spendableBalanceCents: 150_000,
    spendableAccountIds: spendable,
    today: "2026-11-16",
    monthEnd: "2026-11-30",
  };

  it("subtracts remaining charges and savings, adds expected income", () => {
    const r = computeResteAVivre({
      ...base,
      planned: [
        { accountId: "courant", toAccountId: null, amountCents: -7_840 },
        { accountId: "courant", toAccountId: "livret", amountCents: -20_000 },
        { accountId: "courant", toAccountId: null, amountCents: 245_000 },
      ],
    });
    expect(r).toEqual({
      resteCents: 150_000 - 7_840 - 20_000 + 245_000,
      plannedChargesCents: -27_840,
      plannedIncomeCents: 245_000,
      daysLeft: 15,
      perDayCents: Math.floor(367_160 / 15),
    });
  });

  it("counts today as a remaining day, including on the last day of the month", () => {
    const r = computeResteAVivre({ ...base, today: "2026-11-30", planned: [] });
    expect(r.daysLeft).toBe(1);
    expect(r.perDayCents).toBe(150_000);
  });

  it("never proposes a negative daily amount", () => {
    const r = computeResteAVivre({
      ...base,
      spendableBalanceCents: 10_000,
      planned: [{ accountId: "courant", toAccountId: null, amountCents: -89_000 }],
    });
    expect(r.resteCents).toBe(-79_000);
    expect(r.perDayCents).toBe(0);
  });

  it("rounds the daily amount down to the cent", () => {
    const r = computeResteAVivre({
      ...base,
      spendableBalanceCents: 100,
      today: "2026-11-28",
      planned: [],
    });
    expect(r.daysLeft).toBe(3);
    expect(r.perDayCents).toBe(33);
  });

  it("handles leap-year February", () => {
    const r = computeResteAVivre({
      ...base,
      today: "2028-02-01",
      monthEnd: "2028-02-29",
      planned: [],
    });
    expect(r.daysLeft).toBe(29);
  });
});
