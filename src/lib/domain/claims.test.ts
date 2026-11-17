import { describe, expect, it } from "vitest";
import {
  ME,
  allocatePayment,
  allocateVat,
  canCancel,
  canGift,
  canReopen,
  checkPayment,
  claimTotals,
  computeItemClaims,
  computeWholeClaims,
  myShareCents,
  netLineAmounts,
  othersShareCents,
  remainingCents,
  reminderMessage,
  splitShare,
  statusAfterPayments,
  suggestReimbursements,
  type ClaimState,
} from "./claims";

describe("netLineAmounts", () => {
  it("keeps lines unchanged without discounts", () => {
    expect(netLineAmounts([500, 250])).toEqual([500, 250]);
  });

  it("spreads negative lines pro rata over positive lines, discount lines become 0", () => {
    // 10 € + 30 € - 4 € of discount: 1 € and 3 € off.
    expect(netLineAmounts([1000, 3000, -400])).toEqual([900, 2700, 0]);
  });

  it("uses the largest remainder so the net always sums to the receipt total", () => {
    const lines = [333, 333, 334, -100];
    const net = netLineAmounts(lines);
    expect(net.reduce((a, b) => a + b, 0)).toBe(900);
    expect(net).toEqual([300, 300, 300, 0]);
  });

  it("returns zeros when no line is positive", () => {
    expect(netLineAmounts([])).toEqual([]);
    expect(netLineAmounts([-100])).toEqual([0]);
  });
});

describe("splitShare", () => {
  it("gives the leftover cent to me when I take part", () => {
    expect(splitShare(1001, [ME, "lea", "karim"])).toEqual([
      { participant: ME, amountCents: 335 },
      { participant: "lea", amountCents: 333 },
      { participant: "karim", amountCents: 333 },
    ]);
  });

  it("keeps my position in the output whatever the input order", () => {
    expect(splitShare(1001, ["lea", ME])).toEqual([
      { participant: "lea", amountCents: 500 },
      { participant: ME, amountCents: 501 },
    ]);
  });

  it("splits between people only with the largest remainder", () => {
    expect(splitShare(1001, ["lea", "karim"])).toEqual([
      { participant: "lea", amountCents: 501 },
      { participant: "karim", amountCents: 500 },
    ]);
  });

  it("treats no participant or a duplicate as mine / once", () => {
    expect(splitShare(500, [])).toEqual([{ participant: ME, amountCents: 500 }]);
    expect(splitShare(500, ["lea", "lea"])).toEqual([{ participant: "lea", amountCents: 500 }]);
  });

  it("rejects a negative amount", () => {
    expect(() => splitShare(-1, ["lea"])).toThrow(RangeError);
  });
});

describe("computeItemClaims", () => {
  it("creates no claim when everything is mine", () => {
    expect(computeItemClaims([{ totalCents: 800, participants: [] }])).toEqual([]);
  });

  it("assigns whole lines, shares lines and applies the discount pro rata", () => {
    // Pizza 10 € (Léa), wine 20 € (me + Léa + Karim), discount -3 € spread 1 € / 2 €.
    const claims = computeItemClaims([
      { totalCents: 1000, participants: ["lea"] },
      { totalCents: 2000, participants: [ME, "lea", "karim"] },
      { totalCents: -300, participants: [] },
    ]);
    expect(claims).toEqual([
      { line: 0, personId: "lea", amountCents: 900 },
      { line: 1, personId: "lea", amountCents: 600 },
      { line: 1, personId: "karim", amountCents: 600 },
    ]);
  });

  it("ignores participants put on a discount line", () => {
    expect(
      computeItemClaims([
        { totalCents: 1000, participants: [] },
        { totalCents: -200, participants: ["lea"] },
      ]),
    ).toEqual([]);
  });

  it("supports a fully shared receipt: claims sum to the total", () => {
    const claims = computeItemClaims([
      { totalCents: 1234, participants: ["lea"] },
      { totalCents: 766, participants: ["karim"] },
    ]);
    expect(claims.reduce((s, c) => s + c.amountCents, 0)).toBe(2000);
    expect(myShareCents(2000, claims)).toBe(0);
  });
});

describe("computeWholeClaims", () => {
  it("splits the whole transaction equally, me keeping the leftover", () => {
    expect(computeWholeClaims(1000, [ME, "lea", "karim"])).toEqual([
      { line: null, personId: "lea", amountCents: 333 },
      { line: null, personId: "karim", amountCents: 333 },
    ]);
  });

  it("returns nothing when the transaction is mine", () => {
    expect(computeWholeClaims(1000, [ME])).toEqual([]);
  });
});

describe("allocateVat", () => {
  it("allocates the VAT pro rata to each share", () => {
    expect(
      allocateVat(200, [
        { participant: ME, amountCents: 1000 },
        { participant: "lea", amountCents: 1000 },
      ]),
    ).toEqual([
      { participant: ME, vatCents: 100 },
      { participant: "lea", vatCents: 100 },
    ]);
  });

  it("sums exactly to the VAT", () => {
    const r = allocateVat(101, [
      { participant: ME, amountCents: 1 },
      { participant: "a", amountCents: 1 },
      { participant: "b", amountCents: 1 },
    ]);
    expect(r.reduce((s, x) => s + x.vatCents, 0)).toBe(101);
  });
});

const claim = (over: Partial<ClaimState> = {}): ClaimState => ({
  amountCents: 3000,
  status: "pending",
  paidCents: 0,
  ...over,
});

describe("claim state", () => {
  it.each<[ClaimState, number, number]>([
    [claim(), 3000, 3000],
    [claim({ paidCents: 1000 }), 2000, 3000],
    [claim({ status: "reimbursed", paidCents: 3000 }), 0, 3000],
    [claim({ status: "gifted", paidCents: 1000 }), 0, 1000],
    [claim({ status: "gifted" }), 0, 0],
    [claim({ status: "cancelled" }), 0, 0],
  ])("%j: remaining %i, others' share %i", (c, remaining, others) => {
    expect(remainingCents(c)).toBe(remaining);
    expect(othersShareCents(c)).toBe(others);
  });

  it("derives the status from the payments", () => {
    expect(statusAfterPayments(claim(), 2999)).toBe("pending");
    expect(statusAfterPayments(claim(), 3000)).toBe("reimbursed");
    expect(statusAfterPayments(claim({ status: "reimbursed", paidCents: 3000 }), 1000)).toBe(
      "pending",
    );
    // A gift stays a gift when one of its payments is cancelled.
    expect(statusAfterPayments(claim({ status: "gifted", paidCents: 1000 }), 0)).toBe("gifted");
  });

  it("checks a payment against the remaining amount", () => {
    expect(checkPayment(claim({ paidCents: 1000 }), 2000)).toBeNull();
    expect(checkPayment(claim({ paidCents: 1000 }), 2001)).toMatch(/dépasse/);
    expect(checkPayment(claim(), 0)).toMatch(/positif/);
    expect(checkPayment(claim({ status: "gifted" }), 100)).toMatch(/en attente/);
  });

  it("guards gift, cancel and reopen", () => {
    expect(canGift(claim())).toBe(true);
    expect(canGift(claim({ paidCents: 1000 }))).toBe(true);
    expect(canGift(claim({ status: "reimbursed", paidCents: 3000 }))).toBe(false);
    expect(canCancel(claim())).toBe(true);
    expect(canCancel(claim({ paidCents: 1 }))).toBe(false);
    expect(canCancel(claim({ status: "gifted" }))).toBe(false);
    expect(canReopen(claim({ status: "gifted" }))).toBe(true);
    expect(canReopen(claim({ status: "cancelled" }))).toBe(true);
    expect(canReopen(claim())).toBe(false);
  });

  it("totals what is pending, reimbursed and gifted", () => {
    expect(
      claimTotals([
        claim({ paidCents: 1000 }),
        claim({ status: "reimbursed", paidCents: 3000 }),
        claim({ status: "gifted", paidCents: 500 }),
        claim({ status: "cancelled" }),
      ]),
    ).toEqual({ pendingCents: 2000, reimbursedCents: 4500, giftedCents: 2500 });
  });

  it("computes my share of a transaction", () => {
    expect(myShareCents(8000, [{ amountCents: 3000 }])).toBe(5000);
  });
});

describe("allocatePayment (oldest first)", () => {
  const open = [
    { id: "a", remainingCents: 1000 },
    { id: "b", remainingCents: 2500 },
    { id: "c", remainingCents: 500 },
  ];

  it("settles the oldest claims first, the last one partially", () => {
    expect(allocatePayment(open, 3000)).toEqual({
      ok: true,
      data: [
        { id: "a", amountCents: 1000 },
        { id: "b", amountCents: 2000 },
      ],
    });
  });

  it("settles everything with the exact total", () => {
    const r = allocatePayment(open, 4000);
    expect(r.ok && r.data.map((p) => p.amountCents)).toEqual([1000, 2500, 500]);
  });

  it("skips settled claims and refuses more than what is due", () => {
    expect(allocatePayment([{ id: "x", remainingCents: 0 }, ...open], 100)).toEqual({
      ok: true,
      data: [{ id: "a", amountCents: 100 }],
    });
    expect(allocatePayment(open, 4001).ok).toBe(false);
    expect(allocatePayment(open, 0).ok).toBe(false);
  });
});

describe("reminderMessage", () => {
  it("lists every receipt with its lines and the total", () => {
    const text = reminderMessage("Léa", [
      {
        date: "2026-11-02",
        label: "Carrefour",
        lines: [
          { label: "Pizza", remainingCents: 450 },
          { label: "Bière", remainingCents: 320 },
        ],
      },
      { date: "2026-11-10", label: "Cinéma", lines: [{ label: null, remainingCents: 1200 }] },
    ]);
    expect(text).toBe(
      [
        "Bonjour Léa,",
        "",
        "Voici le récapitulatif de ce qu'il reste à me rembourser :",
        "- 2 nov. 2026, Carrefour : 7,70 € (Pizza 4,50 €, Bière 3,20 €)",
        "- 10 nov. 2026, Cinéma : 12,00 €",
        "",
        "Total : 19,70 €",
        "",
        "Merci !",
      ].join("\n"),
    );
  });
});

describe("suggestReimbursements", () => {
  const claims = [
    { id: "c1", personId: "lea", date: "2026-11-01", remainingCents: 1500 },
    { id: "c2", personId: "lea", date: "2026-11-03", remainingCents: 1000 },
    { id: "c3", personId: "karim", date: "2026-11-02", remainingCents: 2500 },
    { id: "c4", personId: "sophie", date: "2026-11-20", remainingCents: 700 },
  ];

  it("matches one claim exactly, then the person's total", () => {
    expect(
      suggestReimbursements(
        [
          { date: "2026-11-05", amountCents: 1000 },
          { date: "2026-11-05", amountCents: -1000 },
        ],
        claims,
      ),
    ).toEqual([{ personId: "lea", claimId: "c2" }, null]);
  });

  it("is ambiguous when two people match", () => {
    // 2 500 € = Karim's claim and Léa's total.
    expect(suggestReimbursements([{ date: "2026-11-05", amountCents: 2500 }], claims)).toEqual([
      null,
    ]);
  });

  it("matches a person's total without a single claim", () => {
    const only = claims.filter((c) => c.personId === "lea");
    expect(suggestReimbursements([{ date: "2026-11-05", amountCents: 2500 }], only)).toEqual([
      { personId: "lea", claimId: null },
    ]);
  });

  it("ignores claims of expenses after the transfer and does not reuse a claim", () => {
    expect(suggestReimbursements([{ date: "2026-11-05", amountCents: 700 }], claims)).toEqual([
      null,
    ]);
    expect(
      suggestReimbursements(
        [
          { date: "2026-11-05", amountCents: 1500 },
          { date: "2026-11-06", amountCents: 1500 },
        ],
        claims,
      ),
    ).toEqual([{ personId: "lea", claimId: "c1" }, null]);
  });
});
