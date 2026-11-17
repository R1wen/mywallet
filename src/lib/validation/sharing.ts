import { z } from "zod";
import { ME } from "@/lib/domain/claims";
import { isValidIsoDay } from "@/lib/domain/dates";
import { parseAmountToCents } from "@/lib/domain/money";

const MAX_CENTS = 100_000_000_00;
export const MAX_PARTICIPANTS = 20;

/** "me" or the id of one of my people. */
export const participantSchema = z.union([z.literal(ME), z.uuid()]);

const participants = z
  .array(participantSchema)
  .max(MAX_PARTICIPANTS, `${MAX_PARTICIPANTS} personnes maximum.`)
  .transform((ids) => [...new Set(ids)]);

/**
 * Who shares an expense. `lines[i]` lists the participants of receipt line i (empty or
 * ["me"] = mine); `whole` splits an expense without lines. Only one of them is used:
 * the lines when the expense has some.
 */
export const sharesInputSchema = z.object({
  lines: z.array(participants).max(200, "200 lignes maximum."),
  whole: participants,
});
export type SharesInput = z.output<typeof sharesInputSchema>;

export const saveSharesSchema = sharesInputSchema.extend({ transactionId: z.uuid() });

export const personInputSchema = z.object({
  name: z.string().trim().min(1, "Saisissez un nom.").max(60, "60 caractères maximum."),
  notes: z
    .string()
    .trim()
    .max(200, "200 caractères maximum.")
    .optional()
    .transform((v) => v || null),
});
export type PersonInputValues = z.input<typeof personInputSchema>;

/**
 * Money received from a person, split over some of their claims (the form proposes the
 * oldest first). Empty or zero amounts are lines left unpaid.
 */
export const paymentInputSchema = z
  .object({
    personId: z.uuid(),
    occurredOn: z.string().refine(isValidIsoDay, "Date invalide."),
    accountId: z.uuid("Choisissez un compte."),
    allocations: z
      .array(z.object({ claimId: z.uuid(), amount: z.string().trim().max(20) }))
      .min(1)
      .max(200),
  })
  .transform((v, ctx) => {
    const seen = new Set<string>();
    const allocations: { claimId: string; amountCents: number }[] = [];
    for (const [i, a] of v.allocations.entries()) {
      if (seen.has(a.claimId)) {
        ctx.addIssue({ code: "custom", path: ["allocations", i], message: "Créance en double." });
        return z.NEVER;
      }
      seen.add(a.claimId);
      if (!a.amount) continue;
      const cents = parseAmountToCents(a.amount);
      if (cents === null || cents < 0 || cents > MAX_CENTS) {
        ctx.addIssue({
          code: "custom",
          path: ["allocations", i, "amount"],
          message: "Montant invalide.",
        });
        return z.NEVER;
      }
      if (cents > 0) allocations.push({ claimId: a.claimId, amountCents: cents });
    }
    const totalCents = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (totalCents <= 0) {
      ctx.addIssue({ code: "custom", path: ["allocations"], message: "Saisissez un montant." });
      return z.NEVER;
    }
    return { ...v, allocations, totalCents };
  });
export type PaymentInputValues = z.input<typeof paymentInputSchema>;
export type PaymentInput = z.output<typeof paymentInputSchema>;

export const CLAIM_ACTIONS = ["gift", "cancel", "reopen"] as const;
export const claimActionSchema = z.object({
  claimId: z.uuid(),
  action: z.enum(CLAIM_ACTIONS),
});
