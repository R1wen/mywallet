import { describe, expect, it } from "vitest";
import {
  accountBalance,
  signedAmount,
  spendByCategory,
  summarizeFlows,
  type FlowTx,
} from "./transactions";

describe("signedAmount", () => {
  it.each([
    ["expense", 1250, undefined, -1250],
    ["income", 250000, undefined, 250000],
    ["refund", 2500, undefined, 2500],
    ["reimbursement", 3000, undefined, 3000],
    ["transfer", 10000, "out", -10000],
    ["transfer", 10000, "in", 10000],
  ] as const)("%s %d (%s) -> %d", (kind, magnitude, direction, expected) => {
    expect(signedAmount(kind, magnitude, direction)).toBe(expected);
  });

  it.each([0, -5, 12.5, Number.NaN])("rejects magnitude %d", (m) => {
    expect(() => signedAmount("expense", m)).toThrow(RangeError);
  });

  it("requires a direction for transfers", () => {
    expect(() => signedAmount("transfer", 100)).toThrow(RangeError);
  });
});

describe("accountBalance", () => {
  it("adds the opening balance and every signed movement", () => {
    expect(accountBalance(10000, [-8000, 3000, 250000, -10000])).toBe(245000);
  });

  it("is the opening balance with no movement", () => {
    expect(accountBalance(-500, [])).toBe(-500);
  });
});

const tx = (kind: FlowTx["kind"], amountCents: number, categoryId: string | null = null) => ({
  kind,
  amountCents,
  categoryId,
});

describe("summarizeFlows", () => {
  it("separates income, spending, refunds and reimbursements; ignores transfers", () => {
    const s = summarizeFlows([
      tx("income", 250000),
      tx("expense", -8000),
      tx("expense", -4250),
      tx("refund", 2500),
      tx("reimbursement", 3000),
      tx("transfer", -50000),
      tx("transfer", 50000),
    ]);
    expect(s).toEqual({
      incomeCents: 250000,
      spentCents: 9750, // 8000 + 4250 - 2500 (refund lowers my spending, never income)
      reimbursedCents: 3000,
      sharedCents: 0,
      netCents: 250000 - 9750 + 3000,
    });
  });

  it("counts only my share of a shared expense; the cash flow keeps the full amount", () => {
    // 80 € receipt, 30 € owed by a friend who paid back 30 €.
    const s = summarizeFlows([
      { kind: "expense", amountCents: -8000, categoryId: null, othersShareCents: 3000 },
      tx("reimbursement", 3000),
    ]);
    expect(s).toEqual({
      incomeCents: 0,
      spentCents: 5000,
      reimbursedCents: 3000,
      sharedCents: 3000,
      netCents: -5000,
    });
  });

  it("never reports negative spending when refunds exceed purchases", () => {
    expect(summarizeFlows([tx("refund", 5000)]).spentCents).toBe(0);
  });

  it("is all zeros for an empty list", () => {
    expect(summarizeFlows([])).toEqual({
      incomeCents: 0,
      spentCents: 0,
      reimbursedCents: 0,
      sharedCents: 0,
      netCents: 0,
    });
  });
});

describe("spendByCategory", () => {
  it("uses my real expense: others' shares are not my spending", () => {
    expect(
      spendByCategory([
        { kind: "expense", amountCents: -8000, categoryId: "food", othersShareCents: 3000 },
        { kind: "expense", amountCents: -2000, categoryId: "fun", othersShareCents: 2000 },
      ]),
    ).toEqual([{ categoryId: "food", spentCents: 5000 }]);
  });

  const rows = [
    tx("expense", -8000, "courses"),
    tx("expense", -2000, "courses"),
    tx("refund", 1500, "courses"),
    tx("expense", -4000, "restaurants"),
    tx("expense", -900, null),
    tx("refund", 3000, "high_tech"),
    tx("income", 250000, "salaire"),
    tx("transfer", -50000, "epargne"),
  ];

  it("nets refunds per category, drops non-positive totals, sorts by amount", () => {
    expect(spendByCategory(rows)).toEqual([
      { categoryId: "courses", spentCents: 8500 },
      { categoryId: "restaurants", spentCents: 4000 },
      { categoryId: null, spentCents: 900 },
    ]);
  });

  it("groups the tail into one 'other' bucket after `limit` entries", () => {
    expect(spendByCategory(rows, 1)).toEqual([
      { categoryId: "courses", spentCents: 8500 },
      { categoryId: "__other__", spentCents: 4900 },
    ]);
  });

  it("breaks ties by category id for a stable order", () => {
    expect(spendByCategory([tx("expense", -100, "b"), tx("expense", -100, "a")])).toEqual([
      { categoryId: "a", spentCents: 100 },
      { categoryId: "b", spentCents: 100 },
    ]);
  });
});
