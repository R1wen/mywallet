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
import { serverEnv } from "@/lib/env";
import { ASK_JSON_SCHEMA, askPrompt, parseModelQuery, type ModelQuery } from "@/lib/validation/ask";
import { getImportSettings } from "./import-settings";
import { fail, ok, type Result } from "./result";
import { othersShareSql } from "./shares-sql";
import { spendingByCategory } from "./spending";

/**
 * Questions in natural language (ADR-040): the model chosen in Réglages only translates
 * the question into a small query (it receives the question and the names of my
 * categories and merchants, never an amount); the server computes the answer.
 */

const TIMEOUT_MS = 30_000;
const MAX_MERCHANTS = 300;

async function askModel(name: "ollama" | "gemini", prompt: string): Promise<unknown> {
  const env = serverEnv();
  if (name === "ollama") {
    if (!env.OLLAMA_URL) return null;
    const res = await fetch(new URL("/api/chat", env.OLLAMA_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: ASK_JSON_SCHEMA,
        options: { temperature: 0 },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`ollama status ${res.status}`);
    return ((await res.json()) as { message?: { content?: string } }).message?.content ?? null;
  }
  if (!env.GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: ASK_JSON_SCHEMA,
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini status ${res.status}`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

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
      await askModel(
        model,
        askPrompt({
          today,
          categories: cats.map((c) => c.name),
          merchants: shops.map((m) => m.name),
          question,
        }),
      ),
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
    const ids = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(filtered(from, to, "expense"));
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
  } else if (query.groupBy === "merchant") {
    const value =
      query.measure === "count"
        ? sql<number>`count(*)`.mapWith(Number)
        : query.measure === "income"
          ? sql<number>`sum(${transactions.amountCents})`.mapWith(Number)
          : sql<number>`sum(-${transactions.amountCents} - ${othersShareSql})`.mapWith(Number);
    const grouped = await db
      .select({ name: merchants.name, value, categoryId: transactions.categoryId })
      .from(transactions)
      .innerJoin(
        merchants,
        and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
      )
      .where(
        and(
          filtered(period.from, period.to, query.measure === "income" ? "income" : "expense"),
          category
            ? inArray(
                transactions.categoryId,
                lists.categories.filter((c) => inScope(c.id)).map((c) => c.id),
              )
            : undefined,
        ),
      )
      .groupBy(merchants.name, transactions.categoryId);
    const byName = new Map<string, number>();
    for (const g of grouped) byName.set(g.name, (byName.get(g.name) ?? 0) + g.value);
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
