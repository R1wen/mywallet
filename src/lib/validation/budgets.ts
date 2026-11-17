import { z } from "zod";
import { BUDGET_PERIODS } from "@/lib/domain/budgets";
import { RULE_MATCH_TYPES } from "@/lib/domain/categorize";
import { isValidIsoDay } from "@/lib/domain/dates";
import { parseAmountToCents } from "@/lib/domain/money";

const MAX_CENTS = 100_000_000_00;

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => v || null);

const positiveAmount = (message: string) =>
  z.string().transform((v, ctx) => {
    const cents = parseAmountToCents(v.trim());
    if (cents === null || cents <= 0 || cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return cents;
  });

/** An envelope: a category (empty = all expenses), an amount per period, an alert. */
export const budgetInputSchema = z.object({
  categoryId: optionalId,
  period: z.enum(BUDGET_PERIODS),
  amount: positiveAmount("Saisissez un montant positif."),
  alertPercent: z.coerce
    .number()
    .int("Seuil entier.")
    .min(1, "Seuil entre 1 et 100 %.")
    .max(100, "Seuil entre 1 et 100 %."),
});
export type BudgetFormValues = z.input<typeof budgetInputSchema>;
export type BudgetInput = z.output<typeof budgetInputSchema>;

/** A savings goal: progress follows a savings account, or what I add by hand. */
export const goalInputSchema = z.object({
  name: z.string().trim().min(1, "Donnez un nom.").max(60, "60 caractères maximum."),
  target: positiveAmount("Saisissez un objectif positif."),
  targetDate: z
    .union([z.string().refine(isValidIsoDay, "Date invalide."), z.literal("")])
    .optional()
    .transform((v) => v || null),
  accountId: optionalId,
});
export type GoalFormValues = z.input<typeof goalInputSchema>;
export type GoalInput = z.output<typeof goalInputSchema>;

/** Money put aside (or taken back, negative) for a goal tracked by hand. */
export const contributionSchema = z.object({
  goalId: z.uuid(),
  amount: z.string().transform((v, ctx) => {
    const cents = parseAmountToCents(v.trim());
    if (cents === null || cents === 0 || Math.abs(cents) > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Saisissez un montant." });
      return z.NEVER;
    }
    return cents;
  }),
});

/** A rule confirmed by the user ("Toujours classer … dans … ?"). */
export const ruleInputSchema = z
  .object({
    matchType: z.enum(RULE_MATCH_TYPES),
    pattern: z.string().trim().max(60).nullable(),
    merchantId: z.uuid().nullable(),
    categoryId: z.uuid(),
  })
  .refine(
    (r) =>
      r.matchType === "merchant"
        ? r.merchantId !== null && r.pattern === null
        : r.merchantId === null && (r.pattern?.length ?? 0) >= 2,
    "Règle invalide.",
  );
