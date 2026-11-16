import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildCatalogRows } from "@/lib/catalog";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { accounts, categories, merchants } from "@/lib/db/schema";

/**
 * Starter data for a new user (ADR-023): default categories, the French merchant
 * catalogue and a checking account. Idempotent: does nothing if the user already has
 * categories. Called by the Better Auth `user.create.after` hook.
 */
export async function provisionUser(userId: string, db: Db = defaultDb): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, userId))
      .limit(1);
    if (existing.length) return;
    const rows = buildCatalogRows(userId, randomUUID);
    await tx.insert(categories).values(rows.categories);
    await tx.insert(merchants).values(rows.merchants);
    await tx.insert(accounts).values({ userId, name: "Compte courant", type: "checking" });
  });
}
