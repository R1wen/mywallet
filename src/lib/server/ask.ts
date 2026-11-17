import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { categories, merchants, transactions } from "@/lib/db/schema";
import {
  describeQuery,
  matchName,
  monthsBetween,
  resolvePeriod,
  type AskMeasure,
} from "@/lib/domain/ask";
import { spentInScope } from "@/lib/domain/budgets";
import { formatMonthFr, monthBounds } from "@/lib/domain/dates";
import type { Cents } from "@/lib/domain/money";
import { ASK_JSON_SCHEMA, askPrompt, parseModelQuery, type ModelQuery } from "@/lib/validation/ask";
import { getImportSettings } from "./import-settings";
import { callModel } from "./structurers";
import { fail, ok, type Result } from "./result";
import { spendingByCategory } from "./spending";

/**
 * Questions in natural language (ADR-040): the model chosen in Réglages only translates
 * the question into a small query (it receives the question and the names of my
 * categories and merchants, never an amount); the server computes the answer.
 */

const TIMEOUT_MS = 30_000;
const MAX_MERCHANTS = 300;

export type Answer = {
  understood: string;
  measure: AskMeasure;
  /** Cents for spent/income, a number of purchases for count. */
  total: number;
  rows: { label: string; value: number }[];
};

type Options = { id: string; name: string; parentId?: string | null }[];

/** Is a question model configured for this user (the one chosen for receipts)? */
export async function questionModel(userId: string, db: Db = defaultDb) {
  const s = await getImportSettings(userId, db);
  if (s.structurer === "rules" || !s.available[s.structurer]) return null;
  if (s.structurer === "gemini" && !s.geminiConsentAt) return null;
  return s.structurer;
}

/** Translates the question with the model, then answers it from my data. */
export async function answerQuestion(
  userId: string,
  question: string,
  today: string,
  db: Db = defaultDb,
): Promise<Result<Answer>> {
  const model = await questionModel(userId, db);
  if (!model) {
    return fail("Choisissez Ollama ou Gemini dans Réglages pour poser des questions.");
  }
  const [cats, shops] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.userId, userId)),
    db
      .select({ id: merchants.id, name: merchants.name })
      .from(merchants)
      .where(
        and(
          eq(merchants.userId, userId),
          sql`exists (select 1 from transactions t
            where t.user_id = ${merchants}.user_id and t.merchant_id = ${merchants}.id)`,
        ),
      )
      .orderBy(desc(merchants.updatedAt))
      .limit(MAX_MERCHANTS),
  ]);

  let query: ModelQuery | null = null;
  try {
    query = parseModelQuery(
      await callModel(model, {
        timeoutMs: TIMEOUT_MS,
        schema: ASK_JSON_SCHEMA,
        prompt: askPrompt({
          today,
          categories: cats.map((c) => c.name),
          merchants: shops.map((m) => m.name),
          question,
        }),
      }),
    );
  } catch (e) {
    console.warn(`[ask:${model}] échec`, e instanceof Error ? e.name : "unknown");
    return fail("Le modèle n'a pas répondu. Réessayez dans un instant.");
  }
  if (!query) return fail("Question non comprise. Reformulez-la plus simplement.");
  return runQuery(userId, query, today, { categories: cats, merchants: shops }, db);
}

/** Executes a validated query on my data (deterministic, testable without a model). */
export async function runQuery(
  userId: string,
  query: ModelQuery,
  today: string,
  lists: { categories: Options; merchants: Options },
  db: Db = defaultDb,
): Promise<Result<Answer>> {
  const period = resolvePeriod(query.period, today);
  if (!period) return fail("Période non comprise. Précisez un mois ou une année.");
  const category = query.category ? matchName(query.category, lists.categories) : null;
  if (query.category && !category) return fail(`Catégorie « ${query.category} » introuvable.`);
  const merchant = query.merchant ? matchName(query.merchant, lists.merchants) : null;
  if (query.merchant && !merchant) return fail(`Magasin « ${query.merchant} » introuvable.`);

  const parentOf = new Map(lists.categories.map((c) => [c.id, c.parentId ?? null]));
  const nameOf = new Map(lists.categories.map((c) => [c.id, c.name]));
  const inScope = (id: string | null) =>
    !category || id === category.id || (id !== null && parentOf.get(id) === category.id);
  const understood = describeQuery({
    measure: query.measure,
    periodLabel: period.label,
    category: category?.name ?? null,
    merchant: merchant?.name ?? null,
    groupBy: query.groupBy,
  });

  const filtered = (from: string, to: string, kind: "expense" | "income") =>
    and(
      eq(transactions.userId, userId),
      eq(transactions.kind, kind),
      gte(transactions.occurredOn, from),
      lte(transactions.occurredOn, to),
      merchant ? eq(transactions.merchantId, merchant.id) : undefined,
    );

  /** My real spending in [from, to], per category (receipt lines included). */
  const spendingMap = async (from: string, to: string) => {
    if (!merchant) return spendingByCategory(userId, { from, to }, db);
    // Refunds from that merchant lower the spending, as without a merchant filter.
    const ids = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.kind, ["expense", "refund"]),
          gte(transactions.occurredOn, from),
          lte(transactions.occurredOn, to),
          eq(transactions.merchantId, merchant.id),
        ),
      );
    return spendingByCategory(userId, { transactionIds: ids.map((r) => r.id) }, db);
  };

  const measureIn = async (from: string, to: string): Promise<number> => {
    if (query.measure === "spent") {
      return spentInScope(category?.id ?? null, await spendingMap(from, to), parentOf);
    }
    const rows = await db
      .select({ categoryId: transactions.categoryId, amountCents: transactions.amountCents })
      .from(transactions)
      .where(filtered(from, to, query.measure === "income" ? "income" : "expense"));
    const kept = rows.filter((r) => inScope(r.categoryId));
    return query.measure === "count" ? kept.length : kept.reduce((s, r) => s + r.amountCents, 0);
  };

  let rows: Answer["rows"] = [];
  if (query.groupBy === "month") {
    const months = monthsBetween(period.from, period.to).slice(-24);
    rows = await Promise.all(
      months.map(async (key) => {
        const y = Number(key.slice(0, 4));
        const m = Number(key.slice(5, 7));
        const b = monthBounds(y, m);
        return { label: formatMonthFr(y, m), value: await measureIn(b.from, b.to) };
      }),
    );
  } else if (query.groupBy === "category" && query.measure === "spent") {
    const map = await spendingMap(period.from, period.to);
    const grouped = new Map<string | null, Cents>();
    for (const [id, cents] of map) {
      if (!inScope(id)) continue;
      // Within a chosen category: its subcategories; otherwise the main categories.
      const key = category ? id : id ? (parentOf.get(id) ?? id) : null;
      grouped.set(key, (grouped.get(key) ?? 0) + cents);
    }
    rows = [...grouped]
      .map(([id, value]) => ({ label: id ? (nameOf.get(id) ?? "Autre") : "Non catégorisé", value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  } else if (query.groupBy === "merchant" && query.measure === "spent") {
    // Same rules as the total (receipt-line categories, shares, refunds), merchant by merchant.
    const txs = await db
      .select({ id: transactions.id, merchantId: transactions.merchantId, name: merchants.name })
      .from(transactions)
      .innerJoin(
        merchants,
        and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
      )
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.kind, ["expense", "refund"]),
          gte(transactions.occurredOn, period.from),
          lte(transactions.occurredOn, period.to),
          merchant ? eq(transactions.merchantId, merchant.id) : undefined,
        ),
      );
    const idsByName = new Map<string, string[]>();
    for (const t of txs) idsByName.set(t.name, [...(idsByName.get(t.name) ?? []), t.id]);
    rows = (
      await Promise.all(
        // Busiest merchants only: one computation each.
        [...idsByName]
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 30)
          .map(async ([label, ids]) => ({
            label,
            value: spentInScope(
              category?.id ?? null,
              await spendingByCategory(userId, { transactionIds: ids }, db),
              parentOf,
            ),
          })),
      )
    )
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  } else if (query.groupBy === "merchant") {
    const value =
      query.measure === "count"
        ? sql<number>`count(*)`.mapWith(Number)
        : sql<number>`sum(${transactions.amountCents})`.mapWith(Number);
    const grouped = await db
      .select({ name: merchants.name, value, categoryId: transactions.categoryId })
      .from(transactions)
      .innerJoin(
        merchants,
        and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
      )
      .where(filtered(period.from, period.to, query.measure === "income" ? "income" : "expense"))
      .groupBy(merchants.name, transactions.categoryId);
    const byName = new Map<string, number>();
    for (const g of grouped) {
      if (inScope(g.categoryId)) byName.set(g.name, (byName.get(g.name) ?? 0) + g.value);
    }
    rows = [...byName]
      .map(([label, v]) => ({ label, value: v }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  const total =
    query.groupBy === "month"
      ? rows.reduce((s, r) => s + r.value, 0)
      : await measureIn(period.from, period.to);
  return ok({ understood, measure: query.measure, total, rows });
}
