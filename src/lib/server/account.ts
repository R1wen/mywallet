import "server-only";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { accountDeletions, authAccount, session, user } from "@/lib/db/schema";
import { purgeDate } from "@/lib/domain/export";
import { fail, ok, type Result } from "./result";

/**
 * Account deletion with a delay (ADR-043): asking for it checks the password, signs the
 * account out everywhere and schedules the purge 7 days later; signing in again cancels
 * it. The daily purge erases the user, and every row cascades (files included).
 */

const WRONG_PASSWORD = "Mot de passe incorrect.";

export async function requestDeletion(
  userId: string,
  password: string,
  now = new Date(),
  db: Db = defaultDb,
): Promise<Result<{ purgeAfter: Date }>> {
  const [credential] = await db
    .select({ hash: authAccount.password })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")));
  if (!credential?.hash || !(await verifyPassword({ hash: credential.hash, password }))) {
    return fail(WRONG_PASSWORD);
  }
  const purgeAfter = purgeDate(now);
  await db.transaction(async (tx) => {
    await tx
      .insert(accountDeletions)
      .values({ userId, requestedAt: now, purgeAfter })
      .onConflictDoUpdate({
        target: accountDeletions.userId,
        set: { requestedAt: now, purgeAfter },
      });
    // Signed out on every device: coming back means signing in, which cancels.
    await tx.delete(session).where(eq(session.userId, userId));
  });
  return ok({ purgeAfter });
}

/** Signing in again cancels a pending deletion (called when a session is created). */
export async function cancelDeletion(userId: string, db: Db = defaultDb): Promise<boolean> {
  const rows = await db
    .delete(accountDeletions)
    .where(eq(accountDeletions.userId, userId))
    .returning({ userId: accountDeletions.userId });
  return rows.length > 0;
}

/** Erases the accounts whose delay is over; returns how many were erased. */
export async function purgeDueAccounts(now = new Date(), db: Db = defaultDb): Promise<number> {
  const due = await db
    .select({ userId: accountDeletions.userId })
    .from(accountDeletions)
    .where(lte(accountDeletions.purgeAfter, now));
  if (!due.length) return 0;
  const erased = await db
    .delete(user)
    .where(
      inArray(
        user.id,
        due.map((d) => d.userId),
      ),
    )
    .returning({ id: user.id });
  return erased.length;
}
