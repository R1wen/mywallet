import "server-only";
import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { type Conn, db as defaultDb } from "@/lib/db/client";
import { claims, transactionItems, transactions } from "@/lib/db/schema";
import { myShareByCategory } from "@/lib/domain/categorize";
import type { Cents } from "@/lib/domain/money";

/**
 * "Ma dépense réelle" per category over a date range (ADR-032, 038): my share of each
 * expense split by receipt-line category, minus merchant refunds. Feeds budgets and the
 * dashboard's spending by category.
 */
export async function spendingByCategory(
  userId: string,
  range: { from: string; to: string } | { transactionIds: string[] },
  db: Conn = defaultDb,
): Promise<Map<string | null, Cents>> {
  if ("transactionIds" in range && !range.transactionIds.length) return new Map();
  const inRange: SQL =
    "from" in range
      ? and(gte(transactions.occurredOn, range.from), lte(transactions.occurredOn, range.to))!
      : inArray(transactions.id, range.transactionIds);
  const scope = and(eq(transactions.userId, userId), inRange)!;
  const sameTx = and(eq(transactions.userId, userId), eq(transactions.kind, "expense"), inRange)!;

  const [expenses, refunds, items, shares] = await Promise.all([
    db
      .select({
        id: transactions.id,
        amountCents: transactions.amountCents,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(and(scope, eq(transactions.kind, "expense"))),
    db
      .select({
        categoryId: transactions.categoryId,
        cents: sql<number>`sum(${transactions.amountCents})`.mapWith(Number),
      })
      .from(transactions)
      .where(and(scope, eq(transactions.kind, "refund")))
      .groupBy(transactions.categoryId),
    db
      .select({
        id: transactionItems.id,
        transactionId: transactionItems.transactionId,
        totalCents: transactionItems.totalCents,
        categoryId: transactionItems.categoryId,
      })
      .from(transactionItems)
      .innerJoin(
        transactions,
        and(
          eq(transactions.userId, transactionItems.userId),
          eq(transactions.id, transactionItems.transactionId),
        ),
      )
      .where(sameTx)
      .orderBy(transactionItems.position, transactionItems.id),
    db
      .select({
        transactionId: claims.transactionId,
        itemId: claims.transactionItemId,
        // Others' share of a claim (ADR-032): pending/reimbursed in full, gifted as paid.
        amountCents: sql<number>`case
          when ${claims.status} in ('pending', 'reimbursed') then ${claims.amountCents}
          when ${claims.status} = 'gifted' then coalesce((
            select sum(p.amount_cents) from claim_payments p
            where p.user_id = ${claims}.user_id and p.claim_id = ${claims}.id), 0)
          else 0 end`.mapWith(Number),
      })
      .from(claims)
      .innerJoin(
        transactions,
        and(eq(transactions.userId, claims.userId), eq(transactions.id, claims.transactionId)),
      )
      .where(sameTx),
  ]);

  const group = <T extends { transactionId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.transactionId, [...(m.get(r.transactionId) ?? []), r]);
    return m;
  };
  const itemsOf = group(items);
  const sharesOf = group(shares);

  const out = new Map<string | null, Cents>();
  const add = (cat: string | null, cents: Cents) => out.set(cat, (out.get(cat) ?? 0) + cents);
  for (const e of expenses) {
    const parts = myShareByCategory({
      totalCents: -e.amountCents,
      categoryId: e.categoryId,
      items: itemsOf.get(e.id) ?? [],
      shares: sharesOf.get(e.id) ?? [],
    });
    for (const [cat, cents] of parts) add(cat, cents);
  }
  for (const r of refunds) add(r.categoryId, -r.cents);
  return out;
}
