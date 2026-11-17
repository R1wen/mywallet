/**
 * Categorization (pure, ADR-038): rules learned from my corrections, applied to movements
 * (merchant or label) and to receipt lines (label), and "ma dépense réelle" split by
 * category when a receipt's lines have their own category.
 */
import { netLineAmounts } from "./claims";
import { allocateProportionally, type Cents } from "./money";

export const RULE_MATCH_TYPES = ["contains", "equals", "starts_with", "merchant"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export type CategoryRule = {
  id: string;
  matchType: RuleMatchType;
  /** Normalized text (see normalizeText); null for merchant rules. */
  pattern: string | null;
  merchantId: string | null;
  categoryId: string;
  /** Lower first. */
  priority: number;
  active: boolean;
};

/** Default priorities of learned rules: a merchant rule before a keyword rule. */
export const MERCHANT_RULE_PRIORITY = 20;
export const KEYWORD_RULE_PRIORITY = 30;

export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Keyword of a receipt line for a learned rule: up to three words, without sizes,
 * quantities and codes ("LESSIVE LIQUIDE 2L" -> "lessive liquide"). Null if too short.
 */
export function keywordOf(label: string): string | null {
  const words = normalizeText(label)
    .split(" ")
    .filter((w) => w.length > 1 && !/\d/.test(w))
    .slice(0, 3);
  const keyword = words.join(" ");
  return keyword.length >= 3 ? keyword : null;
}

function matches(rule: CategoryRule, label: string, merchantId: string | null): boolean {
  if (rule.matchType === "merchant") return merchantId !== null && rule.merchantId === merchantId;
  const pattern = rule.pattern ? normalizeText(rule.pattern) : "";
  if (!pattern) return false;
  switch (rule.matchType) {
    case "equals":
      return label === pattern;
    case "starts_with":
      return label === pattern || label.startsWith(`${pattern} `);
    case "contains":
      return ` ${label} `.includes(` ${pattern} `);
  }
}

/** Category given by the first matching active rule (priority, then the longest pattern). */
export function matchCategory(
  input: { label: string; merchantId: string | null },
  rules: readonly CategoryRule[],
): string | null {
  const label = normalizeText(input.label);
  const ordered = rules
    .filter((r) => r.active)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (b.pattern?.length ?? 0) - (a.pattern?.length ?? 0) ||
        a.id.localeCompare(b.id),
    );
  return ordered.find((r) => matches(r, label, input.merchantId))?.categoryId ?? null;
}

/** Explicit choice first, then my rules, then the merchant's default category. */
export function resolveCategory(
  input: {
    explicit: string | null;
    label: string;
    merchantId: string | null;
    merchantDefault: string | null;
  },
  rules: readonly CategoryRule[],
): string | null {
  return input.explicit ?? matchCategory(input, rules) ?? input.merchantDefault;
}

export type RuleSuggestion = Pick<
  CategoryRule,
  "matchType" | "pattern" | "merchantId" | "categoryId"
>;

/**
 * Rule to propose after a correction ("Toujours classer … dans … ?"): by merchant when
 * there is one, else by keyword of the label. Null when my rules already say so.
 */
export function suggestRule(
  correction: { merchantId: string | null; label: string; categoryId: string },
  rules: readonly CategoryRule[],
): RuleSuggestion | null {
  if (matchCategory(correction, rules) === correction.categoryId) return null;
  if (correction.merchantId) {
    return {
      matchType: "merchant",
      pattern: null,
      merchantId: correction.merchantId,
      categoryId: correction.categoryId,
    };
  }
  const keyword = keywordOf(correction.label);
  if (!keyword) return null;
  return {
    matchType: "contains",
    pattern: keyword,
    merchantId: null,
    categoryId: correction.categoryId,
  };
}

/* -------------------------------------------------------------------------- */
/* My real expense by category                                                 */
/* -------------------------------------------------------------------------- */

export type ExpenseForCategories = {
  /** Positive amount paid. */
  totalCents: Cents;
  categoryId: string | null;
  /** Receipt lines; a line without category takes the expense's. */
  items: readonly { id: string; totalCents: Cents; categoryId: string | null }[];
  /** Others' shares (ADR-032): per line, or of the whole expense (`itemId` null). */
  shares: readonly { itemId: string | null; amountCents: Cents }[];
};

/**
 * My part of an expense per category. Line amounts are net of discounts; a line's shares
 * come off that line, whole-expense shares are spread pro rata over what is left.
 * The result always sums to the total minus the shares.
 */
export function myShareByCategory(e: ExpenseForCategories): Map<string | null, Cents> {
  const out = new Map<string | null, Cents>();
  const add = (cat: string | null, cents: Cents) => out.set(cat, (out.get(cat) ?? 0) + cents);
  const sharesTotal = e.shares.reduce((s, c) => s + c.amountCents, 0);
  if (!e.items.length) {
    add(e.categoryId, e.totalCents - sharesTotal);
    return out;
  }
  const net = netLineAmounts(e.items.map((i) => i.totalCents));
  const mine = e.items.map((item, i) => {
    const own = e.shares.filter((s) => s.itemId === item.id).reduce((s, c) => s + c.amountCents, 0);
    return Math.max((net[i] ?? 0) - own, 0);
  });
  const whole = e.shares.filter((s) => s.itemId === null).reduce((s, c) => s + c.amountCents, 0);
  if (whole > 0 && mine.some((m) => m > 0)) {
    const cut = allocateProportionally(whole, mine);
    for (let i = 0; i < mine.length; i++) mine[i] = (mine[i] ?? 0) - (cut[i] ?? 0);
  }
  e.items.forEach((item, i) => {
    if (item.totalCents > 0) add(item.categoryId ?? e.categoryId, mine[i] ?? 0);
  });
  // Lines that do not add up to the total (never expected): the gap stays in the expense.
  const gap = e.totalCents - sharesTotal - [...out.values()].reduce((s, v) => s + v, 0);
  if (gap !== 0) add(e.categoryId, gap);
  return out;
}
