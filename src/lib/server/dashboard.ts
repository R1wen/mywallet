import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { monthBounds, type MonthKey } from "@/lib/domain/dates";
import {
  OTHER_CATEGORY,
  spendByCategory,
  summarizeFlows,
  type FlowSummary,
} from "@/lib/domain/transactions";
import { listAccountsWithBalance, type AccountWithBalance } from "./accounts";
import { listCategories } from "./categories";
import { getReceivables, othersShareSql } from "./sharing";
import { spendingByCategory } from "./spending";
import { listTransactions, type TransactionListRow } from "./transactions";

export type CategoryShare = { id: string | null; name: string; spentCents: number };

export type MonthDashboard = {
  month: MonthKey;
  accounts: AccountWithBalance[];
  totalBalanceCents: number;
  flows: FlowSummary;
  topCategories: CategoryShare[];
  recent: TransactionListRow[];
  /** Still owed by people, all months (claims). */
  receivables: Awaited<ReturnType<typeof getReceivables>>;
};

const TOP_CATEGORIES = 5;

/** Month overview: balances, flows, spending by main category, latest movements. */
export async function getMonthDashboard(
  userId: string,
  month: MonthKey,
  db: Db = defaultDb,
): Promise<MonthDashboard> {
  const { from, to } = monthBounds(month.year, month.month);
  const [accounts, rows, cats, recent, receivables, byCategory] = await Promise.all([
    listAccountsWithBalance(userId, db),
    db
      .select({
        kind: transactions.kind,
        amountCents: transactions.amountCents,
        categoryId: transactions.categoryId,
        othersShareCents: othersShareSql,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.occurredOn, from),
          lte(transactions.occurredOn, to),
        ),
      ),
    listCategories(userId, db),
    listTransactions(userId, { tri: "date", ordre: "desc", page: 1, du: from, au: to }, db, 8).then(
      (r) => r.rows,
    ),
    getReceivables(userId, db),
    spendingByCategory(userId, { from, to }, db),
  ]);

  // Spending is rolled up to the main category (two levels max, ADR-021).
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rootOf = (id: string | null) => {
    const c = id ? byId.get(id) : undefined;
    return c ? (c.parentId ?? c.id) : null;
  };
  // My real expense per category, receipt lines included (ADR-038).
  const shares = spendByCategory(
    [...byCategory].map(([categoryId, cents]) => ({
      kind: "expense" as const,
      amountCents: -cents,
      categoryId: rootOf(categoryId),
    })),
    TOP_CATEGORIES,
  );

  return {
    month,
    accounts,
    totalBalanceCents: accounts.reduce((sum, a) => sum + a.balanceCents, 0),
    flows: summarizeFlows(rows),
    topCategories: shares.map((s) => ({
      id: s.categoryId,
      name:
        s.categoryId === OTHER_CATEGORY
          ? "Autres"
          : s.categoryId
            ? (byId.get(s.categoryId)?.name ?? "Catégorie supprimée")
            : "Non catégorisé",
      spentCents: s.spentCents,
    })),
    recent,
    receivables,
  };
}
