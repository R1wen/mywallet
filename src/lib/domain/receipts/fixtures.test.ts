import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Expected = {
  merchant: string;
  merchantRaw: string;
  date: string;
  time: string | null;
  currency: string;
  totalCents: number;
  paymentMethod: string | null;
  vat: { rateBp: number; baseCents: number; vatCents: number }[];
  items: { label: string; quantity: number; unitPriceCents: number; totalCents: number }[];
  discountsCents: number;
  returnDeadline: string | null;
  warrantyUntil: string | null;
  difficulty: string[];
};

const ROOT = path.join(process.cwd(), "fixtures", "receipts");
const ids = existsSync(ROOT)
  ? readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(ROOT, d.name, "expected.json")))
      .map((d) => d.name)
  : [];

function load(id: string): Expected {
  return JSON.parse(readFileSync(path.join(ROOT, id, "expected.json"), "utf8")) as Expected;
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

describe("receipt fixtures", () => {
  it("has at least 15 public fixtures", () => {
    expect(ids.length).toBeGreaterThanOrEqual(15);
  });

  describe.each(ids)("%s", (id) => {
    const e = load(id);

    it("uses integer cents everywhere", () => {
      const amounts = [
        e.totalCents,
        e.discountsCents,
        ...e.items.flatMap((i) => [i.unitPriceCents, i.totalCents]),
        ...e.vat.flatMap((v) => [v.rateBp, v.baseCents, v.vatCents]),
      ];
      for (const a of amounts) expect(Number.isInteger(a)).toBe(true);
      expect(e.discountsCents).toBeLessThanOrEqual(0);
    });

    it("items sum plus discounts equals the total", () => {
      const sum = e.items.reduce((s, i) => s + i.totalCents, 0);
      expect(sum + e.discountsCents).toBe(e.totalCents);
    });

    it("has consistent VAT lines", () => {
      expect(e.vat.length).toBeGreaterThan(0);
      for (const v of e.vat) {
        expect(Math.abs(v.vatCents - (v.baseCents * v.rateBp) / 10000)).toBeLessThanOrEqual(2);
      }
      const ttc = e.vat.reduce((s, v) => s + v.baseCents + v.vatCents, 0);
      expect(ttc).toBe(e.totalCents);
    });

    it("has valid ISO dates and time", () => {
      expect(isIsoDate(e.date)).toBe(true);
      if (e.time !== null) expect(e.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (e.returnDeadline !== null) expect(isIsoDate(e.returnDeadline)).toBe(true);
      if (e.warrantyUntil !== null) expect(isIsoDate(e.warrantyUntil)).toBe(true);
    });

    it("has item totals matching quantity x unit price", () => {
      for (const i of e.items) {
        expect(Math.abs(i.quantity * i.unitPriceCents - i.totalCents)).toBeLessThanOrEqual(1);
      }
    });

    it("has a source file and truth text", () => {
      const files = readdirSync(path.join(ROOT, id));
      expect(files.some((f) => /^source\.(png|jpe?g|webp|pdf)$/.test(f))).toBe(true);
      expect(files).toContain("truth.txt");
    });
  });
});
