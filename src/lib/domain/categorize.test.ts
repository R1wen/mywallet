import { describe, expect, it } from "vitest";
import {
  keywordOf,
  matchCategory,
  myShareByCategory,
  normalizeText,
  resolveCategory,
  suggestRule,
  type CategoryRule,
} from "./categorize";

describe("normalizeText", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeText("  CAFÉ Moulu, 250g ! ")).toBe("cafe moulu 250g");
  });
});

describe("keywordOf", () => {
  it.each([
    ["LESSIVE LIQUIDE 2L", "lessive liquide"],
    ["EAU MINERALE 6X1,5L", "eau minerale"],
    ["CAFE MOULU 250G", "cafe moulu"],
    ["YAOURT NATURE X8 BIO GRAND FORMAT", "yaourt nature bio"],
    ["Pizza", "pizza"],
    ["2 X 1,25", null],
    ["AB", null],
  ])("%s -> %s", (label, keyword) => {
    expect(keywordOf(label)).toBe(keyword);
  });
});

const rule = (over: Partial<CategoryRule>): CategoryRule => ({
  id: "r",
  matchType: "contains",
  pattern: null,
  merchantId: null,
  categoryId: "x",
  priority: 100,
  active: true,
  ...over,
});

describe("matchCategory", () => {
  const rules = [
    rule({ id: "1", pattern: "lessive", categoryId: "maison", priority: 30 }),
    rule({
      id: "2",
      matchType: "merchant",
      merchantId: "amazon",
      categoryId: "shopping",
      priority: 20,
    }),
    rule({ id: "3", pattern: "navigo", categoryId: "transport", priority: 10 }),
    rule({ id: "4", matchType: "equals", pattern: "eau", categoryId: "boissons", priority: 30 }),
    rule({
      id: "5",
      matchType: "starts_with",
      pattern: "vir sepa",
      categoryId: "virements",
      priority: 40,
    }),
    rule({ id: "6", pattern: "lessive liquide", categoryId: "entretien", priority: 30 }),
    rule({ id: "7", pattern: "pain", categoryId: "off", active: false }),
  ];

  it.each([
    [{ label: "LESSIVE POUDRE", merchantId: null }, "maison"],
    // Same priority: the longest pattern is the most specific.
    [{ label: "Lessive liquide 2L", merchantId: null }, "entretien"],
    [{ label: "Colis", merchantId: "amazon" }, "shopping"],
    // Lower priority number wins.
    [{ label: "Pass Navigo", merchantId: "amazon" }, "transport"],
    [{ label: "EAU", merchantId: null }, "boissons"],
    [{ label: "EAU GAZEUSE", merchantId: null }, null],
    [{ label: "VIR SEPA LOYER", merchantId: null }, "virements"],
    // Whole words only: "pain" must not match "painting", inactive rules are ignored.
    [{ label: "PAIN COMPLET", merchantId: null }, null],
    [{ label: "lessiveuse", merchantId: null }, null],
  ])("%j -> %s", (input, expected) => {
    expect(matchCategory(input, rules)).toBe(expected);
  });
});

describe("resolveCategory", () => {
  const rules = [rule({ pattern: "lessive", categoryId: "maison" })];
  it("keeps the explicit choice, then rules, then the merchant default", () => {
    expect(
      resolveCategory(
        { explicit: "a", label: "lessive", merchantId: null, merchantDefault: "b" },
        rules,
      ),
    ).toBe("a");
    expect(
      resolveCategory(
        { explicit: null, label: "lessive", merchantId: null, merchantDefault: "b" },
        rules,
      ),
    ).toBe("maison");
    expect(
      resolveCategory(
        { explicit: null, label: "pain", merchantId: null, merchantDefault: "b" },
        rules,
      ),
    ).toBe("b");
    expect(
      resolveCategory(
        { explicit: null, label: "pain", merchantId: null, merchantDefault: null },
        rules,
      ),
    ).toBeNull();
  });
});

describe("suggestRule", () => {
  it("proposes a merchant rule when the movement has a merchant", () => {
    expect(
      suggestRule({ merchantId: "amazon", label: "AMAZON EU", categoryId: "maison" }, []),
    ).toEqual({ matchType: "merchant", pattern: null, merchantId: "amazon", categoryId: "maison" });
  });

  it("proposes a keyword rule for a receipt line", () => {
    expect(
      suggestRule({ merchantId: null, label: "LESSIVE LIQUIDE 2L", categoryId: "maison" }, []),
    ).toEqual({
      matchType: "contains",
      pattern: "lessive liquide",
      merchantId: null,
      categoryId: "maison",
    });
  });

  it("proposes nothing when the rules already give that category or no keyword exists", () => {
    const rules = [rule({ matchType: "merchant", merchantId: "amazon", categoryId: "maison" })];
    expect(
      suggestRule({ merchantId: "amazon", label: "x", categoryId: "maison" }, rules),
    ).toBeNull();
    expect(
      suggestRule({ merchantId: null, label: "2 X 1,25", categoryId: "maison" }, []),
    ).toBeNull();
  });
});

describe("myShareByCategory", () => {
  it("puts an expense without lines in its category, minus others' shares", () => {
    expect(
      myShareByCategory({
        totalCents: 9000,
        categoryId: "resto",
        items: [],
        shares: [{ itemId: null, amountCents: 3000 }],
      }),
    ).toEqual(new Map([["resto", 6000]]));
  });

  it("splits a receipt by line category, discounts and shares included", () => {
    // Groceries 30 €, detergent 20 € (household), discount -5 € spread 3 € / 2 €;
    // Léa owes the detergent line in full (18 €).
    const r = myShareByCategory({
      totalCents: 4500,
      categoryId: "courses",
      items: [
        { id: "a", totalCents: 3000, categoryId: null },
        { id: "b", totalCents: 2000, categoryId: "maison" },
        { id: "c", totalCents: -500, categoryId: null },
      ],
      shares: [{ itemId: "b", amountCents: 1800 }],
    });
    expect(r).toEqual(
      new Map([
        ["courses", 2700],
        ["maison", 0],
      ]),
    );
  });

  it("spreads a whole-expense share over the lines pro rata", () => {
    const r = myShareByCategory({
      totalCents: 1000,
      categoryId: "courses",
      items: [
        { id: "a", totalCents: 600, categoryId: null },
        { id: "b", totalCents: 400, categoryId: "maison" },
      ],
      shares: [{ itemId: null, amountCents: 500 }],
    });
    expect(r).toEqual(
      new Map([
        ["courses", 300],
        ["maison", 200],
      ]),
    );
  });

  it("always sums to the total minus the shares", () => {
    const r = myShareByCategory({
      totalCents: 1001,
      categoryId: null,
      items: [
        { id: "a", totalCents: 333, categoryId: "x" },
        { id: "b", totalCents: 333, categoryId: "y" },
        { id: "c", totalCents: 335, categoryId: "z" },
      ],
      shares: [{ itemId: null, amountCents: 1 }],
    });
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(1000);
  });
});
