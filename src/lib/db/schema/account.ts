/** Account lifecycle (ADR-043): deletion asked by the user, erased after a delay. */
import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp } from "drizzle-orm/pg-core";
import { ownerId } from "./columns";

/**
 * One row per account waiting for deletion. Signing in again cancels it (the row is
 * removed); the daily purge erases the user (everything cascades) once `purge_after` passed.
 */
export const accountDeletions = pgTable(
  "account_deletions",
  {
    userId: ownerId().primaryKey(),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index("account_deletions_purge_after_idx").on(t.purgeAfter),
    check("account_deletions_delay_check", sql`${t.purgeAfter} > ${t.requestedAt}`),
  ],
);
