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
import { user } from "./auth";
import { bytea, id, inList, ownerId, timestamps } from "./columns";
import { accounts, transactions } from "./finance";

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
    /** OCR engine that produced `ocrText` ("paddle", "tesseract", "pdf-text"). */
    ocrEngine: text(),
    /** Structurer that produced `extracted` ("rules", "ollama", "gemini"). */
    structurer: text(),
    /** Merchant + day + total key of the extraction, to flag a second photo of a ticket. */
    duplicateKey: text(),
    /** Why extraction failed (status "manual"); never contains receipt content. */
    failureReason: text(),
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
    index("receipts_user_duplicate_idx")
      .on(t.userId, t.duplicateKey)
      .where(sql`${t.duplicateKey} is not null`),
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

export const RECEIPT_FILE_KINDS = ["original", "thumbnail"] as const;
export type ReceiptFileKind = (typeof RECEIPT_FILE_KINDS)[number];

/**
 * Receipt file bytes (ADR-027), behind the StorageAdapter. Kept out of `receipts` so list
 * queries never load them. Deleting the receipt deletes its files.
 */
export const receiptFiles = pgTable(
  "receipt_files",
  {
    id: id(),
    userId: ownerId(),
    receiptId: uuid().notNull(),
    kind: text().$type<ReceiptFileKind>().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("receipt_files_receipt_kind_key").on(t.userId, t.receiptId, t.kind),
    foreignKey({
      name: "receipt_files_receipt_fk",
      columns: [t.userId, t.receiptId],
      foreignColumns: [receipts.userId, receipts.id],
    }).onDelete("cascade"),
    check("receipt_files_kind_check", sql`${t.kind} in (${inList(RECEIPT_FILE_KINDS)})`),
    check(
      "receipt_files_size_check",
      sql`${t.sizeBytes} > 0 and ${t.sizeBytes} = octet_length(${t.data})`,
    ),
  ],
);

/** Saved column mapping for a bank CSV layout, keyed by its normalized header. */
export type BankColumnMapping = {
  date: number;
  label: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
};

export const bankImportPresets = pgTable(
  "bank_import_presets",
  {
    id: id(),
    userId: ownerId(),
    /** `headerSignature()` of the CSV header row. */
    signature: text().notNull(),
    mapping: jsonb().$type<BankColumnMapping>().notNull(),
    /** Account last used with this layout. */
    accountId: uuid(),
    ...timestamps,
  },
  (t) => [
    unique("bank_import_presets_user_signature_key").on(t.userId, t.signature),
    foreignKey({
      name: "bank_import_presets_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete("cascade"),
    check("bank_import_presets_signature_check", sql`btrim(${t.signature}) <> ''`),
  ],
);

export const RECEIPT_STRUCTURERS = ["rules", "ollama", "gemini"] as const;
export type ReceiptStructurerName = (typeof RECEIPT_STRUCTURERS)[number];

/** Per-user import preferences (ADR-029). Absent row = defaults. */
export const importSettings = pgTable(
  "import_settings",
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Fallback used when the rules parser fails or is not confident. */
    structurer: text().$type<ReceiptStructurerName>().notNull().default("rules"),
    /** When the user accepted the Gemini privacy warning; required to use it. */
    geminiConsentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      "import_settings_structurer_check",
      sql`${t.structurer} in (${inList(RECEIPT_STRUCTURERS)})`,
    ),
    check(
      "import_settings_gemini_consent_check",
      sql`${t.structurer} <> 'gemini' or ${t.geminiConsentAt} is not null`,
    ),
  ],
);
