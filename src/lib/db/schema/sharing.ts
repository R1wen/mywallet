/**
 * Cost sharing: people (no app account), claims (what someone owes me on an expense)
 * and claim payments (each reimbursement received, linked to the `reimbursement`
 * transaction it created).
 *
 * Financial rules (CLAUDE.md):
 * - The expense transaction carries the full amount; claims never change a balance.
 * - A payment creates a `reimbursement` transaction (> 0, any account, not income) and a
 *   `claim_payments` row. Several partial payments are allowed; their sum is capped at
 *   `claims.amount_cents` (domain rule, checked in the same DB transaction).
 * - Cancelling a payment = deleting its reimbursement transaction: the payment row
 *   cascades away and the domain sets the claim back to `pending`.
 * - Gifting: status `gifted`, no money back; the unpaid remainder becomes my expense.
 * - My real expense on a transaction = -amount_cents - sum(others' shares) where a share is
 *   `amount_cents` for pending/reimbursed claims, the paid sum for gifted claims, 0 for
 *   cancelled ones.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { cents, currency, id, inList, ownerId, timestamps } from "./columns";
import { transactionItems, transactions } from "./finance";

export const CLAIM_STATUSES = ["pending", "reimbursed", "gifted", "cancelled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Someone the user shares costs with. Not an app user. */
export const people = pgTable(
  "people",
  {
    id: id(),
    userId: ownerId(),
    name: text().notNull(),
    email: text(),
    notes: text(),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("people_user_id_id_key").on(t.userId, t.id),
    check("people_name_check", sql`btrim(${t.name}) <> ''`),
  ],
);

/**
 * Share of an expense owed by one person: either a whole-transaction share
 * (`transaction_item_id` null) or one receipt line. One claim per (transaction, item, person).
 */
export const claims = pgTable(
  "claims",
  {
    id: id(),
    userId: ownerId(),
    personId: uuid().notNull(),
    transactionId: uuid().notNull(),
    transactionItemId: uuid(),
    /** Amount owed, positive. */
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    status: text().$type<ClaimStatus>().notNull().default("pending"),
    note: text(),
    /** Set when the claim leaves `pending` (fully reimbursed, gifted or cancelled). */
    resolvedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("claims_user_id_id_key").on(t.userId, t.id),
    unique("claims_share_key")
      .on(t.userId, t.transactionId, t.transactionItemId, t.personId)
      .nullsNotDistinct(),
    // "À récupérer" per person, and the global pending list.
    index("claims_user_person_status_idx").on(t.userId, t.personId, t.status),
    index("claims_user_status_idx").on(t.userId, t.status),
    foreignKey({
      name: "claims_person_fk",
      columns: [t.userId, t.personId],
      foreignColumns: [people.userId, people.id],
    }),
    foreignKey({
      name: "claims_transaction_fk",
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete("cascade"),
    // The item (when set) must belong to the same transaction.
    foreignKey({
      name: "claims_transaction_item_fk",
      columns: [t.userId, t.transactionId, t.transactionItemId],
      foreignColumns: [
        transactionItems.userId,
        transactionItems.transactionId,
        transactionItems.id,
      ],
    }).onDelete("cascade"),
    check("claims_amount_check", sql`${t.amountCents} > 0`),
    check("claims_status_check", sql`${t.status} in (${inList(CLAIM_STATUSES)})`),
    check("claims_resolved_check", sql`(${t.status} = 'pending') = (${t.resolvedAt} is null)`),
  ],
);

/**
 * One reimbursement received for a claim. `transaction_kind` is pinned to 'reimbursement'
 * and part of the FK, so a payment can only point to a reimbursement transaction, and that
 * transaction's kind cannot change while the payment exists. One reimbursement transaction
 * may settle several claims (one row each).
 */
export const claimPayments = pgTable(
  "claim_payments",
  {
    id: id(),
    userId: ownerId(),
    claimId: uuid().notNull(),
    transactionId: uuid().notNull(),
    transactionKind: text().$type<"reimbursement">().notNull().default("reimbursement"),
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    ...timestamps,
  },
  (t) => [
    unique("claim_payments_user_id_id_key").on(t.userId, t.id),
    unique("claim_payments_claim_transaction_key").on(t.userId, t.claimId, t.transactionId),
    index("claim_payments_user_transaction_idx").on(t.userId, t.transactionId),
    // Deleting a claim that received payments is refused: cancel the payments first.
    foreignKey({
      name: "claim_payments_claim_fk",
      columns: [t.userId, t.claimId],
      foreignColumns: [claims.userId, claims.id],
    }),
    // Deleting the reimbursement transaction cancels the payment.
    foreignKey({
      name: "claim_payments_transaction_fk",
      columns: [t.userId, t.transactionId, t.transactionKind],
      foreignColumns: [transactions.userId, transactions.id, transactions.kind],
    }).onDelete("cascade"),
    check("claim_payments_amount_check", sql`${t.amountCents} > 0`),
    check("claim_payments_kind_check", sql`${t.transactionKind} = 'reimbursement'`),
  ],
);
