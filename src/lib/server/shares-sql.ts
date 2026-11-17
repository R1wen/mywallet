import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { claims, transactions } from "@/lib/db/schema";

/**
 * Others' share of one claim (ADR-032): pending and reimbursed in full, a gift only for
 * what was paid before it, a cancelled claim nothing. Columns of the claim row given.
 */
function claimShare(c: { status: SQL; amount: SQL; userId: SQL; id: SQL }) {
  return sql`case
    when ${c.status} in ('pending', 'reimbursed') then ${c.amount}
    when ${c.status} = 'gifted' then coalesce((
      select sum(p.amount_cents) from claim_payments p
      where p.user_id = ${c.userId} and p.claim_id = ${c.id}), 0)
    else 0 end`;
}

/** Others' share of the claim in the current row (`claims` in the FROM clause). */
export const claimShareSql = sql<number>`${claimShare({
  status: sql`${claims}.status`,
  amount: sql`${claims}.amount_cents`,
  userId: sql`${claims}.user_id`,
  id: sql`${claims}.id`,
})}`.mapWith(Number);

/**
 * Part of the transaction in the current row owed by other people (ADR-032): pending and
 * reimbursed claims count in full, a gift only for what was paid before it, a cancelled
 * claim not at all. `transactions` must be in the FROM clause.
 */
export const othersShareSql = sql<number>`coalesce((
  select sum(${claimShare({
    status: sql`c.status`,
    amount: sql`c.amount_cents`,
    userId: sql`c.user_id`,
    id: sql`c.id`,
  })})
  from claims c
  where c.user_id = ${transactions}.user_id and c.transaction_id = ${transactions}.id), 0)`.mapWith(
  Number,
);
