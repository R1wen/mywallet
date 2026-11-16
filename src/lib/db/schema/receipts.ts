/**
 * Uploaded receipts (photos/PDF) and their OCR/extraction results.
 * OCR runs in the browser (ADR-008); nothing extracted is trusted until the user validates it.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, inList, ownerId, timestamps } from "./columns";
import { transactions } from "./finance";

export const RECEIPT_STATUSES = [
  "uploaded",
  "processing",
  "to_review",
  "validated",
  "rejected",
  "manual",
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    userId: ownerId(),
    /** Linked expense once validated. At most one receipt per transaction. */
    transactionId: uuid(),
    /** Object key in the storage adapter (never a public URL). */
    fileKey: text().notNull(),
    originalFilename: text(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    /** Lowercase hex SHA-256 of the file; detects duplicate uploads. */
    sha256: text().notNull(),
    status: text().$type<ReceiptStatus>().notNull().default("uploaded"),
    ocrText: text(),
    /** Structured fields proposed by OCR/LLM (merchant, date, lines, totals...). */
    extracted: jsonb().$type<Record<string, unknown>>(),
    /** Per-field confidence scores (0-1) for `extracted`. */
    confidence: jsonb().$type<Record<string, number>>(),
    returnDeadline: date({ mode: "string" }),
    warrantyUntil: date({ mode: "string" }),
    validatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("receipts_user_id_id_key").on(t.userId, t.id),
    unique("receipts_user_sha256_key").on(t.userId, t.sha256),
    uniqueIndex("receipts_user_transaction_key")
      .on(t.userId, t.transactionId)
      .where(sql`${t.transactionId} is not null`),
    // Review queue.
    index("receipts_user_status_idx").on(t.userId, t.status, t.createdAt.desc()),
    // Return / warranty reminders.
    index("receipts_user_return_idx")
      .on(t.userId, t.returnDeadline)
      .where(sql`${t.returnDeadline} is not null`),
    index("receipts_user_warranty_idx")
      .on(t.userId, t.warrantyUntil)
      .where(sql`${t.warrantyUntil} is not null`),
    foreignKey({
      name: "receipts_transaction_fk",
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }),
    check("receipts_status_check", sql`${t.status} in (${inList(RECEIPT_STATUSES)})`),
    check("receipts_size_check", sql`${t.sizeBytes} > 0`),
    check("receipts_sha256_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "receipts_validated_check",
      sql`${t.status} <> 'validated' or ${t.validatedAt} is not null`,
    ),
  ],
);
