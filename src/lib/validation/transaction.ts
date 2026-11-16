import { z } from "zod";
import { isValidIsoDay } from "@/lib/domain/dates";
import { parseAmountToCents } from "@/lib/domain/money";

/** Kinds the user can create from the form (reimbursements come from claims, Sprint 4). */
export const EDITABLE_TX_KINDS = ["expense", "income", "refund", "transfer"] as const;
export type EditableTxKind = (typeof EDITABLE_TX_KINDS)[number];

export const TX_KIND_LABELS: Record<EditableTxKind | "reimbursement", string> = {
  expense: "Dépense",
  income: "Entrée",
  refund: "Avoir",
  transfer: "Virement",
  reimbursement: "Remboursement",
};

const MAX_CENTS = 100_000_000_00; // 100 millions d'euros : garde-fou contre les fautes de frappe

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => v || null);

/**
 * Transaction form, shared by React Hook Form and the server action. The amount is typed
 * as text ("12,50") and parsed to a positive number of cents; the sign comes from the kind.
 */
export const transactionInputSchema = z
  .object({
    kind: z.enum(EDITABLE_TX_KINDS),
    amount: z.string().trim().min(1, "Saisissez un montant."),
    occurredOn: z.string().refine(isValidIsoDay, "Date invalide."),
    label: z.string().trim().max(140, "140 caractères maximum."),
    merchantName: z.string().trim().max(80, "80 caractères maximum."),
    accountId: z.uuid("Choisissez un compte."),
    toAccountId: optionalId,
    categoryId: optionalId,
    notes: z.string().trim().max(500, "500 caractères maximum."),
  })
  .transform((v, ctx) => {
    const cents = parseAmountToCents(v.amount);
    if (cents === null || cents <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant invalide." });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant trop élevé." });
      return z.NEVER;
    }
    const label = v.label || v.merchantName;
    if (!label) {
      ctx.addIssue({
        code: "custom",
        path: ["label"],
        message: "Saisissez un libellé ou un magasin.",
      });
      return z.NEVER;
    }
    if (v.kind === "transfer") {
      if (!v.toAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "Choisissez le compte crédité.",
        });
        return z.NEVER;
      }
      if (v.toAccountId === v.accountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "Choisissez deux comptes différents.",
        });
        return z.NEVER;
      }
    }
    return {
      kind: v.kind,
      amountCents: cents,
      occurredOn: v.occurredOn,
      label,
      merchantName: v.kind === "transfer" ? "" : v.merchantName,
      accountId: v.accountId,
      toAccountId: v.kind === "transfer" ? v.toAccountId : null,
      categoryId: v.categoryId,
      notes: v.notes || null,
    };
  });

export type TransactionFormValues = z.input<typeof transactionInputSchema>;
export type TransactionInput = z.output<typeof transactionInputSchema>;

/* -------------------------------------------------------------------------- */
/* List filters (URL search params, French names)                             */
/* -------------------------------------------------------------------------- */

export const TX_SORTS = ["date", "montant", "libelle"] as const;
export const PAGE_SIZE = 50;

const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export const transactionFiltersSchema = z.object({
  q: z.preprocess(first, loose(z.string().trim().max(100))),
  compte: z.preprocess(first, loose(z.uuid())),
  categorie: z.preprocess(first, loose(z.uuid())),
  marchand: z.preprocess(first, loose(z.uuid())),
  type: z.preprocess(first, loose(z.enum([...EDITABLE_TX_KINDS, "reimbursement"]))),
  du: z.preprocess(first, loose(z.string().refine(isValidIsoDay))),
  au: z.preprocess(first, loose(z.string().refine(isValidIsoDay))),
  tri: z.preprocess(first, z.enum(TX_SORTS).catch("date")),
  ordre: z.preprocess(first, z.enum(["asc", "desc"]).catch("desc")),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(10_000).catch(1)),
});

export type TransactionFilters = z.output<typeof transactionFiltersSchema>;

export function parseTransactionFilters(
  params: Record<string, string | string[] | undefined>,
): TransactionFilters {
  return transactionFiltersSchema.parse(params);
}
