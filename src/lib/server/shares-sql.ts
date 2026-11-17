import "server-only";
import { sql } from "drizzle-orm";
import { transactions } from "@/lib/db/schema";

/**
 * Part of the transaction in the current row owed by other people (ADR-032): pending and
 * reimbursed claims count in full, a gift only for what was paid before it, a cancelled
 * claim not at all. `transactions` must be in the FROM clause.
 */
export const othersShareSql = sql<number>`coalesce((
  select sum(case
    when c.status in ('pending', 'reimbursed') then c.amount_cents
    when c.status = 'gifted' then coalesce((
      select sum(p.amount_cents) from claim_payments p
      where p.user_id = c.user_id and p.claim_id = c.id), 0)
    else 0 end)
  from claims c
  where c.user_id = ${transactions}.user_id and c.transaction_id = ${transactions}.id), 0)`.mapWith(
  Number,
);
