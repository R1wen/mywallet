import { z } from "zod";
import { isValidIsoDay } from "@/lib/domain/dates";
import { parseAmountToCents } from "@/lib/domain/money";
import { RECURRENCE_FREQUENCIES } from "@/lib/domain/recurrence";

export const RECURRING_RULE_KINDS = ["expense", "income", "transfer"] as const;
export type RecurringRuleKind = (typeof RECURRING_RULE_KINDS)[number];

export const RECURRING_KIND_LABELS: Record<RecurringRuleKind, string> = {
  expense: "Charge",
  income: "Revenu",
  transfer: "Épargne",
};

export const FREQUENCY_LABELS = {
  monthly: "Mensuelle",
  weekly: "Hebdomadaire",
  yearly: "Annuelle",
} as const satisfies Record<(typeof RECURRENCE_FREQUENCIES)[number], string>;

const MAX_CENTS = 100_000_000_00;

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => v || null);

const amountField = z.string().trim().min(1, "Saisissez un montant.");

function parseMagnitude(raw: string, ctx: z.RefinementCtx): number | null {
  const cents = parseAmountToCents(raw);
  if (cents === null || cents <= 0) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant invalide." });
    return null;
  }
  if (cents > MAX_CENTS) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant trop élevé." });
    return null;
  }
  return cents;
}

/**
 * Recurring rule form (React Hook Form + server action). Amount typed as positive text,
 * stored signed: charges and savings are debits (< 0), income is a credit (> 0).
 */
export const recurringRuleInputSchema = z
  .object({
    kind: z.enum(RECURRING_RULE_KINDS),
    label: z.string().trim().max(140, "140 caractères maximum."),
    amount: amountField,
    merchantName: z.string().trim().max(80, "80 caractères maximum."),
    accountId: z.uuid("Choisissez un compte."),
    toAccountId: optionalId,
    categoryId: optionalId,
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.coerce
      .number("Intervalle invalide.")
      .int("Intervalle invalide.")
      .min(1, "Intervalle invalide.")
      .max(52, "52 au maximum."),
    dayOfMonth: z.coerce
      .number("Jour invalide.")
      .int("Jour invalide.")
      .min(1, "Jour entre 1 et 31.")
      .max(31, "Jour entre 1 et 31."),
    startOn: z.string().refine(isValidIsoDay, "Date invalide."),
    endOn: z.union([z.string().refine(isValidIsoDay, "Date invalide."), z.literal("")]),
  })
  .transform((v, ctx) => {
    const cents = parseMagnitude(v.amount, ctx);
    if (cents === null) return z.NEVER;
    const label = v.label || v.merchantName;
    if (!label) {
      ctx.addIssue({ code: "custom", path: ["label"], message: "Saisissez un libellé." });
      return z.NEVER;
    }
    if (v.kind === "transfer") {
      if (!v.toAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "Choisissez le compte d'épargne.",
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
    if (v.endOn && v.endOn < v.startOn) {
      ctx.addIssue({ code: "custom", path: ["endOn"], message: "La fin précède le début." });
      return z.NEVER;
    }
    return {
      kind: v.kind,
      label,
      amountCents: v.kind === "income" ? cents : -cents,
      merchantName: v.kind === "transfer" ? "" : v.merchantName,
      accountId: v.accountId,
      toAccountId: v.kind === "transfer" ? v.toAccountId : null,
      categoryId: v.categoryId,
      frequency: v.frequency,
      interval: v.interval,
      // Weekly rules follow the start date's weekday.
      dayOfMonth: v.frequency === "weekly" ? null : v.dayOfMonth,
      startOn: v.startOn,
      endOn: v.endOn || null,
    };
  });

export type RecurringRuleFormValues = z.input<typeof recurringRuleInputSchema>;
export type RecurringRuleInput = z.output<typeof recurringRuleInputSchema>;

/** Validating an occurrence: real amount (adjustable), real date and account. */
export const occurrenceConfirmSchema = z
  .object({
    amount: amountField,
    occurredOn: z.string().refine(isValidIsoDay, "Date invalide."),
    accountId: z.uuid("Choisissez un compte."),
  })
  .transform((v, ctx) => {
    const cents = parseMagnitude(v.amount, ctx);
    if (cents === null) return z.NEVER;
    return { magnitudeCents: cents, occurredOn: v.occurredOn, accountId: v.accountId };
  });

export type OccurrenceConfirmValues = z.input<typeof occurrenceConfirmSchema>;
export type OccurrenceConfirmInput = z.output<typeof occurrenceConfirmSchema>;
