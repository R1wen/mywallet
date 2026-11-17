import "server-only";
import { and, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import {
  categories,
  merchants,
  receipts,
  recurringRules,
  subscriptionDismissals,
  transactions,
} from "@/lib/db/schema";
import {
  compareCategories,
  detectAnomalies,
  detectSubscriptions,
  forecastMonthEnd,
  subscriptionKey,
  upcomingDeadlines,
  type Anomaly,
  type CategoryComparison,
  type Deadline,
  type Forecast,
  type Subscription,
} from "@/lib/domain/analytics";
import {
  daysInMonth,
  formatMonthFr,
  formatMonthKey,
  monthBounds,
  shiftMonth,
  type MonthKey,
} from "@/lib/domain/dates";
import { centsToInput, type Cents } from "@/lib/domain/money";
import { buildMonthlyReport, type ReportSection } from "@/lib/domain/report";
import { recurringRuleInputSchema } from "@/lib/validation/recurring";
import { listBudgets, listGoals } from "./budgets";
import { createRule, generateOccurrences, getResteAVivre } from "./recurring";
import { fail, NOT_FOUND, ok, type Result } from "./result";
import { getReceivables } from "./sharing";
import { othersShareSql } from "./shares-sql";
import { spendingByCategory } from "./spending";

/**
 * Analyses (ADR-039 to 041). Every function takes the session `userId` first and only
 * reads that user's rows.
 */

const keyOf = (m: MonthKey) => formatMonthKey(m);
const boundsOf = (m: MonthKey) => monthBounds(m.year, m.month);

/* -------------------------------------------------------------------------- */
/* Month by month                                                              */
/* -------------------------------------------------------------------------- */

export type MonthPoint = { month: string; label: string; spentCents: Cents; incomeCents: Cents };

/** My real expense and my income for the `count` months ending with `end`. */
export async function monthlySeries(
  userId: string,
  end: MonthKey,
  count = 12,
  db: Db = defaultDb,
): Promise<MonthPoint[]> {
  const start = shiftMonth(end.year, end.month, -(count - 1));
  const month = sql<string>`to_char(${transactions.occurredOn}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      spent: sql<number>`coalesce(sum(case
        when ${transactions.kind} = 'expense' then -${transactions.amountCents} - ${othersShareSql}
        when ${transactions.kind} = 'refund' then -${transactions.amountCents}
        else 0 end), 0)`.mapWith(Number),
      income: sql<number>`coalesce(sum(case
        when ${transactions.kind} = 'income' then ${transactions.amountCents} else 0 end), 0)`.mapWith(
        Number,
      ),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredOn, boundsOf(start).from),
        lte(transactions.occurredOn, boundsOf(end).to),
      ),
    )
    .groupBy(month);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(start.year, start.month, i);
    const r = byMonth.get(keyOf(m));
    return {
      month: keyOf(m),
      label: formatMonthFr(m.year, m.month),
      spentCents: Math.max(r?.spent ?? 0, 0),
      incomeCents: r?.income ?? 0,
    };
  });
}

async function categoryInfo(userId: string, db: Db) {
  const cats = await db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.userId, userId));
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rootOf = (id: string | null) => {
    const c = id ? byId.get(id) : undefined;
    return c ? (c.parentId ?? c.id) : null;
  };
  const nameOf = (id: string | null) =>
    id ? (byId.get(id)?.name ?? "Catégorie supprimée") : "Non catégorisé";
  return { rootOf, nameOf };
}

/** Spending by main category for a month. */
async function rootSpending(
  userId: string,
  m: MonthKey,
  rootOf: (id: string | null) => string | null,
  db: Db,
) {
  const out = new Map<string | null, Cents>();
  for (const [cat, cents] of await spendingByCategory(userId, boundsOf(m), db)) {
    const root = rootOf(cat);
    out.set(root, (out.get(root) ?? 0) + cents);
  }
  return out;
}

export type NamedComparison = CategoryComparison & { name: string };

/** Main categories this month against last month and the 3 months before. */
export async function categoryComparison(
  userId: string,
  month: MonthKey,
  db: Db = defaultDb,
): Promise<NamedComparison[]> {
  const { rootOf, nameOf } = await categoryInfo(userId, db);
  const months = [0, -1, -2, -3].map((d) => shiftMonth(month.year, month.month, d));
  const [maps, [first]] = await Promise.all([
    Promise.all(months.map((m) => rootSpending(userId, m, rootOf, db))),
    db
      .select({ day: sql<string | null>`min(${transactions.occurredOn})` })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
  ]);
  const [current, previous, ...older] = maps;
  // Average of the three months before, over the months I already had movements.
  const before = [previous!, ...older].filter(
    (_, i) => first?.day && boundsOf(months[i + 1]!).to >= first.day,
  );
  const average = new Map<string | null, Cents>();
  for (const map of before) {
    for (const [k, v] of map) average.set(k, (average.get(k) ?? 0) + v);
  }
  for (const [k, v] of average) average.set(k, Math.round(v / before.length));
  return compareCategories(current!, previous!, average).map((r) => ({
    ...r,
    name: nameOf(r.categoryId),
  }));
}

/* -------------------------------------------------------------------------- */
/* Subscriptions                                                               */
/* -------------------------------------------------------------------------- */

export type SubscriptionView = Subscription & {
  name: string;
  tracked: boolean;
  accountId: string;
  categoryId: string | null;
};

/** Monthly charges of the last 13 months; ignored ones are left out. */
export async function listSubscriptions(
  userId: string,
  today: string,
  db: Db = defaultDb,
): Promise<SubscriptionView[]> {
  const from = monthBounds(
    ...((): [number, number] => {
      const s = shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -13);
      return [s.year, s.month];
    })(),
  ).from;
  const [charges, rules, dismissed] = await Promise.all([
    db
      .select({
        id: transactions.id,
        date: transactions.occurredOn,
        amountCents: sql<number>`-${transactions.amountCents}`.mapWith(Number),
        merchantId: transactions.merchantId,
        label: transactions.label,
        merchantName: merchants.name,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .leftJoin(
        merchants,
        and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
      )
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.kind, "expense"),
          gte(transactions.occurredOn, from),
          lte(transactions.occurredOn, today),
        ),
      ),
    db
      .select({ merchantId: recurringRules.merchantId, label: recurringRules.label })
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.userId, userId),
          eq(recurringRules.active, true),
          or(isNull(recurringRules.endOn), gte(recurringRules.endOn, today)),
        ),
      ),
    db
      .select({ key: subscriptionDismissals.key })
      .from(subscriptionDismissals)
      .where(eq(subscriptionDismissals.userId, userId)),
  ]);
  const trackedKeys = new Set(rules.map((r) => subscriptionKey(r)));
  const ignored = new Set(dismissed.map((d) => d.key));
  return detectSubscriptions(charges, today)
    .filter((s) => !ignored.has(s.key))
    .map((s) => {
      const last = charges.find((c) => c.date === s.lastDate && subscriptionKey(c) === s.key)!;
      return {
        ...s,
        name: last.merchantName ?? s.label,
        tracked: trackedKeys.has(s.key),
        accountId: last.accountId,
        categoryId: last.categoryId,
      };
    });
}

/** Hides a detected subscription for good (it can be tracked by hand later). */
export async function dismissSubscription(
  userId: string,
  key: string,
  db: Db = defaultDb,
): Promise<Result> {
  await db.insert(subscriptionDismissals).values({ userId, key }).onConflictDoNothing();
  return ok(undefined);
}

/** "Suivre dans Récurrent": a monthly rule from the next expected charge. */
export async function trackSubscription(
  userId: string,
  key: string,
  today: string,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  const sub = (await listSubscriptions(userId, today, db)).find((s) => s.key === key);
  if (!sub) return fail(NOT_FOUND);
  if (sub.tracked) return fail("Cet abonnement est déjà suivi dans Récurrent.");
  const input = recurringRuleInputSchema.parse({
    kind: "expense",
    label: sub.name,
    amount: centsToInput(sub.lastAmountCents),
    merchantName: sub.merchantId ? sub.name : "",
    accountId: sub.accountId,
    toAccountId: "",
    categoryId: sub.categoryId ?? "",
    frequency: "monthly",
    interval: 1,
    dayOfMonth: sub.dayOfMonth,
    startOn: sub.nextDate,
    endOn: "",
  });
  return createRule(userId, input, today, db);
}

/* -------------------------------------------------------------------------- */
/* Unusual expenses, forecast, deadlines                                       */
/* -------------------------------------------------------------------------- */

/** Expenses of the month far above the usual size of their category (6 months before). */
export async function listAnomalies(
  userId: string,
  month: MonthKey,
  db: Db = defaultDb,
): Promise<Anomaly[]> {
  const { from, to } = boundsOf(month);
  const historyFrom = boundsOf(shiftMonth(month.year, month.month, -6)).from;
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.occurredOn,
      amountCents: sql<number>`-${transactions.amountCents} - ${othersShareSql}`.mapWith(Number),
      merchantId: transactions.merchantId,
      label: transactions.label,
      categoryId: transactions.categoryId,
      recurring: isNotNull(transactions.recurringRuleId),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, "expense"),
        gte(transactions.occurredOn, historyFrom),
        lte(transactions.occurredOn, to),
      ),
    );
  // Planned charges (rent...) are expected, never "unusual".
  const flexible = rows.filter((r) => !r.recurring && r.amountCents > 0);
  return detectAnomalies(
    flexible.filter((r) => r.date >= from),
    flexible.filter((r) => r.date < from),
  );
}

/** Everyday cash out: expenses not coming from a recurring rule, full amount paid. */
async function variableSpending(userId: string, from: string, to: string, db: Db) {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(-${transactions.amountCents}), 0)`.mapWith(Number),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, "expense"),
        isNull(transactions.recurringRuleId),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
      ),
    );
  return row?.cents ?? 0;
}

export type ForecastView = Forecast & { balanceCents: Cents; plannedNetCents: Cents };

/** End-of-month balance of the spendable accounts (ADR-039). */
export async function getForecast(
  userId: string,
  today: string,
  db: Db = defaultDb,
): Promise<ForecastView> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const { from } = monthBounds(year, month);
  const start = shiftMonth(year, month, -3);
  const end = shiftMonth(year, month, -1);
  // This month's planned occurrences must exist before they are counted (as the dashboard).
  await generateOccurrences(userId, monthBounds(year, month).to);
  const [rav, spentNow, spentBefore, firstMovement] = await Promise.all([
    getResteAVivre(userId, today, db),
    variableSpending(userId, from, today, db),
    variableSpending(userId, boundsOf(start).from, boundsOf(end).to, db),
    db
      .select({ first: sql<string | null>`min(${transactions.occurredOn})` })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
  ]);
  // The usual pace needs three full months of history.
  const first = firstMovement[0]?.first ?? null;
  const days = [0, 1, 2].reduce((s, i) => {
    const m = shiftMonth(start.year, start.month, i);
    return s + daysInMonth(m.year, m.month);
  }, 0);
  const usual = first && first <= boundsOf(start).from ? Math.round(spentBefore / days) : null;
  const plannedNetCents = rav.plannedChargesCents + rav.plannedIncomeCents;
  return {
    ...forecastMonthEnd({
      balanceCents: rav.spendableBalanceCents,
      plannedNetCents,
      variableSpentCents: spentNow,
      usualDailyCents: usual,
      today,
    }),
    balanceCents: rav.spendableBalanceCents,
    plannedNetCents,
  };
}

/** Returns ending within a week and warranties within a month (validated receipts). */
export async function listDeadlines(
  userId: string,
  today: string,
  db: Db = defaultDb,
): Promise<(Deadline & { transactionId: string | null })[]> {
  const rows = await db
    .select({
      id: receipts.id,
      label: sql<string>`coalesce(${transactions.label}, ${receipts.originalFilename}, 'Ticket')`,
      returnDeadline: receipts.returnDeadline,
      warrantyUntil: receipts.warrantyUntil,
      transactionId: receipts.transactionId,
    })
    .from(receipts)
    .leftJoin(
      transactions,
      and(eq(transactions.userId, receipts.userId), eq(transactions.id, receipts.transactionId)),
    )
    .where(
      and(
        eq(receipts.userId, userId),
        eq(receipts.status, "validated"),
        or(gte(receipts.returnDeadline, today), gte(receipts.warrantyUntil, today)),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r.transactionId]));
  return upcomingDeadlines(rows, today).map((d) => ({
    ...d,
    transactionId: byId.get(d.id) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Simulator baseline                                                          */
/* -------------------------------------------------------------------------- */

export type SimulationBaseline = {
  months: number;
  incomeCents: Cents;
  categories: { id: string | null; name: string; cents: Cents }[];
  goals: { id: string; name: string; remainingCents: Cents }[];
};

/** Average month of the last three full months, by main category. */
export async function simulationBaseline(
  userId: string,
  today: string,
  db: Db = defaultDb,
): Promise<SimulationBaseline> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const { rootOf, nameOf } = await categoryInfo(userId, db);
  const [first] = await db
    .select({ day: sql<string | null>`min(${transactions.occurredOn})` })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  // Only full months: a month that started before my first movement would lower the average.
  const months = [-1, -2, -3]
    .map((d) => shiftMonth(year, month, d))
    .filter((m) => Boolean(first?.day && first.day <= boundsOf(m).from));
  const count = Math.max(months.length, 1);
  const [maps, series, goalList] = await Promise.all([
    Promise.all(months.map((m) => rootSpending(userId, m, rootOf, db))),
    months.length ? monthlySeries(userId, months[0]!, months.length, db) : Promise.resolve([]),
    listGoals(userId, today, db),
  ]);
  const total = new Map<string | null, Cents>();
  for (const map of maps) for (const [k, v] of map) total.set(k, (total.get(k) ?? 0) + v);
  return {
    months: months.length,
    incomeCents: Math.round(series.reduce((s, p) => s + p.incomeCents, 0) / count),
    categories: [...total]
      .map(([id, cents]) => ({ id, name: nameOf(id), cents: Math.round(cents / count) }))
      .filter((c) => c.cents > 0)
      .sort((a, b) => b.cents - a.cents),
    goals: goalList
      .filter((g) => !g.progress.achieved)
      .map((g) => ({ id: g.id, name: g.name, remainingCents: g.progress.remainingCents })),
  };
}

/* -------------------------------------------------------------------------- */
/* Monthly report                                                              */
/* -------------------------------------------------------------------------- */

export type MonthlyReport = { monthLabel: string; sections: ReportSection[] };

/** The month's report, computed from the data (ADR-041). */
export async function getMonthlyReport(
  userId: string,
  month: MonthKey,
  today: string,
  db: Db = defaultDb,
): Promise<MonthlyReport> {
  const { to } = boundsOf(month);
  const day = to < today ? to : today;
  const [series, comparison, budgets, subs, anomalies, receivables, goalViews] = await Promise.all([
    monthlySeries(userId, month, 2, db),
    categoryComparison(userId, month, db),
    listBudgets(userId, day, today, db),
    listSubscriptions(userId, day, db),
    listAnomalies(userId, month, db),
    getReceivables(userId, db),
    listGoals(userId, today, db),
  ]);
  const [previous, current] = series;
  const monthLabel = formatMonthFr(month.year, month.month);
  const inMonth = (d: string) => d.slice(0, 7) === keyOf(month);
  return {
    monthLabel,
    sections: buildMonthlyReport({
      monthLabel,
      spentCents: current!.spentCents,
      previousSpentCents: previous!.spentCents,
      incomeCents: current!.incomeCents,
      netCents: current!.incomeCents - current!.spentCents,
      categories: comparison.map((c) => ({ ...c, name: c.name })),
      budgets: budgets
        .filter((b) => b.period === "monthly")
        .map((b) => ({ name: b.name, percent: b.status.percent, level: b.status.level })),
      subscriptions: {
        untracked: subs
          .filter((s) => !s.tracked)
          .map((s) => ({ label: s.name, amountCents: s.lastAmountCents })),
        increases: subs
          .filter((s) => s.increase && inMonth(s.increase.sinceDate))
          .map((s) => ({
            label: s.name,
            fromCents: s.increase!.fromCents,
            toCents: s.increase!.toCents,
          })),
      },
      anomalies: anomalies.map((a) => ({
        label: a.label,
        amountCents: a.amountCents,
        ratio: a.ratio,
      })),
      receivablesCents: receivables.pendingCents,
      goals: goalViews.map((g) => ({ name: g.name, percent: g.progress.percent })),
    }),
  };
}
