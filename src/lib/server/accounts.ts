import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { accounts, transactions } from "@/lib/db/schema";
import type { AccountInput } from "@/lib/validation/settings";
import { fail, NOT_FOUND, ok, type Result } from "./result";

/**
 * Accès aux comptes. Chaque fonction prend `userId` en premier argument
 * (issu de requireUser(), jamais du client) et filtre dessus : un utilisateur
 * ne peut ni lire ni modifier le compte d'un autre.
 */

export type AccountRow = typeof accounts.$inferSelect;

export async function listAccounts(userId: string, db: Db = defaultDb): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.position), asc(accounts.name));
}

export async function getAccount(
  userId: string,
  accountId: string,
  db: Db = defaultDb,
): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
    .limit(1);
  return row ?? null;
}

export async function createAccount(
  userId: string,
  input: Partial<AccountInput> & { name: string },
  db: Db = defaultDb,
): Promise<AccountRow> {
  const [row] = await db
    .insert(accounts)
    .values({
      userId,
      name: input.name,
      type: input.type,
      institution: input.institution ?? null,
      openingBalanceCents: input.openingBalanceCents,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Updates name, type, bank and opening balance. */
export async function updateAccount(
  userId: string,
  accountId: string,
  input: AccountInput,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(accounts)
    .set(input)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
    .returning({ id: accounts.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

export type AccountWithBalance = AccountRow & { balanceCents: number; movementCount: number };

/** Active accounts with their balance (opening balance + every movement). */
export async function listAccountsWithBalance(
  userId: string,
  db: Db = defaultDb,
): Promise<AccountWithBalance[]> {
  const sums = db
    .select({
      accountId: transactions.accountId,
      total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`.as("total"),
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.accountId)
    .as("sums");
  const rows = await db
    .select({ account: accounts, total: sums.total, n: sums.n })
    .from(accounts)
    .leftJoin(sums, eq(sums.accountId, accounts.id))
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.position), asc(accounts.name));
  return rows.map((r) => ({
    ...r.account,
    balanceCents: r.account.openingBalanceCents + Number(r.total ?? 0),
    movementCount: r.n ?? 0,
  }));
}

/** Renomme un compte. Renvoie false si le compte n'existe pas pour cet utilisateur. */
export async function renameAccount(
  userId: string,
  accountId: string,
  name: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const rows = await db
    .update(accounts)
    .set({ name })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
    .returning({ id: accounts.id });
  return rows.length === 1;
}

/** Archive un compte (pas de suppression dure : l'historique des mouvements est conservé). */
export async function archiveAccount(
  userId: string,
  accountId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const rows = await db
    .update(accounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
    .returning({ id: accounts.id });
  return rows.length === 1;
}
