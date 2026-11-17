import "server-only";
import { asc, eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db as defaultDb, type Db } from "@/lib/db/client";
import {
  accounts,
  bankImportPresets,
  budgets,
  categories,
  categorizationRules,
  claimPayments,
  claims,
  goals,
  importSettings,
  merchants,
  people,
  receipts,
  recurringOccurrences,
  recurringRules,
  subscriptionDismissals,
  transactionItems,
  transactions,
  user,
} from "@/lib/db/schema";
import { TX_KIND_LABELS } from "@/lib/validation/transaction";
import type { TransactionFilters } from "@/lib/validation/transaction";
import { listTransactions } from "./transactions";

/**
 * Exports (ADR-042). Full export of my data for the right of access and portability
 * (GDPR): every table filtered by `user_id`, binary columns left out (receipt files are
 * fetched one by one through their own route). Secrets (password hash, sessions) are
 * never exported.
 */

type Exportable = { table: PgTable; omit?: string[] };

export const EXPORT_TABLES = {
  comptes: { table: accounts },
  categories: { table: categories },
  magasins: { table: merchants, omit: ["logoData"] },
  transactions: { table: transactions },
  lignes_tickets: { table: transactionItems },
  personnes: { table: people },
  creances: { table: claims },
  remboursements: { table: claimPayments },
  regles_recurrentes: { table: recurringRules },
  echeances: { table: recurringOccurrences },
  tickets: { table: receipts },
  budgets: { table: budgets },
  objectifs: { table: goals },
  regles_classement: { table: categorizationRules },
  preglages_import: { table: bankImportPresets },
  reglages_import: { table: importSettings },
  abonnements_ignores: { table: subscriptionDismissals },
} satisfies Record<string, Exportable>;
export type ExportTableName = keyof typeof EXPORT_TABLES;

export const EXPORT_PAGE_SIZE = 2000;

/** One page of one of my tables, as plain JSON rows. */
export async function exportTablePage(
  userId: string,
  name: ExportTableName,
  page: number,
  db: Db = defaultDb,
): Promise<{ rows: Record<string, unknown>[]; hasMore: boolean }> {
  const spec: Exportable = EXPORT_TABLES[name];
  const columns = getTableColumns(spec.table) as Record<string, PgColumn>;
  const selected = Object.fromEntries(
    Object.entries(columns).filter(([key]) => !spec.omit?.includes(key)),
  );
  const owner = columns.userId!;
  const first = Object.values(columns)[0]!;
  const rows = await db
    .select(selected)
    .from(spec.table)
    .where(eq(owner, userId))
    .orderBy(asc(first))
    .limit(EXPORT_PAGE_SIZE + 1)
    .offset(page * EXPORT_PAGE_SIZE);
  return { rows: rows.slice(0, EXPORT_PAGE_SIZE), hasMore: rows.length > EXPORT_PAGE_SIZE };
}

/** My profile (no authentication secret). */
export async function exportProfile(userId: string, db: Db = defaultDb) {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? null;
}

export const MAX_EXPORT_ROWS = 50_000;

export type TransactionExportRow = {
  date: string;
  type: string;
  label: string;
  merchant: string;
  category: string;
  account: string;
  amountCents: number;
  /** My real share (expenses), the amount otherwise. */
  myShareCents: number;
  notes: string;
};

/** Movements matching the list filters, for CSV or Excel. */
export async function exportTransactions(
  userId: string,
  filters: TransactionFilters,
  db: Db = defaultDb,
): Promise<TransactionExportRow[]> {
  const { rows } = await listTransactions(userId, { ...filters, page: 1 }, db, MAX_EXPORT_ROWS);
  return rows.map((r) => ({
    date: r.occurredOn,
    type:
      r.kind === "transfer" ? "Virement" : TX_KIND_LABELS[r.kind as keyof typeof TX_KIND_LABELS],
    label: r.label,
    merchant: r.merchantName ?? "",
    category: r.categoryName ?? "",
    account: r.accountName,
    amountCents: r.amountCents,
    myShareCents: r.kind === "expense" ? r.amountCents + r.sharedCents : r.amountCents,
    notes: r.notes ?? "",
  }));
}
