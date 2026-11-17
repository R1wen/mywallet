/**
 * Cost sharing and claims (pure). Financial rules (CLAUDE.md, ADR-032 to 035):
 * - The expense carries the full amount; a claim never changes a balance.
 * - Negative receipt lines (discounts) are spread pro rata over the positive lines, so a
 *   person owes the discounted price of their items (largest remainder, exact sums).
 * - A line shared in equal parts gives the leftover cent to me when I take part: a friend
 *   is never asked one cent too many.
 * - A payment (reimbursement) is capped at what is still due; one payment covering several
 *   claims settles the oldest first.
 * - My real expense = total - others' shares (pending and reimbursed claims: their amount;
 *   gifted: what was paid before the gift; cancelled: 0).
 */
import { allocateProportionally, formatCents, splitEvenly, type Cents } from "./money";
import { formatDateFr } from "./dates";

export const CLAIM_STATUSES = ["pending", "reimbursed", "gifted", "cancelled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Participant id standing for the user, next to person ids. */
export const ME = "me";

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

/* -------------------------------------------------------------------------- */
/* Splitting an expense                                                        */
/* -------------------------------------------------------------------------- */

/** Net amount of each line once negative lines are spread over the positive ones. */
export function netLineAmounts(totals: readonly Cents[]): Cents[] {
  const positive = totals.map((t) => Math.max(t, 0));
  const discount = totals.reduce((s, t) => (t < 0 ? s + t : s), 0);
  if (!positive.some((t) => t > 0)) return totals.map(() => 0);
  const shares = allocateProportionally(discount, positive);
  return positive.map((t, i) => (t > 0 ? t + (shares[i] ?? 0) : 0));
}

export type ShareOf = { participant: string; amountCents: Cents };

/**
 * Splits an amount in equal parts. With me among the participants, people get the rounded
 * down part and I keep the rest; between people only, the largest remainder applies.
 */
export function splitShare(amountCents: Cents, participants: readonly string[]): ShareOf[] {
  if (amountCents < 0) throw new RangeError("amount must not be negative");
  const unique = [...new Set(participants)];
  if (!unique.length) return [{ participant: ME, amountCents }];
  if (!unique.includes(ME)) {
    const parts = splitEvenly(amountCents, unique.length);
    return unique.map((participant, i) => ({ participant, amountCents: parts[i] ?? 0 }));
  }
  const base = Math.floor(amountCents / unique.length);
  const mine = amountCents - base * (unique.length - 1);
  return unique.map((participant) => ({
    participant,
    amountCents: participant === ME ? mine : base,
  }));
}

/** A claim to create: `line` is the index of the receipt line, null for the whole expense. */
export type ClaimShare = { line: number | null; personId: string; amountCents: Cents };

export type ShareLine = { totalCents: Cents; participants: readonly string[] };

/** Claims of a detailed expense, from the participants chosen line by line. */
export function computeItemClaims(lines: readonly ShareLine[]): ClaimShare[] {
  const net = netLineAmounts(lines.map((l) => l.totalCents));
  return lines.flatMap((l, line) => {
    const amount = net[line] ?? 0;
    if (amount <= 0) return [];
    return splitShare(amount, l.participants)
      .filter((s) => s.participant !== ME && s.amountCents > 0)
      .map((s) => ({ line, personId: s.participant, amountCents: s.amountCents }));
  });
}

/** Claims of an expense without lines, split in equal parts. */
export function computeWholeClaims(
  totalCents: Cents,
  participants: readonly string[],
): ClaimShare[] {
  return splitShare(totalCents, participants)
    .filter((s) => s.participant !== ME && s.amountCents > 0)
    .map((s) => ({ line: null, personId: s.participant, amountCents: s.amountCents }));
}

/** VAT of the receipt allocated pro rata to each share (informational). */
export function allocateVat(
  vatCents: Cents,
  shares: readonly ShareOf[],
): { participant: string; vatCents: Cents }[] {
  if (!shares.length) return [];
  const parts = allocateProportionally(
    vatCents,
    shares.map((s) => s.amountCents),
  );
  return shares.map((s, i) => ({ participant: s.participant, vatCents: parts[i] ?? 0 }));
}

/** What remains mine on an expense of `totalCents` (positive) given its claims' shares. */
export function myShareCents(totalCents: Cents, shares: readonly { amountCents: Cents }[]): Cents {
  return totalCents - shares.reduce((s, c) => s + c.amountCents, 0);
}

/* -------------------------------------------------------------------------- */
/* Claim lifecycle                                                             */
/* -------------------------------------------------------------------------- */

export type ClaimState = { amountCents: Cents; status: ClaimStatus; paidCents: Cents };

/** Still to be paid back: only a pending claim has a remainder. */
export function remainingCents(c: ClaimState): Cents {
  return c.status === "pending" ? Math.max(c.amountCents - c.paidCents, 0) : 0;
}

/** Part of the expense that is not mine. */
export function othersShareCents(c: ClaimState): Cents {
  switch (c.status) {
    case "pending":
    case "reimbursed":
      return c.amountCents;
    case "gifted":
      return c.paidCents;
    case "cancelled":
      return 0;
  }
}

/** Status once the paid sum becomes `paidCents` (after a payment or its cancellation). */
export function statusAfterPayments(c: ClaimState, paidCents: Cents): ClaimStatus {
  if (c.status === "gifted" || c.status === "cancelled") return c.status;
  return paidCents >= c.amountCents ? "reimbursed" : "pending";
}

/** Error message when `amountCents` cannot be paid on this claim, else null. */
export function checkPayment(c: ClaimState, amountCents: Cents): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return "Le montant doit être positif.";
  }
  if (c.status !== "pending") return "Seule une créance en attente peut être remboursée.";
  if (amountCents > remainingCents(c)) {
    return `Le montant dépasse le reste dû (${formatCents(remainingCents(c))}).`;
  }
  return null;
}

export const canGift = (c: ClaimState) => c.status === "pending" && remainingCents(c) > 0;
export const canCancel = (c: ClaimState) => c.status === "pending" && c.paidCents === 0;
export const canReopen = (c: ClaimState) => c.status === "gifted" || c.status === "cancelled";

export type ClaimTotals = { pendingCents: Cents; reimbursedCents: Cents; giftedCents: Cents };

export function claimTotals(claims: readonly ClaimState[]): ClaimTotals {
  const totals = { pendingCents: 0, reimbursedCents: 0, giftedCents: 0 };
  for (const c of claims) {
    totals.pendingCents += remainingCents(c);
    totals.reimbursedCents += c.paidCents;
    if (c.status === "gifted") totals.giftedCents += c.amountCents - c.paidCents;
  }
  return totals;
}

/**
 * Splits one payment over claims given oldest first: each is settled in turn, the last
 * one possibly partially. Refuses more than the total still due.
 */
export function allocatePayment(
  claims: readonly { id: string; remainingCents: Cents }[],
  amountCents: Cents,
): Outcome<{ id: string; amountCents: Cents }[]> {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Le montant doit être positif." };
  }
  const due = claims.reduce((s, c) => s + Math.max(c.remainingCents, 0), 0);
  if (amountCents > due) {
    return { ok: false, error: `Le montant dépasse le reste dû (${formatCents(due)}).` };
  }
  const out: { id: string; amountCents: Cents }[] = [];
  let left = amountCents;
  for (const c of claims) {
    if (left === 0) break;
    const part = Math.min(Math.max(c.remainingCents, 0), left);
    if (part > 0) {
      out.push({ id: c.id, amountCents: part });
      left -= part;
    }
  }
  return { ok: true, data: out };
}

/* -------------------------------------------------------------------------- */
/* Reminder message                                                            */
/* -------------------------------------------------------------------------- */

export type ReminderGroup = {
  date: string;
  label: string;
  lines: readonly { label: string | null; remainingCents: Cents }[];
};

const plain = (s: string) => s.replace(/[  ]/g, " ");
const money = (c: Cents) => plain(formatCents(c));

/** Plain-text reminder listing what a person still owes, receipt by receipt. */
export function reminderMessage(personName: string, groups: readonly ReminderGroup[]): string {
  let total = 0;
  const rows = groups.map((g) => {
    const sum = g.lines.reduce((s, l) => s + l.remainingCents, 0);
    total += sum;
    const details = g.lines
      .filter((l) => l.label)
      .map((l) => `${l.label} ${money(l.remainingCents)}`);
    const suffix = details.length ? ` (${details.join(", ")})` : "";
    return `- ${plain(formatDateFr(g.date))}, ${g.label} : ${money(sum)}${suffix}`;
  });
  return [
    `Bonjour ${personName},`,
    "",
    "Voici le récapitulatif de ce qu'il reste à me rembourser :",
    ...rows,
    "",
    `Total : ${money(total)}`,
    "",
    "Merci !",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Bank import: transfers received that pay a claim back                       */
/* -------------------------------------------------------------------------- */

export type OpenClaim = { id: string; personId: string; date: string; remainingCents: Cents };
export type ReimbursementSuggestion = { personId: string; claimId: string | null };

/**
 * For each incoming bank line, the person who probably paid me back: one person must
 * owe exactly that amount on a claim (the oldest such claim is chosen) or in total, for
 * expenses dated on or before the transfer. Ambiguous or outgoing lines get null.
 * Claims used by a suggestion are consumed so two lines never settle the same debt.
 */
export function suggestReimbursements(
  lines: readonly { date: string; amountCents: Cents }[],
  claims: readonly OpenClaim[],
): (ReimbursementSuggestion | null)[] {
  const left = new Map(claims.map((c) => [c.id, c.remainingCents]));
  const ordered = [...claims].sort((a, b) => a.date.localeCompare(b.date));
  return lines.map((line) => {
    if (line.amountCents <= 0) return null;
    const eligible = ordered.filter((c) => c.date <= line.date && (left.get(c.id) ?? 0) > 0);
    const exact = new Map<string, OpenClaim>();
    const totals = new Map<string, Cents>();
    for (const c of eligible) {
      const rest = left.get(c.id) ?? 0;
      if (rest === line.amountCents && !exact.has(c.personId)) exact.set(c.personId, c);
      totals.set(c.personId, (totals.get(c.personId) ?? 0) + rest);
    }
    const people = new Set(exact.keys());
    for (const [person, total] of totals) if (total === line.amountCents) people.add(person);
    if (people.size !== 1) return null;
    const personId = [...people][0]!;
    const match = exact.get(personId);
    if (match) {
      left.set(match.id, 0);
      return { personId, claimId: match.id };
    }
    for (const c of eligible) if (c.personId === personId) left.set(c.id, 0);
    return { personId, claimId: null };
  });
}
