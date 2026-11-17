import { z } from "zod";
import { isValidIsoDay } from "@/lib/domain/dates";
import { formatCents, parseAmountToCents } from "@/lib/domain/money";
import { sharesInputSchema } from "./sharing";

export const OCR_ENGINES = ["paddle", "tesseract", "pdf-text"] as const;
export type OcrEngineName = (typeof OCR_ENGINES)[number];

export const OCR_FAILURES = ["ocr_failed", "unsupported", "empty"] as const;
export const OCR_FAILURE_LABELS: Record<(typeof OCR_FAILURES)[number], string> = {
  ocr_failed: "La lecture automatique a échoué.",
  unsupported: "Ce format ne peut pas être lu automatiquement.",
  empty: "Aucun texte n'a été trouvé sur le ticket.",
};

/** Raw OCR text sent by the browser. The server parses it itself (never trusts a parse). */
export const extractionInputSchema = z.object({
  receiptId: z.uuid(),
  ocrText: z.string().max(20_000),
  ocrEngine: z.enum(OCR_ENGINES).nullable(),
  failure: z.enum(OCR_FAILURES).nullable(),
});

const MAX_CENTS = 100_000_000_00;

const optionalDay = z
  .union([z.string().refine(isValidIsoDay, "Date invalide."), z.literal("")])
  .transform((v) => v || null);

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => v || null);

const QUANTITY = /^\d{1,4}(?:[,.]\d{1,3})?$/;

export const receiptItemInputSchema = z
  .object({
    label: z.string().trim().min(1, "Libellé requis.").max(140, "140 caractères maximum."),
    quantity: z.string().trim(),
    /** Line total, negative for a discount line. */
    amount: z.string().trim().min(1, "Montant requis."),
    /** Category of the line; empty = the receipt's (ADR-038). */
    categoryId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((v) => v || null),
  })
  .transform((v, ctx) => {
    const quantity = v.quantity ? Number(v.quantity.replace(",", ".")) : 1;
    if (v.quantity && (!QUANTITY.test(v.quantity) || quantity <= 0)) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantité invalide." });
      return z.NEVER;
    }
    const totalCents = parseAmountToCents(v.amount);
    if (totalCents === null || totalCents === 0 || Math.abs(totalCents) > MAX_CENTS) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant invalide." });
      return z.NEVER;
    }
    return {
      label: v.label,
      quantity,
      unitPriceCents: Math.round(totalCents / quantity),
      totalCents,
      categoryId: v.categoryId,
    };
  });

/** Review form of a receipt, shared by the form and the validate action. */
export const receiptReviewSchema = z
  .object({
    merchantName: z
      .string()
      .trim()
      .min(1, "Saisissez le magasin.")
      .max(80, "80 caractères maximum."),
    occurredOn: z.string().refine(isValidIsoDay, "Date invalide."),
    amount: z.string().trim().min(1, "Saisissez le total."),
    accountId: z.uuid("Choisissez un compte."),
    categoryId: optionalId,
    notes: z.string().trim().max(500, "500 caractères maximum."),
    items: z.array(receiptItemInputSchema).max(200, "200 lignes maximum."),
    returnDeadline: optionalDay,
    warrantyUntil: optionalDay,
    /** Existing bank movement to attach the receipt to instead of creating one (ADR-028). */
    attachToTransactionId: optionalId,
    /** "Tout est à moi ?" step: who shares the receipt (Sprint 4). Null = all mine. */
    shares: sharesInputSchema.nullish(),
  })
  .transform((v, ctx) => {
    const totalCents = parseAmountToCents(v.amount);
    if (totalCents === null || totalCents <= 0 || totalCents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Total invalide." });
      return z.NEVER;
    }
    if (v.items.length) {
      const sum = v.items.reduce((s, i) => s + i.totalCents, 0);
      if (sum !== totalCents) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: `La somme des lignes (${formatCents(sum)}) doit être égale au total (${formatCents(totalCents)}).`,
        });
        return z.NEVER;
      }
    }
    if (v.shares && v.items.length && v.shares.lines.length !== v.items.length) {
      ctx.addIssue({ code: "custom", path: ["shares"], message: "Partage incomplet." });
      return z.NEVER;
    }
    for (const field of ["returnDeadline", "warrantyUntil"] as const) {
      const day = v[field];
      if (day && day < v.occurredOn) {
        ctx.addIssue({ code: "custom", path: [field], message: "Date antérieure à l'achat." });
        return z.NEVER;
      }
    }
    return {
      merchantName: v.merchantName,
      occurredOn: v.occurredOn,
      totalCents,
      accountId: v.accountId,
      categoryId: v.categoryId,
      notes: v.notes || null,
      items: v.items,
      returnDeadline: v.returnDeadline,
      warrantyUntil: v.warrantyUntil,
      attachToTransactionId: v.attachToTransactionId,
      shares: v.shares ?? null,
    };
  });

export type ReceiptReviewValues = z.input<typeof receiptReviewSchema>;
export type ReceiptReviewInput = z.output<typeof receiptReviewSchema>;

/* -------------------------------------------------------------------------- */
/* Bank CSV                                                                   */
/* -------------------------------------------------------------------------- */

const column = z.number().int().min(0).max(99);

export const columnMappingSchema = z
  .object({
    date: column,
    label: column,
    amount: column.nullable(),
    debit: column.nullable(),
    credit: column.nullable(),
  })
  .refine((m) => m.amount !== null || (m.debit !== null && m.credit !== null), {
    message: "Choisissez la colonne du montant, ou les colonnes débit et crédit.",
  });

export const MAX_CSV_CHARS = 2_000_000;
export const MAX_CSV_LINES = 5_000;

export const bankPreviewSchema = z.object({
  accountId: z.uuid("Choisissez un compte."),
  csv: z
    .string()
    .min(1, "Fichier vide.")
    .max(MAX_CSV_CHARS, "Fichier trop volumineux (2 Mo maximum)."),
  mapping: columnMappingSchema.nullable(),
});

/** `reimburse`: an incoming transfer paying back a person's claims (ADR-035). */
export const IMPORT_ACTIONS = ["create", "link", "skip", "reimburse"] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export const bankCommitSchema = bankPreviewSchema.extend({
  mapping: columnMappingSchema,
  decisions: z
    .array(
      z.object({
        row: z.number().int().min(1),
        action: z.enum(IMPORT_ACTIONS),
        /** Person paying back, for `reimburse`. */
        personId: z.uuid().optional(),
      }),
    )
    .max(MAX_CSV_LINES),
});

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export const importSettingsSchema = z.object({
  structurer: z.enum(["rules", "ollama", "gemini"]),
  /** Must be true to select Gemini: the user read the privacy warning. */
  geminiConsent: z.boolean(),
});
