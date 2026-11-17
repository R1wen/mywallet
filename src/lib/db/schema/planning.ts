/** Budgets (spending caps per category and period) and savings goals. */
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cents, currency, id, inList, ownerId, timestamps } from "./columns";
import { accounts, categories } from "./finance";

import { BUDGET_PERIODS, type BudgetPeriod } from "../../domain/budgets";
export { BUDGET_PERIODS, type BudgetPeriod } from "../../domain/budgets";

/**
 * Cap on "ma dépense réelle" for a category (children included) per period.
 * `category_id` null = global budget on all expenses.
 */
export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    userId: ownerId(),
    categoryId: uuid(),
    period: text().$type<BudgetPeriod>().notNull().default("monthly"),
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    /** Alert from this share of the amount, in percent (ADR-037). */
    alertPercent: integer().notNull().default(80),
    startsOn: date({ mode: "string" }).notNull(),
    endsOn: date({ mode: "string" }),
    ...timestamps,
  },
  (t) => [
    unique("budgets_user_id_id_key").on(t.userId, t.id),
    unique("budgets_user_category_period_key")
      .on(t.userId, t.categoryId, t.period, t.startsOn)
      .nullsNotDistinct(),
    // One open envelope per category and period (ADR-036), whatever its start.
    // (A global budget has no category: the null is folded so it counts once too.)
    uniqueIndex("budgets_user_category_period_open_key")
      .on(
        t.userId,
        sql`coalesce(${t.categoryId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.period,
      )
      .where(sql`${t.endsOn} is null`),
    foreignKey({
      name: "budgets_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("cascade"),
    check("budgets_period_check", sql`${t.period} in (${inList(BUDGET_PERIODS)})`),
    check("budgets_amount_check", sql`${t.amountCents} > 0`),
    check("budgets_alert_check", sql`${t.alertPercent} between 1 and 100`),
    check("budgets_dates_check", sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * Savings goal. Progress is the linked account's balance when `account_id` is set,
 * otherwise the manually tracked `saved_cents`.
 */
export const goals = pgTable(
  "goals",
  {
    id: id(),
    userId: ownerId(),
    name: text().notNull(),
    targetCents: cents("target_cents").notNull(),
    savedCents: cents("saved_cents").notNull().default(0),
    currency: currency(),
    accountId: uuid(),
    targetDate: date({ mode: "string" }),
    achievedAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("goals_user_id_id_key").on(t.userId, t.id),
    foreignKey({
      name: "goals_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    check("goals_target_check", sql`${t.targetCents} > 0`),
    check("goals_saved_check", sql`${t.savedCents} >= 0`),
    check("goals_name_check", sql`btrim(${t.name}) <> ''`),
  ],
);
