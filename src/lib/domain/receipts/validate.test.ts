import { describe, expect, it } from "vitest";
import { formatCents } from "../money";
import type { ParsedReceipt } from "./parse";
import { duplicateKey, validateReceipt } from "./validate";

const base: ParsedReceipt = {
  merchantRaw: "CARREFOUR MARKET 0123",
  date: "2026-11-14",
  time: "18:42",
  currency: "EUR",
  totalCents: 990,
  paymentMethod: "card",
  vat: [{ rateBp: 550, baseCents: 938, vatCents: 52 }],
  items: [
    { label: "LAIT", quantity: 2, unitPriceCents: 125, totalCents: 250 },
    { label: "CAFE", quantity: 1, unitPriceCents: 790, totalCents: 790 },
  ],
  discountsCents: -50,
  returnDeadline: null,
  warrantyUntil: null,
};

const TODAY = "2026-11-16";

describe("validateReceipt", () => {
  it("is confident when everything is consistent", () => {
    const v = validateReceipt(base, TODAY);
    expect(v.issues).toEqual([]);
    expect(v.confidence).toEqual({
      merchant: 1,
      date: 1,
      total: 1,
      items: 1,
      vat: 1,
    });
    expect(v.level).toBe("high");
  });

  it("flags items that do not add up to the total", () => {
    const v = validateReceipt({ ...base, totalCents: 1290 }, TODAY);
    expect(v.issues).toContainEqual({
      field: "items",
      message: `La somme des articles (${formatCents(990)}) diffère du total (${formatCents(1290)}).`,
    });
    expect(v.confidence.items).toBe(0.3);
    expect(v.confidence.total).toBe(0.6);
  });

  it("flags inconsistent VAT", () => {
    const v = validateReceipt(
      { ...base, vat: [{ rateBp: 2000, baseCents: 938, vatCents: 52 }] },
      TODAY,
    );
    expect(v.issues.map((i) => i.field)).toContain("vat");
  });

  it.each([
    [null, "Date introuvable.", 0],
    ["2026-11-20", "Date dans le futur.", 0.2],
    ["2023-01-01", "Date ancienne (plus de 2 ans).", 0.5],
  ])("date %j", (date, message, score) => {
    const v = validateReceipt({ ...base, date }, TODAY);
    expect(v.issues).toContainEqual({ field: "date", message });
    expect(v.confidence.date).toBe(score);
  });

  it("requires a positive plausible total", () => {
    expect(validateReceipt({ ...base, totalCents: null }, TODAY).issues).toContainEqual({
      field: "total",
      message: "Total introuvable.",
    });
    expect(validateReceipt({ ...base, totalCents: 20_000_000 }, TODAY).confidence.total).toBe(0);
    expect(validateReceipt({ ...base, totalCents: null }, TODAY).level).toBe("low");
  });

  it("treats a receipt without items or VAT as medium, not as an error", () => {
    const v = validateReceipt({ ...base, items: [], vat: [], discountsCents: 0 }, TODAY);
    expect(v.confidence.items).toBe(0.5);
    expect(v.confidence.vat).toBe(0.5);
    expect(v.level).toBe("medium");
  });

  it("flags a missing merchant", () => {
    const v = validateReceipt({ ...base, merchantRaw: null }, TODAY);
    expect(v.confidence.merchant).toBe(0);
    expect(v.issues).toContainEqual({ field: "merchant", message: "Magasin introuvable." });
  });
});

describe("duplicateKey", () => {
  it("is the same for the same merchant, day and total", () => {
    expect(duplicateKey("Carrefour Market", "2026-11-14", 990)).toBe(
      duplicateKey("CARREFOUR MARKET 0123", "2026-11-14", 990),
    );
    expect(duplicateKey("Carrefour", "2026-11-14", 990)).not.toBe(
      duplicateKey("Carrefour", "2026-11-14", 991),
    );
    expect(duplicateKey("Carrefour", null, 990)).toBeNull();
  });
});
