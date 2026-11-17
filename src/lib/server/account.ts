import "server-only";
import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { accountDeletions, authAccount, rateLimit, session } from "@/lib/db/schema";
import { purgeDate } from "@/lib/domain/export";
import { fail, ok, type Result } from "./result";

/**
 * Account deletion with a delay (ADR-043): asking for it checks the password, signs the
 * account out everywhere and schedules the purge 7 days later; signing in again cancels
 * it. The daily purge erases the user, and every row cascades (files included).
 */

const WRONG_PASSWORD = "Mot de passe incorrect.";
/** Password attempts allowed per window, like the sign-in limit (ADR-043). */
export const DELETION_MAX_ATTEMPTS = 5;
const DELETION_WINDOW_MS = 10 * 60 * 1000;

/**
 * Counts a failed password attempt for this account (Better Auth's rate_limit table);
 * true when the account must wait before trying again.
 */
async function tooManyAttempts(userId: string, now: Date, db: Db, record: boolean) {
  const key = `delete-account:${userId}`;
  const [row] = await db.select().from(rateLimit).where(eq(rateLimit.key, key));
  const inWindow = row && now.getTime() - row.lastRequest < DELETION_WINDOW_MS;
  if (!record) return Boolean(inWindow && row.count >= DELETION_MAX_ATTEMPTS);
  await db
    .insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now.getTime() })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: { count: inWindow ? row.count + 1 : 1, lastRequest: now.getTime() },
    });
  return false;
}

export async function requestDeletion(
  userId: string,
  password: string,
  now = new Date(),
  db: Db = defaultDb,
): Promise<Result<{ purgeAfter: Date }>> {
  if (await tooManyAttempts(userId, now, db, false)) {
    return fail("Trop d'essais. Réessayez dans 10 minutes.");
  }
  const [credential] = await db
    .select({ hash: authAccount.password })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")));
  if (!credential?.hash || !(await verifyPassword({ hash: credential.hash, password }))) {
    await tooManyAttempts(userId, now, db, true);
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

/**
 * Erases the accounts whose delay is over, in one statement. An account with a session
 * opened after the request is spared even if its cancellation failed: signing in again
 * always wins. Returns how many accounts were erased.
 */
export async function purgeDueAccounts(now = new Date(), db: Db = defaultDb): Promise<number> {
  const erased = await db.execute<{ id: string }>(sql`
    delete from "user" u
    using account_deletions d
    where d.user_id = u.id
      and d.purge_after <= ${now.toISOString()}::timestamptz
      and not exists (
        select 1 from session s where s.user_id = u.id and s.created_at > d.requested_at)
    returning u.id`);
  return erased.rows.length;
}
