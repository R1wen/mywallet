import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { budgets, categories, goals, transactions } from "@/lib/db/schema";
import {
  budgetActive,
  budgetStatus,
  crossedLevel,
  expectedSpend,
  goalProgress,
  periodBounds,
  spentInScope,
  type BudgetLevel,
  type BudgetPeriod,
  type BudgetStatus,
  type Bounds,
  type GoalProgress,
} from "@/lib/domain/budgets";
import type { BudgetInput, GoalInput } from "@/lib/validation/budgets";
import { listAccountsWithBalance } from "./accounts";
import {
  fail,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  NOT_FOUND,
  ok,
  type Result,
} from "./result";
import { spendingByCategory } from "./spending";

/**
 * Envelopes (ADR-036, 037) and savings goals. Every function takes the session `userId`
 * first and filters on it; composite FKs keep categories and accounts in the account.
 */

export const ALL_EXPENSES = "Toutes les dépenses";

export type BudgetView = {
  id: string;
  categoryId: string | null;
  name: string;
  period: BudgetPeriod;
  amountCents: number;
  alertPercent: number;
  spentCents: number;
  /** Spending expected by today at a steady pace (null outside the current period). */
  expectedCents: number | null;
  status: BudgetStatus;
  bounds: Bounds;
};

/** Budgets of the period containing `day`, with what I really spent in their scope. */
export async function listBudgets(
  userId: string,
  day: string,
  today: string,
  db: Db = defaultDb,
): Promise<BudgetView[]> {
  const [rows, cats] = await Promise.all([
    db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        period: budgets.period,
        amountCents: budgets.amountCents,
        alertPercent: budgets.alertPercent,
        startsOn: budgets.startsOn,
        endsOn: budgets.endsOn,
      })
      .from(budgets)
      .where(eq(budgets.userId, userId)),
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  const nameOf = new Map(cats.map((c) => [c.id, c.name]));
  const spentByPeriod = new Map<BudgetPeriod, Map<string | null, number>>();
  const views: BudgetView[] = [];
  for (const b of rows) {
    const bounds = periodBounds(b.period, day);
    if (!budgetActive(b, bounds)) continue;
    let spent = spentByPeriod.get(b.period);
    if (!spent) {
      spent = await spendingByCategory(userId, bounds, db);
      spentByPeriod.set(b.period, spent);
    }
    const spentCents = spentInScope(b.categoryId, spent, parentOf);
    const current = today >= bounds.from && today <= bounds.to;
    views.push({
      id: b.id,
      categoryId: b.categoryId,
      name: b.categoryId ? (nameOf.get(b.categoryId) ?? "Catégorie supprimée") : ALL_EXPENSES,
      period: b.period,
      amountCents: b.amountCents,
      alertPercent: b.alertPercent,
      spentCents,
      expectedCents: current ? expectedSpend(b.amountCents, bounds, today) : null,
      status: budgetStatus({
        amountCents: b.amountCents,
        spentCents,
        alertPercent: b.alertPercent,
      }),
      bounds,
    });
  }
  const rank: Record<BudgetLevel, number> = { over: 0, warning: 1, ok: 2 };
  return views.sort(
    (a, b) =>
      rank[a.status.level] - rank[b.status.level] ||
      Number(a.categoryId !== null) - Number(b.categoryId !== null) ||
      a.name.localeCompare(b.name, "fr"),
  );
}

/** Budgets at or past their alert threshold this period (dashboard, sidebar badge). */
export async function budgetAlerts(userId: string, today: string, db: Db = defaultDb) {
  return (await listBudgets(userId, today, today, db)).filter((b) => b.status.level !== "ok");
}

export type BudgetAlert = { name: string; level: BudgetLevel; percent: number };

/**
 * Thresholds crossed because of this expense (message right after saving it): its own
 * contribution is enough to move a budget to `warning` or `over`.
 */
export async function alertsAfterExpense(
  userId: string,
  transactionId: string,
  today: string,
  db: Db = defaultDb,
): Promise<BudgetAlert[]> {
  const [t] = await db
    .select({ kind: transactions.kind, occurredOn: transactions.occurredOn })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)));
  if (!t || t.kind !== "expense") return [];
  const [list, contribution, cats] = await Promise.all([
    listBudgets(userId, t.occurredOn, today, db),
    spendingByCategory(userId, { transactionIds: [transactionId] }, db),
    db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  return list.flatMap((b) => {
    const mine = spentInScope(b.categoryId, contribution, parentOf);
    if (mine <= 0 || b.status.level === "ok") return [];
    const before = budgetStatus({
      amountCents: b.amountCents,
      spentCents: b.spentCents - mine,
      alertPercent: b.alertPercent,
    });
    const crossed = crossedLevel(before.level, b.status.level);
    return crossed ? [{ name: b.name, level: crossed, percent: b.status.percent }] : [];
  });
}

async function checkCategory(userId: string, categoryId: string | null, db: Db) {
  if (!categoryId) return null;
  const [c] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, categoryId)));
  if (!c) return "Catégorie introuvable.";
  return c.kind === "expense" ? null : "Choisissez une catégorie de dépenses.";
}

function budgetWriteError(e: unknown): Result<never> {
  if (isUniqueViolation(e)) return fail("Cette catégorie a déjà un budget sur cette période.");
  if (isForeignKeyViolation(e)) return fail("Catégorie introuvable.");
  if (isCheckViolation(e)) return fail("Budget invalide.");
  throw e;
}

/** New envelope, counted from the start of the current period. */
export async function createBudget(
  userId: string,
  input: BudgetInput,
  today: string,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  const error = await checkCategory(userId, input.categoryId, db);
  if (error) return fail(error);
  try {
    const [row] = await db
      .insert(budgets)
      .values({
        userId,
        categoryId: input.categoryId,
        period: input.period,
        amountCents: input.amount,
        alertPercent: input.alertPercent,
        startsOn: periodBounds(input.period, today).from,
      })
      .returning({ id: budgets.id });
    return ok(row!);
  } catch (e) {
    return budgetWriteError(e);
  }
}

export async function updateBudget(
  userId: string,
  id: string,
  input: BudgetInput,
  db: Db = defaultDb,
): Promise<Result> {
  const error = await checkCategory(userId, input.categoryId, db);
  if (error) return fail(error);
  try {
    const rows = await db
      .update(budgets)
      .set({
        categoryId: input.categoryId,
        period: input.period,
        amountCents: input.amount,
        alertPercent: input.alertPercent,
      })
      .where(and(eq(budgets.userId, userId), eq(budgets.id, id)))
      .returning({ id: budgets.id });
    return rows.length ? ok(undefined) : fail(NOT_FOUND);
  } catch (e) {
    return budgetWriteError(e);
  }
}

export async function deleteBudget(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .delete(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.id, id)))
    .returning({ id: budgets.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                       */
/* -------------------------------------------------------------------------- */

export type GoalView = {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  targetDate: string | null;
  accountId: string | null;
  accountName: string | null;
  progress: GoalProgress;
};

/** Goals in progress: a linked account counts with its balance (ADR-037). */
export async function listGoals(userId: string, today: string, db: Db = defaultDb) {
  const [rows, accounts] = await Promise.all([
    db
      .select({
        id: goals.id,
        name: goals.name,
        targetCents: goals.targetCents,
        savedCents: goals.savedCents,
        targetDate: goals.targetDate,
        accountId: goals.accountId,
      })
      .from(goals)
      .where(and(eq(goals.userId, userId), isNull(goals.archivedAt)))
      .orderBy(sql`${goals.targetDate} asc nulls last`, asc(goals.createdAt)),
    listAccountsWithBalance(userId, db),
  ]);
  const accountOf = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((g): GoalView => {
    const account = g.accountId ? accountOf.get(g.accountId) : undefined;
    const savedCents = account ? Math.max(account.balanceCents, 0) : g.savedCents;
    return {
      ...g,
      savedCents,
      accountName: account?.name ?? null,
      progress: goalProgress({ ...g, savedCents }, today),
    };
  });
}

async function checkAccount(userId: string, accountId: string | null, db: Db) {
  if (!accountId) return null;
  const owned = await listAccountsWithBalance(userId, db);
  return owned.some((a) => a.id === accountId) ? null : "Compte introuvable.";
}

export async function createGoal(
  userId: string,
  input: GoalInput,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  const error = await checkAccount(userId, input.accountId, db);
  if (error) return fail(error);
  const [row] = await db
    .insert(goals)
    .values({
      userId,
      name: input.name,
      targetCents: input.target,
      targetDate: input.targetDate,
      accountId: input.accountId,
    })
    .returning({ id: goals.id });
  return ok(row!);
}

export async function updateGoal(
  userId: string,
  id: string,
  input: GoalInput,
  db: Db = defaultDb,
): Promise<Result> {
  const error = await checkAccount(userId, input.accountId, db);
  if (error) return fail(error);
  const rows = await db
    .update(goals)
    .set({
      name: input.name,
      targetCents: input.target,
      targetDate: input.targetDate,
      accountId: input.accountId,
    })
    .where(and(eq(goals.userId, userId), eq(goals.id, id)))
    .returning({ id: goals.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/** Adds (or takes back) money on a goal tracked by hand; never below zero. */
export async function contributeToGoal(
  userId: string,
  id: string,
  amountCents: number,
  db: Db = defaultDb,
): Promise<Result<{ savedCents: number }>> {
  return db.transaction(async (tx) => {
    const [g] = await tx
      .select({
        savedCents: goals.savedCents,
        targetCents: goals.targetCents,
        accountId: goals.accountId,
      })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.id, id)))
      .for("update");
    if (!g) return fail(NOT_FOUND);
    if (g.accountId) return fail("Cet objectif suit le solde de son compte.");
    const savedCents = g.savedCents + amountCents;
    if (savedCents < 0) return fail("Le montant mis de côté ne peut pas devenir négatif.");
    await tx
      .update(goals)
      .set({ savedCents, achievedAt: savedCents >= g.targetCents ? new Date() : null })
      .where(and(eq(goals.userId, userId), eq(goals.id, id)));
    return ok({ savedCents });
  });
}

/** Archives a goal (reached or abandoned); it leaves the list. */
export async function archiveGoal(userId: string, id: string, db: Db = defaultDb): Promise<Result> {
  const rows = await db
    .update(goals)
    .set({ archivedAt: new Date() })
    .where(and(eq(goals.userId, userId), eq(goals.id, id)))
    .returning({ id: goals.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}
