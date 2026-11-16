/**
 * "Reste à vivre" (ADR-025): money actually available until the end of the month.
 *
 *   reste = balance of spendable accounts (checking, cash)
 *         + planned occurrences of the month not yet validated (charges and savings < 0, income > 0)
 *   utilisable aujourd'hui = reste / days left (today included), floored, never negative.
 *
 * Only the part of a planned movement that touches a spendable account counts: a saving from
 * the checking account to a savings account lowers it, a transfer between two spendable
 * accounts does not change it.
 */
import type { Cents } from "./money";
import { daysBetweenInclusive } from "./recurrence";

export type PlannedFlow = {
  accountId: string;
  /** Destination of a transfer (savings), null otherwise. */
  toAccountId: string | null;
  /** Signed like transactions; for a transfer, the (negative) debit of `accountId`. */
  amountCents: Cents;
};

export function plannedEffect(flow: PlannedFlow, spendable: ReadonlySet<string>): Cents {
  const out = spendable.has(flow.accountId) ? flow.amountCents : 0;
  if (flow.toAccountId === null) return out;
  const into = spendable.has(flow.toAccountId) ? -flow.amountCents : 0;
  return out + into;
}

export type ResteAVivre = {
  resteCents: Cents;
  /** Sum of the negative effects (charges, savings), <= 0. */
  plannedChargesCents: Cents;
  /** Sum of the positive effects (income, withdrawals from savings), >= 0. */
  plannedIncomeCents: Cents;
  daysLeft: number;
  perDayCents: Cents;
};

export function computeResteAVivre(input: {
  spendableBalanceCents: Cents;
  spendableAccountIds: ReadonlySet<string>;
  planned: readonly PlannedFlow[];
  /** Calendar days "YYYY-MM-DD", Europe/Paris. */
  today: string;
  monthEnd: string;
}): ResteAVivre {
  let charges = 0;
  let income = 0;
  for (const flow of input.planned) {
    const effect = plannedEffect(flow, input.spendableAccountIds);
    if (effect < 0) charges += effect;
    else income += effect;
  }
  const resteCents = input.spendableBalanceCents + charges + income;
  const daysLeft = Math.max(1, daysBetweenInclusive(input.today, input.monthEnd));
  return {
    resteCents,
    plannedChargesCents: charges,
    plannedIncomeCents: income,
    daysLeft,
    perDayCents: resteCents > 0 ? Math.floor(resteCents / daysLeft) : 0,
  };
}
