import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { type Conn, db as defaultDb, type Db } from "@/lib/db/client";
import { categories, categorizationRules, merchants } from "@/lib/db/schema";
import {
  KEYWORD_RULE_PRIORITY,
  MERCHANT_RULE_PRIORITY,
  normalizeText,
  suggestRule,
  type CategoryRule,
  type RuleSuggestion,
} from "@/lib/domain/categorize";
import { fail, isForeignKeyViolation, NOT_FOUND, ok, type Result } from "./result";

/**
 * Categorization rules learned from my corrections (ADR-038). Every function takes the
 * session `userId` first; composite FKs keep categories and merchants inside the account.
 */

/** Active and inactive rules, for matching inside a write. */
export async function loadRules(userId: string, db: Conn = defaultDb): Promise<CategoryRule[]> {
  return db
    .select({
      id: categorizationRules.id,
      matchType: categorizationRules.matchType,
      pattern: categorizationRules.pattern,
      merchantId: categorizationRules.merchantId,
      categoryId: categorizationRules.categoryId,
      priority: categorizationRules.priority,
      active: categorizationRules.active,
    })
    .from(categorizationRules)
    .where(eq(categorizationRules.userId, userId));
}

export type RuleRow = CategoryRule & { categoryName: string; merchantName: string | null };

export async function listRules(userId: string, db: Db = defaultDb): Promise<RuleRow[]> {
  return db
    .select({
      id: categorizationRules.id,
      matchType: categorizationRules.matchType,
      pattern: categorizationRules.pattern,
      merchantId: categorizationRules.merchantId,
      categoryId: categorizationRules.categoryId,
      priority: categorizationRules.priority,
      active: categorizationRules.active,
      categoryName: categories.name,
      merchantName: merchants.name,
    })
    .from(categorizationRules)
    .innerJoin(
      categories,
      and(
        eq(categories.userId, categorizationRules.userId),
        eq(categories.id, categorizationRules.categoryId),
      ),
    )
    .leftJoin(
      merchants,
      and(
        eq(merchants.userId, categorizationRules.userId),
        eq(merchants.id, categorizationRules.merchantId),
      ),
    )
    .where(eq(categorizationRules.userId, userId))
    .orderBy(
      asc(categorizationRules.priority),
      asc(sql`coalesce(${merchants.name}, ${categorizationRules.pattern})`),
    );
}

/** Creates the rule, or points the existing rule for the same merchant or pattern to the category. */
export async function saveRule(
  userId: string,
  rule: RuleSuggestion,
  db: Conn = defaultDb,
): Promise<Result<{ id: string }>> {
  const pattern = rule.pattern ? normalizeText(rule.pattern) : null;
  const priority = rule.matchType === "merchant" ? MERCHANT_RULE_PRIORITY : KEYWORD_RULE_PRIORITY;
  try {
    const [row] = await db
      .insert(categorizationRules)
      .values({
        userId,
        matchType: rule.matchType,
        pattern,
        merchantId: rule.merchantId,
        categoryId: rule.categoryId,
        priority,
      })
      .onConflictDoUpdate({
        target: [
          categorizationRules.userId,
          categorizationRules.matchType,
          categorizationRules.pattern,
          categorizationRules.merchantId,
        ],
        set: { categoryId: rule.categoryId, active: true },
      })
      .returning({ id: categorizationRules.id });
    return ok(row!);
  } catch (e) {
    if (isForeignKeyViolation(e)) return fail("Catégorie ou magasin introuvable.");
    throw e;
  }
}

export async function deleteRule(userId: string, id: string, db: Db = defaultDb): Promise<Result> {
  const rows = await db
    .delete(categorizationRules)
    .where(and(eq(categorizationRules.userId, userId), eq(categorizationRules.id, id)))
    .returning({ id: categorizationRules.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

export async function setRuleActive(
  userId: string,
  id: string,
  active: boolean,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(categorizationRules)
    .set({ active })
    .where(and(eq(categorizationRules.userId, userId), eq(categorizationRules.id, id)))
    .returning({ id: categorizationRules.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/** A rule to propose to the user, with the sentence shown in the confirmation. */
export type ProposedRule = RuleSuggestion & { text: string };

/**
 * Rules to propose after corrections ("Toujours classer … dans … ?"), at most one per
 * merchant or keyword, skipping what my rules already decide.
 */
export async function proposeRules(
  userId: string,
  corrections: { merchantId: string | null; label: string; categoryId: string }[],
  db: Db = defaultDb,
): Promise<ProposedRule[]> {
  if (!corrections.length) return [];
  const rules = await loadRules(userId, db);
  const seen = new Set<string>();
  const proposals: RuleSuggestion[] = [];
  for (const c of corrections) {
    const s = suggestRule(c, rules);
    if (!s) continue;
    const key = `${s.matchType}|${s.pattern ?? ""}|${s.merchantId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push(s);
  }
  if (!proposals.length) return [];
  const catIds = [...new Set(proposals.map((p) => p.categoryId))];
  const merchantIds = [...new Set(proposals.flatMap((p) => (p.merchantId ? [p.merchantId] : [])))];
  const [cats, shops] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.userId, userId), inArray(categories.id, catIds))),
    merchantIds.length
      ? db
          .select({ id: merchants.id, name: merchants.name })
          .from(merchants)
          .where(and(eq(merchants.userId, userId), inArray(merchants.id, merchantIds)))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const shopName = new Map(shops.map((m) => [m.id, m.name]));
  return proposals.flatMap((p) => {
    const category = catName.get(p.categoryId);
    const subject = p.merchantId ? shopName.get(p.merchantId) : `« ${p.pattern} »`;
    return category && subject ? [{ ...p, text: `${subject} dans ${category}` }] : [];
  });
}
