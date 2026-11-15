import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  formatCents,
  parseAmountToCents,
  splitEvenly,
  sumCents,
} from "./money";

/** Intl uses narrow/no-break spaces; normalize so assertions stay readable. */
const n = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

describe("formatCents", () => {
  it("formats euros in French", () => {
    expect(n(formatCents(123456))).toBe("1 234,56 €");
    expect(n(formatCents(0))).toBe("0,00 €");
    expect(n(formatCents(5))).toBe("0,05 €");
  });

  it("uses a plain minus for negatives by default", () => {
    expect(n(formatCents(-8000))).toBe("-80,00 €");
  });

  it("can force an explicit sign", () => {
    expect(n(formatCents(250000, { sign: "always" }))).toBe("+2 500,00 €");
    expect(n(formatCents(-1999, { sign: "always" }))).toBe("-19,99 €");
    expect(n(formatCents(0, { sign: "always" }))).toBe("0,00 €");
  });

  it("can hide the sign", () => {
    expect(n(formatCents(-1999, { sign: "never" }))).toBe("19,99 €");
  });

  it("supports other currencies", () => {
    expect(n(formatCents(1000, { currency: "USD" }))).toBe("10,00 $US");
  });

  it("rejects non-integer cents", () => {
    expect(() => formatCents(1.5)).toThrow();
  });
});

describe("parseAmountToCents", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["12.50", 1250],
    ["0,05", 5],
    ["1 234,56", 123456],
    ["1\u202f234,56", 123456],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.234", 123400],
    ["-3,20", -320],
    ["+3,20", 320],
    ["  42,00 € ", 4200],
    ["€42", 4200],
  ])("parses %j", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(["", "abc", "12,345,67", "1,2,3", "12,555", "--3", "1e5"])("rejects %j", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});

describe("sumCents", () => {
  it("sums integers", () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(sumCents([])).toBe(0);
  });
});

describe("splitEvenly", () => {
  it("splits with no cent lost, extra cents go first", () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1001, 2)).toEqual([501, 500]);
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
  });

  it("handles negatives symmetrically", () => {
    expect(splitEvenly(-1000, 3)).toEqual([-334, -333, -333]);
  });

  it("rejects invalid part counts", () => {
    expect(() => splitEvenly(100, 0)).toThrow();
    expect(() => splitEvenly(100, 1.5)).toThrow();
  });
});

describe("allocateProportionally", () => {
  it("allocates a discount pro rata with exact sum (largest remainder)", () => {
    // 3 items 10,00 / 20,00 / 30,00 ; discount -1,00
    const parts = allocateProportionally(-100, [1000, 2000, 3000]);
    expect(parts).toEqual([-17, -33, -50]);
    expect(sumCents(parts)).toBe(-100);
  });

  it("keeps the sum exact on awkward ratios", () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(sumCents(parts)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it("breaks remainder ties by original order", () => {
    expect(allocateProportionally(1, [50, 50])).toEqual([1, 0]);
  });

  it("returns zeros when total is zero", () => {
    expect(allocateProportionally(0, [10, 20])).toEqual([0, 0]);
  });

  it("splits evenly when all weights are zero", () => {
    expect(allocateProportionally(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });

  it("rejects negative weights and empty lists", () => {
    expect(() => allocateProportionally(100, [])).toThrow();
    expect(() => allocateProportionally(100, [10, -5])).toThrow();
  });
});
