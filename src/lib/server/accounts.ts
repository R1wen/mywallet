import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";

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
  input: { name: string; type?: AccountRow["type"]; openingBalanceCents?: number },
  db: Db = defaultDb,
): Promise<AccountRow> {
  const [row] = await db
    .insert(accounts)
    .values({
      userId,
      name: input.name,
      type: input.type,
      openingBalanceCents: input.openingBalanceCents,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
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
