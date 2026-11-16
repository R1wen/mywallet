import { describe, expect, it } from "vitest";
import { parseModelReceipt } from "./model-receipt";

describe("parseModelReceipt", () => {
  it("converts string amounts to cents and keeps valid dates", () => {
    expect(
      parseModelReceipt(
        JSON.stringify({
          merchant: " Carrefour Market ",
          date: "2026-11-14",
          time: "18:42",
          total: "9,90",
          paymentMethod: "card",
          items: [
            { label: "Lait", quantity: 2, total: "2,50" },
            { label: "", quantity: 1, total: "1,00" },
            { label: "Café", quantity: 1, total: "7,90" },
          ],
          discounts: "0,50",
          vat: [{ rate: "5,5", base: "9,38", amount: "0,52" }],
          returnDeadline: "2026-02-30",
          warrantyUntil: null,
        }),
      ),
    ).toEqual({
      merchantRaw: "Carrefour Market",
      date: "2026-11-14",
      time: "18:42",
      currency: "EUR",
      totalCents: 990,
      paymentMethod: "card",
      vat: [{ rateBp: 550, baseCents: 938, vatCents: 52 }],
      items: [
        { label: "Lait", quantity: 2, unitPriceCents: 125, totalCents: 250 },
        { label: "Café", quantity: 1, unitPriceCents: 790, totalCents: 790 },
      ],
      discountsCents: -50,
      returnDeadline: null,
      warrantyUntil: null,
    });
  });

  it.each([["not json"], [42], [{ merchant: 3 }]])("rejects %j", (raw) => {
    expect(parseModelReceipt(raw)).toBeNull();
  });

  it("drops a float total and unknown payment methods", () => {
    const r = parseModelReceipt({
      merchant: null,
      date: null,
      total: "12.5",
      paymentMethod: "bitcoin",
      items: [],
    });
    expect(r).toMatchObject({ totalCents: null, paymentMethod: null, merchantRaw: null });
  });
});
