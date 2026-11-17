import { describe, expect, it } from "vitest";
import { paymentInputSchema, personInputSchema, sharesInputSchema } from "./sharing";

const A = "0190a7c4-0000-7000-8000-000000000001";
const B = "0190a7c4-0000-7000-8000-000000000002";
const ACC = "0190a7c4-0000-7000-8000-0000000000aa";

describe("sharesInputSchema", () => {
  it("accepts me and person ids, removing duplicates", () => {
    const r = sharesInputSchema.parse({ lines: [["me", A, A]], whole: [] });
    expect(r.lines).toEqual([["me", A]]);
  });

  it("rejects anything that is not me or a uuid", () => {
    expect(sharesInputSchema.safeParse({ lines: [["moi"]], whole: [] }).success).toBe(false);
  });
});

describe("personInputSchema", () => {
  it("trims the name and empties notes to null", () => {
    expect(personInputSchema.parse({ name: "  Léa ", notes: " " })).toEqual({
      name: "Léa",
      notes: null,
    });
  });

  it("requires a name", () => {
    expect(personInputSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});

describe("paymentInputSchema", () => {
  const base = { personId: A, occurredOn: "2026-11-17", accountId: ACC };

  it("parses French amounts and skips empty lines", () => {
    const r = paymentInputSchema.parse({
      ...base,
      allocations: [
        { claimId: A, amount: "12,50" },
        { claimId: B, amount: "" },
      ],
    });
    expect(r.allocations).toEqual([{ claimId: A, amountCents: 1250 }]);
    expect(r.totalCents).toBe(1250);
  });

  it.each([
    [[{ claimId: A, amount: "" }], "Saisissez un montant."],
    [[{ claimId: A, amount: "-3" }], "Montant invalide."],
    [
      [
        { claimId: A, amount: "1" },
        { claimId: A, amount: "2" },
      ],
      "Créance en double.",
    ],
  ])("refuses %j", (allocations, message) => {
    const r = paymentInputSchema.safeParse({ ...base, allocations });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(message);
  });

  it("refuses an invalid date", () => {
    expect(
      paymentInputSchema.safeParse({
        ...base,
        occurredOn: "2026-02-30",
        allocations: [{ claimId: A, amount: "1" }],
      }).success,
    ).toBe(false);
  });
});
