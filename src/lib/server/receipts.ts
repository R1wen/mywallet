import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import {
  accounts,
  importSettings,
  merchants,
  receiptFiles,
  receipts,
  transactionItems,
  transactions,
  type ReceiptStatus,
  type ReceiptStructurerName,
} from "@/lib/db/schema";
import { checkUpload, detectUploadType, sanitizeFilename } from "@/lib/domain/files";
import { findMerchantByLabel, normalizeMerchantName } from "@/lib/domain/merchant";
import { parseReceiptText, type ParsedReceipt } from "@/lib/domain/receipts/parse";
import {
  dateWindow,
  duplicateKey,
  validateReceipt,
  type ConfidenceLevel,
  type ReceiptIssue,
  type ReviewField,
} from "@/lib/domain/receipts/validate";
import type { OcrEngineName, ReceiptReviewInput } from "@/lib/validation/imports";
import { OCR_FAILURE_LABELS } from "@/lib/validation/imports";
import {
  constraintOf,
  fail,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  NOT_FOUND,
  ok,
  type Result,
} from "./result";
import { storage } from "./storage";
import { structureWithModel } from "./structurers";
import { resolveMerchant, writeTransaction } from "./transactions";

/** What the review screen needs from an extraction (stored in `receipts.extracted`). */
export type ReceiptExtraction = {
  parsed: ParsedReceipt;
  /** Directory merchant matched by name or alias, else a cleaned name proposal. */
  merchantName: string | null;
  merchantId: string | null;
  level: ConfidenceLevel;
  issues: ReceiptIssue[];
  /** Another receipt with the same merchant, day and total. */
  duplicateOfId: string | null;
};

const OPEN_STATUSES: ReceiptStatus[] = ["uploaded", "processing", "to_review", "manual"];
const MAX_THUMBNAIL_BYTES = 300 * 1024;

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/* -------------------------------------------------------------------------- */
/* Upload                                                                     */
/* -------------------------------------------------------------------------- */

export type UploadedReceipt = { id: string; duplicate: boolean };

/**
 * Stores an uploaded file after checking its real type (magic bytes) and size. The same
 * file uploaded twice returns the first receipt (`duplicate: true`), nothing is stored.
 */
export async function createReceipt(
  userId: string,
  input: { data: Uint8Array; filename: string; thumbnail: Uint8Array | null },
  db: Db = defaultDb,
): Promise<Result<UploadedReceipt>> {
  const type = detectUploadType(input.data);
  const error = checkUpload({ type, size: input.data.byteLength });
  if (error || !type) return fail(error ?? "Format non pris en charge.");

  let thumbnail: Buffer | null = null;
  if (input.thumbnail?.byteLength) {
    const thumbType = detectUploadType(input.thumbnail);
    if (thumbType !== "image/jpeg" && thumbType !== "image/webp")
      return fail("Miniature invalide.");
    if (input.thumbnail.byteLength > MAX_THUMBNAIL_BYTES) return fail("Miniature trop lourde.");
    thumbnail = Buffer.from(input.thumbnail);
  }

  const hash = sha256(input.data);
  const findExisting = async () => {
    const [row] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.userId, userId), eq(receipts.sha256, hash)));
    return row;
  };
  const existing = await findExisting();
  if (existing) return ok({ id: existing.id, duplicate: true });

  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(receipts).values({
        id,
        userId,
        fileKey: `${id}/original`,
        originalFilename: sanitizeFilename(input.filename),
        mimeType: type,
        sizeBytes: input.data.byteLength,
        sha256: hash,
        status: type === "image/heic" ? "manual" : "uploaded",
        failureReason: type === "image/heic" ? "unsupported" : null,
      });
      await storage.put(
        userId,
        id,
        "original",
        { mimeType: type, data: Buffer.from(input.data) },
        tx,
      );
      if (thumbnail) {
        const thumbType = detectUploadType(thumbnail) as "image/jpeg" | "image/webp";
        await storage.put(userId, id, "thumbnail", { mimeType: thumbType, data: thumbnail }, tx);
      }
    });
  } catch (e) {
    // Same file sent twice at once: the other request won.
    if (isUniqueViolation(e) && constraintOf(e) === "receipts_user_sha256_key") {
      const row = await findExisting();
      if (row) return ok({ id: row.id, duplicate: true });
    }
    throw e;
  }
  return ok({ id, duplicate: false });
}

/* -------------------------------------------------------------------------- */
/* Queue and detail                                                           */
/* -------------------------------------------------------------------------- */

export type ReceiptListRow = {
  id: string;
  status: ReceiptStatus;
  filename: string | null;
  mimeType: string;
  createdAt: Date;
  merchantName: string | null;
  date: string | null;
  totalCents: number | null;
  level: ConfidenceLevel | null;
  duplicate: boolean;
  hasThumbnail: boolean;
  transactionId: string | null;
};

function summary(extracted: unknown) {
  const e = extracted as ReceiptExtraction | null;
  return {
    merchantName: e?.merchantName ?? e?.parsed.merchantRaw ?? null,
    date: e?.parsed.date ?? null,
    totalCents: e?.parsed.totalCents ?? null,
    level: e?.level ?? null,
    duplicate: Boolean(e?.duplicateOfId),
  };
}

export async function listReceipts(
  userId: string,
  filter: { statuses?: ReceiptStatus[]; limit?: number } = {},
  db: Db = defaultDb,
): Promise<ReceiptListRow[]> {
  const rows = await db
    .select({
      id: receipts.id,
      status: receipts.status,
      filename: receipts.originalFilename,
      mimeType: receipts.mimeType,
      createdAt: receipts.createdAt,
      extracted: receipts.extracted,
      transactionId: receipts.transactionId,
      hasThumbnail: sql<boolean>`exists (
        select 1 from ${receiptFiles}
        where ${receiptFiles.userId} = ${receipts.userId}
          and ${receiptFiles.receiptId} = ${receipts.id}
          and ${receiptFiles.kind} = 'thumbnail')`,
    })
    .from(receipts)
    .where(
      and(
        eq(receipts.userId, userId),
        filter.statuses?.length ? inArray(receipts.status, filter.statuses) : undefined,
      ),
    )
    .orderBy(desc(receipts.createdAt))
    .limit(filter.limit ?? 200);
  return rows.map(({ extracted, ...r }) => ({ ...r, ...summary(extracted) }));
}

export type BankMatch = {
  id: string;
  label: string;
  occurredOn: string;
  accountId: string;
  accountName: string;
  amountCents: number;
  bankLabel: string | null;
};

export type ReceiptDetail = {
  id: string;
  status: ReceiptStatus;
  filename: string | null;
  mimeType: string;
  createdAt: Date;
  ocrEngine: string | null;
  structurer: string | null;
  failureReason: string | null;
  extraction: ReceiptExtraction | null;
  confidence: Partial<Record<ReviewField, number>> | null;
  transactionId: string | null;
  returnDeadline: string | null;
  warrantyUntil: string | null;
  hasThumbnail: boolean;
  /** Bank movements without receipt matching the proposed total and date (ADR-028). */
  bankMatches: BankMatch[];
};

export async function getReceipt(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<ReceiptDetail | null> {
  const [row] = await db
    .select({
      id: receipts.id,
      status: receipts.status,
      filename: receipts.originalFilename,
      mimeType: receipts.mimeType,
      createdAt: receipts.createdAt,
      ocrEngine: receipts.ocrEngine,
      structurer: receipts.structurer,
      failureReason: receipts.failureReason,
      extracted: receipts.extracted,
      confidence: receipts.confidence,
      transactionId: receipts.transactionId,
      returnDeadline: receipts.returnDeadline,
      warrantyUntil: receipts.warrantyUntil,
    })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.id, id)));
  if (!row) return null;
  const [thumb] = await db
    .select({ id: receiptFiles.id })
    .from(receiptFiles)
    .where(
      and(
        eq(receiptFiles.userId, userId),
        eq(receiptFiles.receiptId, id),
        eq(receiptFiles.kind, "thumbnail"),
      ),
    );
  const extraction = row.extracted as ReceiptExtraction | null;
  const { extracted: _, ...rest } = row;
  const parsed = extraction?.parsed;
  const bankMatches =
    row.status !== "validated" && parsed?.totalCents && parsed.date
      ? await findBankMatches(userId, parsed.totalCents, parsed.date, db)
      : [];
  return {
    ...rest,
    failureReason: row.failureReason
      ? (OCR_FAILURE_LABELS[row.failureReason as keyof typeof OCR_FAILURE_LABELS] ??
        row.failureReason)
      : null,
    extraction,
    confidence: row.confidence as ReceiptDetail["confidence"],
    hasThumbnail: Boolean(thumb),
    bankMatches,
  };
}

/** Imported bank movements (expense, same amount, ±3 days) that have no receipt yet. */
export async function findBankMatches(
  userId: string,
  totalCents: number,
  date: string,
  db: Db = defaultDb,
): Promise<BankMatch[]> {
  const { from, to } = dateWindow(date);
  const rows = await db
    .select({
      id: transactions.id,
      label: transactions.label,
      occurredOn: transactions.occurredOn,
      accountId: transactions.accountId,
      accountName: accounts.name,
      amountCents: transactions.amountCents,
      bankLabel: transactions.bankLabel,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(accounts.userId, transactions.userId), eq(accounts.id, transactions.accountId)),
    )
    .leftJoin(
      receipts,
      and(eq(receipts.userId, transactions.userId), eq(receipts.transactionId, transactions.id)),
    )
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, "expense"),
        eq(transactions.amountCents, -totalCents),
        gte(transactions.occurredOn, from),
        lte(transactions.occurredOn, to),
        isNull(receipts.id),
      ),
    )
    .orderBy(sql`abs(${transactions.occurredOn} - ${date}::date)`, asc(transactions.occurredOn))
    .limit(5);
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

function titleCase(s: string): string {
  return s.replace(/\p{L}[\p{L}']*/gu, (w) => w[0]!.toUpperCase() + w.slice(1));
}

async function getStructurer(userId: string, db: Db): Promise<ReceiptStructurerName> {
  const [row] = await db
    .select({ structurer: importSettings.structurer })
    .from(importSettings)
    .where(eq(importSettings.userId, userId));
  return row?.structurer ?? "rules";
}

/** Marks a receipt as being read by the browser (status "processing"). */
export async function markProcessing(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(receipts)
    .set({ status: "processing" })
    .where(
      and(
        eq(receipts.userId, userId),
        eq(receipts.id, id),
        inArray(receipts.status, ["uploaded", "processing", "to_review", "manual"]),
      ),
    )
    .returning({ id: receipts.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/**
 * Stores OCR text from the browser and the server's own parse of it (the client never
 * sends structured values). A model is asked only when the rules are not confident and
 * the user chose one (ADR-029). Nothing reaches a balance until the user validates.
 */
export async function saveExtraction(
  userId: string,
  input: {
    receiptId: string;
    ocrText: string;
    ocrEngine: OcrEngineName | null;
    failure: "ocr_failed" | "unsupported" | "empty" | null;
  },
  today: string,
  db: Db = defaultDb,
): Promise<Result<{ status: ReceiptStatus }>> {
  const [current] = await db
    .select({ status: receipts.status, mimeType: receipts.mimeType })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.id, input.receiptId)));
  if (!current) return fail(NOT_FOUND);
  if (!OPEN_STATUSES.includes(current.status)) return fail("Ce ticket est déjà traité.");

  const text = input.ocrText.trim();
  const failure = input.failure ?? (text ? null : "empty");
  let parsed: ParsedReceipt | null = text ? parseReceiptText(text) : null;
  let validation = parsed ? validateReceipt(parsed, today) : null;
  let structurer: ReceiptStructurerName | null = parsed ? "rules" : null;

  const chosen = await getStructurer(userId, db);
  if (chosen !== "rules" && (!validation || validation.level === "low")) {
    const file = await storage.get(userId, input.receiptId, "original");
    const modelResult = file ? await structureWithModel(chosen, file, text) : null;
    if (modelResult) {
      const v = validateReceipt(modelResult, today);
      const rank = { low: 0, medium: 1, high: 2 } as const;
      if (!validation || rank[v.level] > rank[validation.level]) {
        parsed = modelResult;
        validation = v;
        structurer = chosen;
      }
    }
  }

  if (!parsed || !validation) {
    await db
      .update(receipts)
      .set({
        status: "manual",
        ocrText: text || null,
        ocrEngine: input.ocrEngine,
        failureReason: failure ?? "empty",
        extracted: null,
        confidence: null,
      })
      .where(and(eq(receipts.userId, userId), eq(receipts.id, input.receiptId)));
    return ok({ status: "manual" });
  }

  const known = await db
    .select({
      id: merchants.id,
      name: merchants.name,
      normalizedName: merchants.normalizedName,
      aliases: merchants.aliases,
    })
    .from(merchants)
    .where(eq(merchants.userId, userId));
  const match = parsed.merchantRaw ? findMerchantByLabel(parsed.merchantRaw, known) : null;
  const merchantName =
    match?.name ??
    (parsed.merchantRaw ? titleCase(normalizeMerchantName(parsed.merchantRaw)) : null);

  const key = duplicateKey(merchantName, parsed.date, parsed.totalCents);
  let duplicateOfId: string | null = null;
  if (key) {
    const [dup] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(
        and(
          eq(receipts.userId, userId),
          eq(receipts.duplicateKey, key),
          ne(receipts.id, input.receiptId),
          ne(receipts.status, "rejected"),
        ),
      )
      .limit(1);
    duplicateOfId = dup?.id ?? null;
  }

  const extraction: ReceiptExtraction = {
    parsed,
    merchantName: merchantName || null,
    merchantId: match?.id ?? null,
    level: validation.level,
    issues: validation.issues,
    duplicateOfId,
  };
  await db
    .update(receipts)
    .set({
      status: "to_review",
      ocrText: text,
      ocrEngine: input.ocrEngine,
      structurer,
      failureReason: null,
      extracted: extraction as unknown as Record<string, unknown>,
      confidence: validation.confidence,
      duplicateKey: key,
    })
    .where(and(eq(receipts.userId, userId), eq(receipts.id, input.receiptId)));
  return ok({ status: "to_review" });
}

/* -------------------------------------------------------------------------- */
/* Review decisions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Human validation: creates the expense with its lines, or attaches the receipt to an
 * imported bank movement of the same amount (the bank keeps the truth for amount, date
 * and account; the receipt brings the merchant, category and lines).
 */
export async function confirmReceipt(
  userId: string,
  id: string,
  input: ReceiptReviewInput,
  db: Db = defaultDb,
): Promise<Result<{ transactionId: string }>> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: receipts.status })
        .from(receipts)
        .where(and(eq(receipts.userId, userId), eq(receipts.id, id)))
        .for("update");
      if (!current) return fail(NOT_FOUND);
      if (!OPEN_STATUSES.includes(current.status)) return fail("Ce ticket est déjà traité.");

      let transactionId: string;
      if (input.attachToTransactionId) {
        const [target] = await tx
          .select({
            id: transactions.id,
            amountCents: transactions.amountCents,
            kind: transactions.kind,
          })
          .from(transactions)
          .where(
            and(eq(transactions.userId, userId), eq(transactions.id, input.attachToTransactionId)),
          )
          .for("update");
        if (!target || target.kind !== "expense") return fail("Mouvement bancaire introuvable.");
        if (target.amountCents !== -input.totalCents) {
          return fail("Le total du ticket diffère du mouvement bancaire.");
        }
        const merchant = await resolveMerchant(userId, input.merchantName, tx);
        await tx
          .update(transactions)
          .set({
            label: input.merchantName,
            merchantId: merchant?.id ?? null,
            categoryId: input.categoryId ?? merchant?.defaultCategoryId ?? null,
            ...(input.notes ? { notes: input.notes } : {}),
          })
          .where(and(eq(transactions.userId, userId), eq(transactions.id, target.id)));
        transactionId = target.id;
      } else {
        const written = await writeTransaction(
          userId,
          {
            kind: "expense",
            amountCents: input.totalCents,
            occurredOn: input.occurredOn,
            label: input.merchantName,
            merchantName: input.merchantName,
            accountId: input.accountId,
            toAccountId: null,
            categoryId: input.categoryId,
            notes: input.notes,
          },
          tx,
        );
        if (!written.ok) return written;
        transactionId = written.data.id;
      }

      await tx
        .delete(transactionItems)
        .where(
          and(
            eq(transactionItems.userId, userId),
            eq(transactionItems.transactionId, transactionId),
          ),
        );
      if (input.items.length) {
        await tx.insert(transactionItems).values(
          input.items.map((item, position) => ({
            userId,
            transactionId,
            position,
            label: item.label,
            quantity: String(item.quantity),
            unitPriceCents: item.unitPriceCents,
            totalCents: item.totalCents,
          })),
        );
      }

      await tx
        .update(receipts)
        .set({
          status: "validated",
          validatedAt: new Date(),
          transactionId,
          returnDeadline: input.returnDeadline,
          warrantyUntil: input.warrantyUntil,
        })
        .where(and(eq(receipts.userId, userId), eq(receipts.id, id)));
      return ok({ transactionId });
    });
  } catch (e) {
    if (isUniqueViolation(e) && constraintOf(e) === "receipts_user_transaction_key") {
      return fail("Ce mouvement a déjà un ticket.");
    }
    if (isForeignKeyViolation(e)) return fail("Compte, catégorie ou magasin introuvable.");
    if (isCheckViolation(e)) return fail("Ticket invalide.");
    throw e;
  }
}

export async function rejectReceipt(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(receipts)
    .set({ status: "rejected" })
    .where(
      and(
        eq(receipts.userId, userId),
        eq(receipts.id, id),
        inArray(receipts.status, OPEN_STATUSES),
      ),
    )
    .returning({ id: receipts.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/** Back to review (a rejected receipt, or a validated one whose movement was deleted). */
export async function reopenReceipt(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(receipts)
    .set({
      status: sql`case when ${receipts.extracted} is null then 'manual' else 'to_review' end`,
    })
    .where(and(eq(receipts.userId, userId), eq(receipts.id, id), eq(receipts.status, "rejected")))
    .returning({ id: receipts.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/** Deletes the receipt and its files. A validated movement stays (its lines too). */
export async function deleteReceipt(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .delete(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.id, id)))
    .returning({ id: receipts.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

export async function getReceiptFile(userId: string, id: string, kind: "original" | "thumbnail") {
  return storage.get(userId, id, kind);
}
