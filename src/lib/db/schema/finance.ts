/**
 * Core finance tables: accounts, categories, merchants, transactions and receipt lines,
 * recurring rules and categorization rules.
 *
 * Isolation (ADR-010): every parent exposes `unique (user_id, id)` and every child
 * references it with a composite FK `(user_id, x_id)`, so a row can never point to
 * another user's data. Optional references use the default NO ACTION: Postgres cannot
 * `SET NULL` only one column of a composite FK through Drizzle, so the domain layer
 * unlinks (or reassigns) children before deleting a referenced row. Deleting the user
 * still works: every table cascades from `user` and NO ACTION is checked at the end of
 * the statement.
 *
 * Enumerations are `text` + CHECK (cheap to evolve, no `ALTER TYPE` migrations).
 */
import { sql } from "drizzle-orm";
import { RULE_MATCH_TYPES, type RuleMatchType } from "../../domain/categorize";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea, cents, currency, id, inList, ownerId, timestamps } from "./columns";

export const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit_card", "other"] as const;
export const CATEGORY_KINDS = ["expense", "income", "transfer"] as const;
/** `refund` = merchant credit note (ADR-020): money in, lowers spending, not income. */
export const TRANSACTION_KINDS = [
  "expense",
  "income",
  "transfer",
  "reimbursement",
  "refund",
] as const;
export const LOGO_SOURCES = ["favicon", "upload", "none"] as const;
/** `transfer` = recurring saving from one account to another (ADR-026). */
export const RECURRING_KINDS = ["expense", "income", "transfer"] as const;
export const RECURRING_FREQUENCIES = ["weekly", "monthly", "yearly"] as const;
/** planned = generated, not in the balance; confirmed = linked transaction; skipped = ignored. */
export const OCCURRENCE_STATUSES = ["planned", "confirmed", "skipped"] as const;
export { RULE_MATCH_TYPES } from "../../domain/categorize";

/** Uploaded merchant logo size limit (256 KiB). */
export const MERCHANT_LOGO_MAX_BYTES = 262_144;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type LogoSource = (typeof LOGO_SOURCES)[number];
export type RecurringKind = (typeof RECURRING_KINDS)[number];
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];
export type { RuleMatchType } from "../../domain/categorize";

/* -------------------------------------------------------------------------- */
/* Accounts                                                                   */
/* -------------------------------------------------------------------------- */

/** Bank or cash account. Balance = opening_balance_cents + sum(transactions.amount_cents). */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: ownerId(),
    name: text().notNull(),
    type: text().$type<AccountType>().notNull().default("checking"),
    institution: text(),
    openingBalanceCents: cents("opening_balance_cents").notNull().default(0),
    currency: currency(),
    position: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("accounts_user_id_id_key").on(t.userId, t.id),
    check("accounts_type_check", sql`${t.type} in (${inList(ACCOUNT_TYPES)})`),
    check("accounts_name_check", sql`btrim(${t.name}) <> ''`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/** User-editable category tree (parent_id self-reference; depth is a domain rule). */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    userId: ownerId(),
    parentId: uuid(),
    name: text().notNull(),
    kind: text().$type<CategoryKind>().notNull(),
    icon: text(),
    color: text(),
    position: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("categories_user_id_id_key").on(t.userId, t.id),
    // One name per level; NULLS NOT DISTINCT so root names are unique too.
    unique("categories_user_id_parent_id_name_key")
      .on(t.userId, t.parentId, t.name)
      .nullsNotDistinct(),
    foreignKey({
      name: "categories_parent_fk",
      columns: [t.userId, t.parentId],
      foreignColumns: [t.userId, t.id],
    }),
    check("categories_kind_check", sql`${t.kind} in (${inList(CATEGORY_KINDS)})`),
    check("categories_parent_check", sql`${t.parentId} is distinct from ${t.id}`),
    check("categories_name_check", sql`btrim(${t.name}) <> ''`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Merchants                                                                  */
/* -------------------------------------------------------------------------- */

/** Per-user merchant directory (seeded from a common catalogue, then user-editable). */
export const merchants = pgTable(
  "merchants",
  {
    id: id(),
    userId: ownerId(),
    name: text().notNull(),
    /** `normalizeMerchantName(name)`; matching key for receipts and bank labels. */
    normalizedName: text().notNull(),
    /** Extra normalized labels that map to this merchant. */
    aliases: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    domain: text(),
    logoUrl: text(),
    /** null = automatic chain (brand icon, favicon, monogram); "upload"; "none" = monogram. */
    logoSource: text().$type<LogoSource>(),
    /** User-uploaded logo (PNG/JPEG/WebP checked by signature), served by our own route. */
    logoData: bytea("logo_data"),
    logoContentType: text(),
    defaultCategoryId: uuid(),
    ...timestamps,
  },
  (t) => [
    unique("merchants_user_id_id_key").on(t.userId, t.id),
    unique("merchants_user_id_normalized_name_key").on(t.userId, t.normalizedName),
    foreignKey({
      name: "merchants_default_category_fk",
      columns: [t.userId, t.defaultCategoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    check("merchants_name_check", sql`btrim(${t.normalizedName}) <> ''`),
    check(
      "merchants_logo_source_check",
      sql`${t.logoSource} is null or ${t.logoSource} in (${inList(LOGO_SOURCES)})`,
    ),
    check(
      "merchants_logo_data_check",
      sql`(${t.logoData} is null and ${t.logoContentType} is null)
        or (${t.logoContentType} in ('image/png', 'image/jpeg', 'image/webp')
            and octet_length(${t.logoData}) <= ${sql.raw(String(MERCHANT_LOGO_MAX_BYTES))})`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Recurring rules                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Expected periodic movement (rent, salary, subscriptions, savings). Same sign convention as
 * transactions; a `transfer` (saving) stores the negative debit of `account_id` and its
 * destination in `to_account_id`. `next_run_on` is the generation cursor (ADR-024).
 */
export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: id(),
    userId: ownerId(),
    accountId: uuid().notNull(),
    toAccountId: uuid(),
    kind: text().$type<RecurringKind>().notNull(),
    label: text().notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    merchantId: uuid(),
    categoryId: uuid(),
    frequency: text().$type<RecurringFrequency>().notNull().default("monthly"),
    interval: smallint().notNull().default(1),
    /** Day of month for monthly/yearly rules; clamped to the month length by the domain. */
    dayOfMonth: smallint(),
    startOn: date({ mode: "string" }).notNull(),
    endOn: date({ mode: "string" }),
    nextRunOn: date({ mode: "string" }).notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("recurring_rules_user_id_id_key").on(t.userId, t.id),
    // Due rules for the generator.
    index("recurring_rules_user_next_run_idx")
      .on(t.userId, t.nextRunOn)
      .where(sql`${t.active}`),
    foreignKey({
      name: "recurring_rules_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "recurring_rules_to_account_fk",
      columns: [t.userId, t.toAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "recurring_rules_merchant_fk",
      columns: [t.userId, t.merchantId],
      foreignColumns: [merchants.userId, merchants.id],
    }),
    foreignKey({
      name: "recurring_rules_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    check("recurring_rules_kind_check", sql`${t.kind} in (${inList(RECURRING_KINDS)})`),
    check(
      "recurring_rules_sign_check",
      sql`(${t.kind} = 'expense' and ${t.amountCents} < 0 and ${t.toAccountId} is null)
        or (${t.kind} = 'income' and ${t.amountCents} > 0 and ${t.toAccountId} is null)
        or (${t.kind} = 'transfer' and ${t.amountCents} < 0 and ${t.toAccountId} is not null
            and ${t.toAccountId} <> ${t.accountId})`,
    ),
    check(
      "recurring_rules_frequency_check",
      sql`${t.frequency} in (${inList(RECURRING_FREQUENCIES)})`,
    ),
    check("recurring_rules_interval_check", sql`${t.interval} between 1 and 52`),
    check(
      "recurring_rules_day_check",
      sql`${t.dayOfMonth} is null or ${t.dayOfMonth} between 1 and 31`,
    ),
    check("recurring_rules_dates_check", sql`${t.endOn} is null or ${t.endOn} >= ${t.startOn}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A real money movement on one account.
 *
 * Sign convention: `amount_cents` is signed from the account's point of view:
 * negative = money out, positive = money in. Hence
 *   - expense        < 0 (the full receipt total, even if part of it is owed by friends)
 *   - income         > 0
 *   - reimbursement  > 0 (money back from a person for a claim; NOT income; always linked
 *                         through `claim_payments.transaction_id`)
 *   - transfer       != 0, two rows sharing `transfer_group_id` (one per account)
 * Account balance = opening balance + sum(amount_cents). Pending claims never touch it.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: ownerId(),
    accountId: uuid().notNull(),
    kind: text().$type<TransactionKind>().notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    /** Calendar day in Europe/Paris. */
    occurredOn: date({ mode: "string" }).notNull(),
    label: text().notNull(),
    notes: text(),
    merchantId: uuid(),
    categoryId: uuid(),
    recurringRuleId: uuid(),
    transferGroupId: uuid(),
    /**
     * SHA-256 of the bank statement line this movement was imported from or reconciled
     * with (ADR-028). Not null = "pointée". Prevents importing the same line twice.
     */
    bankLineKey: text(),
    /** Raw label of that bank line, kept for display and search. */
    bankLabel: text(),
    ...timestamps,
  },
  (t) => [
    unique("transactions_user_id_id_key").on(t.userId, t.id),
    uniqueIndex("transactions_user_bank_line_key")
      .on(t.userId, t.bankLineKey)
      .where(sql`${t.bankLineKey} is not null`),
    // Target of claim_payments' FK that pins the linked transaction to kind = 'reimbursement'.
    unique("transactions_user_id_id_kind_key").on(t.userId, t.id, t.kind),
    // Main list (newest first) and per-account list / balance.
    index("transactions_user_occurred_idx").on(t.userId, t.occurredOn.desc()),
    index("transactions_user_account_occurred_idx").on(t.userId, t.accountId, t.occurredOn),
    // Reports by category / merchant and FK checks when deleting them.
    index("transactions_user_category_idx").on(t.userId, t.categoryId),
    index("transactions_user_merchant_idx").on(t.userId, t.merchantId),
    index("transactions_user_recurring_idx")
      .on(t.userId, t.recurringRuleId)
      .where(sql`${t.recurringRuleId} is not null`),
    index("transactions_user_transfer_idx")
      .on(t.userId, t.transferGroupId)
      .where(sql`${t.transferGroupId} is not null`),
    foreignKey({
      name: "transactions_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "transactions_merchant_fk",
      columns: [t.userId, t.merchantId],
      foreignColumns: [merchants.userId, merchants.id],
    }),
    foreignKey({
      name: "transactions_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    foreignKey({
      name: "transactions_recurring_rule_fk",
      columns: [t.userId, t.recurringRuleId],
      foreignColumns: [recurringRules.userId, recurringRules.id],
    }),
    check("transactions_kind_check", sql`${t.kind} in (${inList(TRANSACTION_KINDS)})`),
    check(
      "transactions_sign_check",
      sql`(${t.kind} = 'expense' and ${t.amountCents} < 0)
        or (${t.kind} in ('income', 'reimbursement', 'refund') and ${t.amountCents} > 0)
        or (${t.kind} = 'transfer' and ${t.amountCents} <> 0)`,
    ),
    check(
      "transactions_transfer_group_check",
      sql`(${t.kind} = 'transfer') = (${t.transferGroupId} is not null)`,
    ),
    check("transactions_label_check", sql`btrim(${t.label}) <> ''`),
    check(
      "transactions_bank_line_key_check",
      sql`${t.bankLineKey} is null or ${t.bankLineKey} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/**
 * Receipt line. `total_cents` is the line's cost as a positive magnitude (a discount line
 * is negative); lines of an expense sum to -transactions.amount_cents (domain rule).
 */
export const transactionItems = pgTable(
  "transaction_items",
  {
    id: id(),
    userId: ownerId(),
    transactionId: uuid().notNull(),
    position: integer().notNull().default(0),
    label: text().notNull(),
    quantity: numeric({ precision: 10, scale: 3 }).notNull().default("1"),
    unitPriceCents: cents("unit_price_cents"),
    totalCents: cents("total_cents").notNull(),
    categoryId: uuid(),
    ...timestamps,
  },
  (t) => [
    unique("transaction_items_user_id_id_key").on(t.userId, t.id),
    // Lets claims prove that their item belongs to their transaction.
    unique("transaction_items_user_tx_id_key").on(t.userId, t.transactionId, t.id),
    index("transaction_items_user_tx_position_idx").on(t.userId, t.transactionId, t.position),
    index("transaction_items_user_category_idx").on(t.userId, t.categoryId),
    foreignKey({
      name: "transaction_items_transaction_fk",
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "transaction_items_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    check("transaction_items_quantity_check", sql`${t.quantity} > 0`),
    check("transaction_items_position_check", sql`${t.position} >= 0`),
    check("transaction_items_label_check", sql`btrim(${t.label}) <> ''`),
  ],
);

/**
 * One due date of a recurring rule (ADR-024). Generated once per (rule, due date) as
 * `planned`: shown in the calendar and counted in the "reste à vivre", never in a balance.
 * Validating it creates the real transaction (amount adjustable) and links it here; for a
 * saving, the link is the debit leg of the transfer.
 */
export const recurringOccurrences = pgTable(
  "recurring_occurrences",
  {
    id: id(),
    userId: ownerId(),
    ruleId: uuid().notNull(),
    dueOn: date({ mode: "string" }).notNull(),
    /** Expected amount (rule's amount when generated), signed like the rule. */
    amountCents: cents("amount_cents").notNull(),
    currency: currency(),
    status: text().$type<OccurrenceStatus>().notNull().default("planned"),
    transactionId: uuid(),
    ...timestamps,
  },
  (t) => [
    unique("recurring_occurrences_user_id_id_key").on(t.userId, t.id),
    // Idempotent generation: a rule never has two occurrences on the same day.
    unique("recurring_occurrences_rule_due_key").on(t.userId, t.ruleId, t.dueOn),
    unique("recurring_occurrences_transaction_key").on(t.userId, t.transactionId),
    // Calendar and "reste à vivre" by month.
    index("recurring_occurrences_user_due_idx").on(t.userId, t.dueOn),
    foreignKey({
      name: "recurring_occurrences_rule_fk",
      columns: [t.userId, t.ruleId],
      foreignColumns: [recurringRules.userId, recurringRules.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "recurring_occurrences_transaction_fk",
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }),
    check(
      "recurring_occurrences_status_check",
      sql`${t.status} in (${inList(OCCURRENCE_STATUSES)})`,
    ),
    check(
      "recurring_occurrences_link_check",
      sql`(${t.status} = 'confirmed') = (${t.transactionId} is not null)`,
    ),
    check("recurring_occurrences_amount_check", sql`${t.amountCents} <> 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Categorization rules                                                       */
/* -------------------------------------------------------------------------- */

/** "If label contains X (or merchant is M) then category C", evaluated by ascending priority. */
export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: id(),
    userId: ownerId(),
    matchType: text().$type<RuleMatchType>().notNull(),
    /** Normalized text pattern; null for `merchant` rules. */
    pattern: text(),
    merchantId: uuid(),
    categoryId: uuid().notNull(),
    priority: integer().notNull().default(100),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("categorization_rules_user_id_id_key").on(t.userId, t.id),
    // One rule per pattern or merchant: learning the same correction twice updates it.
    unique("categorization_rules_target_key")
      .on(t.userId, t.matchType, t.pattern, t.merchantId)
      .nullsNotDistinct(),
    index("categorization_rules_user_priority_idx")
      .on(t.userId, t.priority)
      .where(sql`${t.active}`),
    foreignKey({
      name: "categorization_rules_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "categorization_rules_merchant_fk",
      columns: [t.userId, t.merchantId],
      foreignColumns: [merchants.userId, merchants.id],
    }).onDelete("cascade"),
    check(
      "categorization_rules_match_type_check",
      sql`${t.matchType} in (${inList(RULE_MATCH_TYPES)})`,
    ),
    check(
      "categorization_rules_target_check",
      sql`(${t.matchType} = 'merchant' and ${t.merchantId} is not null and ${t.pattern} is null)
        or (${t.matchType} <> 'merchant' and ${t.merchantId} is null and btrim(coalesce(${t.pattern}, '')) <> '')`,
    ),
  ],
);
