/**
 * Money movements (pure). Sign convention (ADR-017, ADR-020): amounts are signed from the
 * account's point of view, negative = money out, positive = money in.
 *   expense < 0 · income > 0 · refund (merchant credit note) > 0 · reimbursement > 0
 *   transfer: two rows, one < 0 and one > 0.
 * A refund lowers my spending; a reimbursement (a friend paying me back) is not income.
 */
import type { Cents } from "./money";

export const TX_KINDS = ["expense", "income", "refund", "transfer", "reimbursement"] as const;
export type TxKind = (typeof TX_KINDS)[number];
export type TransferDirection = "out" | "in";

/** Signed amount stored for a movement typed by the user as a positive magnitude. */
export function signedAmount(kind: TxKind, magnitude: Cents, direction?: TransferDirection): Cents {
  if (!Number.isSafeInteger(magnitude) || magnitude <= 0) {
    throw new RangeError(`amount must be a positive integer number of cents, got ${magnitude}`);
  }
  switch (kind) {
    case "expense":
      return -magnitude;
    case "income":
    case "refund":
    case "reimbursement":
      return magnitude;
    case "transfer":
      if (!direction) throw new RangeError("a transfer needs a direction");
      return direction === "out" ? -magnitude : magnitude;
  }
}

/** Balance = opening balance + every signed movement. Pending claims never touch it. */
export function accountBalance(openingCents: Cents, amounts: readonly Cents[]): Cents {
  return amounts.reduce((sum, a) => sum + a, openingCents);
}

export type FlowTx = { kind: TxKind; amountCents: Cents; categoryId: string | null };

export type FlowSummary = {
  /** Real income only (salary...), never refunds or reimbursements. */
  incomeCents: Cents;
  /** My spending: purchases minus merchant refunds, floored at 0. Positive magnitude. */
  spentCents: Cents;
  /** Money paid back by people (claims). */
  reimbursedCents: Cents;
  /** Net change on my accounts, transfers excluded. */
  netCents: Cents;
};

export function summarizeFlows(rows: readonly FlowTx[]): FlowSummary {
  let incomeCents = 0;
  let purchases = 0;
  let refunds = 0;
  let reimbursedCents = 0;
  for (const r of rows) {
    if (r.kind === "income") incomeCents += r.amountCents;
    else if (r.kind === "expense") purchases += -r.amountCents;
    else if (r.kind === "refund") refunds += r.amountCents;
    else if (r.kind === "reimbursement") reimbursedCents += r.amountCents;
  }
  const spentCents = Math.max(0, purchases - refunds);
  return {
    incomeCents,
    spentCents,
    reimbursedCents,
    netCents: incomeCents - purchases + refunds + reimbursedCents,
  };
}

export const OTHER_CATEGORY = "__other__";
export type CategorySpend = { categoryId: string | null; spentCents: Cents };

/**
 * Spending per category (purchases minus refunds), positive totals only, largest first.
 * With `limit`, entries after the first `limit` are folded into one OTHER_CATEGORY bucket.
 */
export function spendByCategory(rows: readonly FlowTx[], limit?: number): CategorySpend[] {
  const totals = new Map<string | null, number>();
  for (const r of rows) {
    if (r.kind !== "expense" && r.kind !== "refund") continue;
    totals.set(r.categoryId, (totals.get(r.categoryId) ?? 0) - r.amountCents);
  }
  const sorted = [...totals]
    .filter(([, cents]) => cents > 0)
    .map(([categoryId, spentCents]) => ({ categoryId, spentCents }))
    .sort(
      (a, b) =>
        b.spentCents - a.spentCents || (a.categoryId ?? "").localeCompare(b.categoryId ?? ""),
    );
  if (limit === undefined || sorted.length <= limit) return sorted;
  const tail = sorted.slice(limit).reduce((sum, c) => sum + c.spentCents, 0);
  return [...sorted.slice(0, limit), { categoryId: OTHER_CATEGORY, spentCents: tail }];
}
