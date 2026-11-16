import { describe, expect, it } from "vitest";
import { matchByAmountAndDate } from "./reconcile";

const line = (date: string, amountCents: number) => ({ date, amountCents });

describe("matchByAmountAndDate", () => {
  it("matches the exact amount within 3 days, closest date first", () => {
    const lines = [line("2026-11-05", -4520)];
    const txs = [
      { id: "far", date: "2026-11-01", amountCents: -4520 },
      { id: "near", date: "2026-11-04", amountCents: -4520 },
      { id: "other", date: "2026-11-05", amountCents: -4521 },
    ];
    expect(matchByAmountAndDate(lines, txs)).toEqual(["near"]);
  });

  it.each([
    ["2026-11-08", "t"],
    ["2026-11-09", null],
    ["2026-11-02", "t"],
    ["2026-11-01", null],
  ])("window edge %s -> %j", (date, expected) => {
    expect(
      matchByAmountAndDate(
        [line(date, -100)],
        [{ id: "t", date: "2026-11-05", amountCents: -100 }],
      ),
    ).toEqual([expected]);
  });

  it("never uses a transaction twice and prefers the globally closest pairs", () => {
    const lines = [line("2026-11-03", -250), line("2026-11-05", -250)];
    const txs = [
      { id: "a", date: "2026-11-05", amountCents: -250 },
      { id: "b", date: "2026-11-02", amountCents: -250 },
    ];
    expect(matchByAmountAndDate(lines, txs)).toEqual(["b", "a"]);
  });

  it("leaves extra identical lines unmatched", () => {
    const lines = [line("2026-11-05", -250), line("2026-11-05", -250)];
    expect(
      matchByAmountAndDate(lines, [{ id: "a", date: "2026-11-05", amountCents: -250 }]),
    ).toEqual(["a", null]);
  });

  it("does not match a debit with a credit of the same magnitude", () => {
    expect(
      matchByAmountAndDate(
        [line("2026-11-05", 250)],
        [{ id: "a", date: "2026-11-05", amountCents: -250 }],
      ),
    ).toEqual([null]);
  });
});
