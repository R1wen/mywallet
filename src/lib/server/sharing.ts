import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Conn, db as defaultDb, type Db } from "@/lib/db/client";
import {
  accounts,
  claimPayments,
  claims,
  merchants,
  people,
  transactionItems,
  transactions,
} from "@/lib/db/schema";
import {
  canCancel,
  canGift,
  canReopen,
  checkPayment,
  claimTotals,
  computeItemClaims,
  computeWholeClaims,
  remainingCents,
  statusAfterPayments,
  type ClaimState,
  type ClaimStatus,
  type ClaimTotals,
  type OpenClaim,
} from "@/lib/domain/claims";
import type { PaymentInput, SharesInput } from "@/lib/validation/sharing";
import { logoInfo, type MerchantLogoInfo } from "./merchants";
export { othersShareSql } from "./shares-sql";
import {
  fail,
  isForeignKeyViolation,
  isUniqueViolation,
  NOT_FOUND,
  ok,
  type Result,
} from "./result";

/**
 * Cost sharing (ADR-032 to 035): people, claims on my expenses and the reimbursements
 * received. Every function takes the session `userId` first and filters on it; composite
 * foreign keys prevent any reference to another user's person, expense or line.
 */

type Tx = Exclude<Conn, Db>;

/** Paid sum of the claim in the current row (`claims` must be in the FROM clause). */
const paidSql = sql<number>`coalesce((
  select sum(p.amount_cents) from claim_payments p
  where p.user_id = ${claims}.user_id and p.claim_id = ${claims}.id), 0)`.mapWith(Number);

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export type PersonOption = { id: string; name: string };

export type PersonSummary = PersonOption &
  ClaimTotals & {
    notes: string | null;
    archived: boolean;
    openClaims: number;
    /** Date of the latest shared expense. */
    lastExpenseOn: string | null;
  };

/** People to pick when sharing (archived ones hidden). */
export async function listPersonOptions(userId: string, db: Db = defaultDb) {
  return db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(eq(people.userId, userId), isNull(people.archivedAt)))
    .orderBy(asc(sql`lower(${people.name})`));
}

/** Every person with what they owe, have paid back and were gifted. */
export async function listPeople(userId: string, db: Db = defaultDb): Promise<PersonSummary[]> {
  const [rows, states] = await Promise.all([
    db
      .select({
        id: people.id,
        name: people.name,
        notes: people.notes,
        archivedAt: people.archivedAt,
      })
      .from(people)
      .where(eq(people.userId, userId))
      .orderBy(asc(sql`lower(${people.name})`)),
    db
      .select({
        personId: claims.personId,
        amountCents: claims.amountCents,
        status: claims.status,
        paidCents: paidSql,
        occurredOn: transactions.occurredOn,
      })
      .from(claims)
      .innerJoin(
        transactions,
        and(eq(transactions.userId, claims.userId), eq(transactions.id, claims.transactionId)),
      )
      .where(eq(claims.userId, userId)),
  ]);
  const byPerson = new Map<string, typeof states>();
  for (const s of states) {
    const list = byPerson.get(s.personId) ?? [];
    list.push(s);
    byPerson.set(s.personId, list);
  }
  return rows.map((p) => {
    const list = byPerson.get(p.id) ?? [];
    return {
      id: p.id,
      name: p.name,
      notes: p.notes,
      archived: p.archivedAt !== null,
      ...claimTotals(list),
      openClaims: list.filter((c) => remainingCents(c) > 0).length,
      lastExpenseOn: list.reduce<string | null>(
        (max, c) => (!max || c.occurredOn > max ? c.occurredOn : max),
        null,
      ),
    };
  });
}

export async function createPerson(
  userId: string,
  input: { name: string; notes: string | null },
  db: Db = defaultDb,
): Promise<Result<PersonOption>> {
  const [same] = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(
      and(
        eq(people.userId, userId),
        isNull(people.archivedAt),
        sql`lower(${people.name}) = lower(${input.name})`,
      ),
    )
    .limit(1);
  // Creating on the fly twice (two tabs, double click) returns the existing person.
  if (same) return ok(same);
  const [row] = await db
    .insert(people)
    .values({ userId, name: input.name, notes: input.notes })
    .returning({ id: people.id, name: people.name });
  return ok(row!);
}

export async function updatePerson(
  userId: string,
  id: string,
  input: { name: string; notes: string | null },
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(people)
    .set({ name: input.name, notes: input.notes })
    .where(and(eq(people.userId, userId), eq(people.id, id)))
    .returning({ id: people.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

export async function setPersonArchived(
  userId: string,
  id: string,
  archived: boolean,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(people)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(people.userId, userId), eq(people.id, id)))
    .returning({ id: people.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/** Deletes a person without any claim; one with history can only be archived. */
export async function deletePerson(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  try {
    const rows = await db
      .delete(people)
      .where(and(eq(people.userId, userId), eq(people.id, id)))
      .returning({ id: people.id });
    return rows.length ? ok(undefined) : fail(NOT_FOUND);
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return fail("Cette personne a un historique de créances : archivez-la plutôt.");
    }
    throw e;
  }
}

/* -------------------------------------------------------------------------- */
/* Person detail                                                               */
/* -------------------------------------------------------------------------- */

export type PersonClaim = ClaimState & {
  id: string;
  remainingCents: number;
  itemLabel: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type PersonExpense = {
  transactionId: string;
  occurredOn: string;
  label: string;
  totalCents: number;
  merchantLogo: MerchantLogoInfo | null;
  merchantName: string | null;
  claims: PersonClaim[];
};

export type PersonPayment = {
  transactionId: string;
  occurredOn: string;
  accountName: string;
  amountCents: number;
  /** Amount of this payment settling each expense. */
  parts: { claimId: string; amountCents: number }[];
};

export type PersonDetail = {
  person: PersonOption & { notes: string | null; archived: boolean };
  totals: ClaimTotals;
  /** Shared expenses, most recent first. */
  expenses: PersonExpense[];
  payments: PersonPayment[];
};

export async function getPersonDetail(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<PersonDetail | null> {
  const [person] = await db
    .select({
      id: people.id,
      name: people.name,
      notes: people.notes,
      archivedAt: people.archivedAt,
    })
    .from(people)
    .where(and(eq(people.userId, userId), eq(people.id, id)));
  if (!person) return null;

  const [rows, paymentRows] = await Promise.all([
    db
      .select({
        id: claims.id,
        amountCents: claims.amountCents,
        status: claims.status,
        paidCents: paidSql,
        resolvedAt: claims.resolvedAt,
        createdAt: claims.createdAt,
        itemLabel: transactionItems.label,
        itemPosition: transactionItems.position,
        transactionId: transactions.id,
        occurredOn: transactions.occurredOn,
        label: transactions.label,
        totalCents: transactions.amountCents,
        merchantId: merchants.id,
        merchantName: merchants.name,
        merchantNormalizedName: merchants.normalizedName,
        merchantDomain: merchants.domain,
        merchantLogoSource: merchants.logoSource,
        merchantHasUpload: sql<boolean>`${merchants.logoData} is not null`,
        merchantUpdatedAt: merchants.updatedAt,
      })
      .from(claims)
      .innerJoin(
        transactions,
        and(eq(transactions.userId, claims.userId), eq(transactions.id, claims.transactionId)),
      )
      .leftJoin(
        transactionItems,
        and(
          eq(transactionItems.userId, claims.userId),
          eq(transactionItems.id, claims.transactionItemId),
        ),
      )
      .leftJoin(
        merchants,
        and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
      )
      .where(and(eq(claims.userId, userId), eq(claims.personId, id)))
      .orderBy(
        sql`${transactions.occurredOn} desc`,
        sql`${transactions.createdAt} desc`,
        asc(sql`coalesce(${transactionItems.position}, -1)`),
      ),
    db
      .select({
        claimId: claimPayments.claimId,
        amountCents: claimPayments.amountCents,
        transactionId: transactions.id,
        occurredOn: transactions.occurredOn,
        totalCents: transactions.amountCents,
        accountName: accounts.name,
      })
      .from(claimPayments)
      .innerJoin(
        claims,
        and(eq(claims.userId, claimPayments.userId), eq(claims.id, claimPayments.claimId)),
      )
      .innerJoin(
        transactions,
        and(
          eq(transactions.userId, claimPayments.userId),
          eq(transactions.id, claimPayments.transactionId),
        ),
      )
      .innerJoin(
        accounts,
        and(eq(accounts.userId, transactions.userId), eq(accounts.id, transactions.accountId)),
      )
      .where(and(eq(claimPayments.userId, userId), eq(claims.personId, id)))
      .orderBy(sql`${transactions.occurredOn} desc`, sql`${transactions.createdAt} desc`),
  ]);

  const expenses: PersonExpense[] = [];
  const byTx = new Map<string, PersonExpense>();
  for (const r of rows) {
    let e = byTx.get(r.transactionId);
    if (!e) {
      e = {
        transactionId: r.transactionId,
        occurredOn: r.occurredOn,
        label: r.label,
        totalCents: -r.totalCents,
        merchantName: r.merchantName,
        merchantLogo:
          r.merchantId && r.merchantNormalizedName && r.merchantUpdatedAt
            ? logoInfo({
                normalizedName: r.merchantNormalizedName,
                domain: r.merchantDomain,
                logoSource: r.merchantLogoSource,
                hasUpload: r.merchantHasUpload,
                updatedAt: r.merchantUpdatedAt,
              })
            : null,
        claims: [],
      };
      byTx.set(r.transactionId, e);
      expenses.push(e);
    }
    const state = { amountCents: r.amountCents, status: r.status, paidCents: r.paidCents };
    e.claims.push({
      id: r.id,
      ...state,
      remainingCents: remainingCents(state),
      itemLabel: r.itemLabel,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
    });
  }

  const payments: PersonPayment[] = [];
  const byPayment = new Map<string, PersonPayment>();
  for (const p of paymentRows) {
    let pay = byPayment.get(p.transactionId);
    if (!pay) {
      pay = {
        transactionId: p.transactionId,
        occurredOn: p.occurredOn,
        accountName: p.accountName,
        amountCents: p.totalCents,
        parts: [],
      };
      byPayment.set(p.transactionId, pay);
      payments.push(pay);
    }
    pay.parts.push({ claimId: p.claimId, amountCents: p.amountCents });
  }

  return {
    person: {
      id: person.id,
      name: person.name,
      notes: person.notes,
      archived: person.archivedAt !== null,
    },
    totals: claimTotals(expenses.flatMap((e) => e.claims)),
    expenses,
    payments,
  };
}

/* -------------------------------------------------------------------------- */
/* Sharing an expense                                                          */
/* -------------------------------------------------------------------------- */

export type ShareState = {
  transaction: { id: string; occurredOn: string; label: string; totalCents: number };
  items: { id: string; label: string; totalCents: number }[];
  claims: (ClaimState & { id: string; personId: string; itemId: string | null })[];
};

export async function getShareState(
  userId: string,
  transactionId: string,
  db: Conn = defaultDb,
): Promise<ShareState | null> {
  const [t] = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      occurredOn: transactions.occurredOn,
      label: transactions.label,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)));
  if (!t || t.kind !== "expense") return null;
  const [items, rows] = await Promise.all([
    db
      .select({
        id: transactionItems.id,
        label: transactionItems.label,
        totalCents: transactionItems.totalCents,
      })
      .from(transactionItems)
      .where(
        and(eq(transactionItems.userId, userId), eq(transactionItems.transactionId, transactionId)),
      )
      .orderBy(asc(transactionItems.position), asc(transactionItems.id)),
    db
      .select({
        id: claims.id,
        personId: claims.personId,
        itemId: claims.transactionItemId,
        amountCents: claims.amountCents,
        status: claims.status,
        paidCents: paidSql,
      })
      .from(claims)
      .where(and(eq(claims.userId, userId), eq(claims.transactionId, transactionId))),
  ]);
  return {
    transaction: {
      id: t.id,
      occurredOn: t.occurredOn,
      label: t.label,
      totalCents: -t.amountCents,
    },
    items,
    claims: rows,
  };
}

const LOCKED_SHARE =
  "Une part déjà remboursée ou offerte ne peut pas changer : annulez d'abord le remboursement ou l'offre.";

/**
 * Replaces the shares of an expense (inside an open DB transaction). Pending parts
 * without payment follow the new split; a reimbursed, partly paid or gifted part must stay
 * as it is; a cancelled part stays in the history unless it is shared again.
 * Every check runs before the first write, so a failure leaves the expense untouched.
 */
export async function writeShares(
  userId: string,
  transactionId: string,
  input: SharesInput,
  tx: Tx,
): Promise<Result<{ claims: number }>> {
  const [t] = await tx
    .select({ kind: transactions.kind, amountCents: transactions.amountCents })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)))
    .for("update");
  if (!t) return fail(NOT_FOUND);
  if (t.kind !== "expense") return fail("Seule une dépense peut être partagée.");

  const items = await tx
    .select({ id: transactionItems.id, totalCents: transactionItems.totalCents })
    .from(transactionItems)
    .where(
      and(eq(transactionItems.userId, userId), eq(transactionItems.transactionId, transactionId)),
    )
    .orderBy(asc(transactionItems.position), asc(transactionItems.id));

  let desired;
  if (items.length) {
    if (input.lines.length !== items.length) {
      return fail("Les lignes du ticket ont changé : rechargez la page.");
    }
    desired = computeItemClaims(
      items.map((it, i) => ({ totalCents: it.totalCents, participants: input.lines[i] ?? [] })),
    ).map((c) => ({ ...c, itemId: items[c.line!]!.id }));
  } else {
    desired = computeWholeClaims(-t.amountCents, input.whole).map((c) => ({
      ...c,
      itemId: null as string | null,
    }));
  }

  const personIds = [...new Set(desired.map((d) => d.personId))];
  if (personIds.length) {
    const found = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, userId), inArray(people.id, personIds)));
    if (found.length !== personIds.length) return fail("Personne introuvable.");
  }

  const existing = await tx
    .select({
      id: claims.id,
      personId: claims.personId,
      itemId: claims.transactionItemId,
      amountCents: claims.amountCents,
      status: claims.status,
      paidCents: paidSql,
    })
    .from(claims)
    .where(and(eq(claims.userId, userId), eq(claims.transactionId, transactionId)))
    .for("update");

  const key = (itemId: string | null, personId: string) => `${itemId ?? ""}|${personId}`;
  const wanted = new Map(desired.map((d) => [key(d.itemId, d.personId), d]));
  const removals: string[] = [];
  const updates: { id: string; amountCents: number; revive: boolean }[] = [];
  for (const c of existing) {
    const k = key(c.itemId, c.personId);
    const d = wanted.get(k);
    wanted.delete(k);
    const locked = c.paidCents > 0 || c.status === "gifted" || c.status === "reimbursed";
    if (locked) {
      if (d?.amountCents !== c.amountCents) return fail(LOCKED_SHARE);
    } else if (c.status === "cancelled") {
      if (d) updates.push({ id: c.id, amountCents: d.amountCents, revive: true });
    } else if (!d) {
      removals.push(c.id);
    } else if (d.amountCents !== c.amountCents) {
      updates.push({ id: c.id, amountCents: d.amountCents, revive: false });
    }
  }

  if (removals.length) {
    await tx.delete(claims).where(and(eq(claims.userId, userId), inArray(claims.id, removals)));
  }
  for (const u of updates) {
    await tx
      .update(claims)
      .set({
        amountCents: u.amountCents,
        ...(u.revive ? { status: "pending" as const, resolvedAt: null } : {}),
      })
      .where(and(eq(claims.userId, userId), eq(claims.id, u.id)));
  }
  if (wanted.size) {
    await tx.insert(claims).values(
      [...wanted.values()].map((d) => ({
        userId,
        personId: d.personId,
        transactionId,
        transactionItemId: d.itemId,
        amountCents: d.amountCents,
      })),
    );
  }
  return ok({ claims: desired.length });
}

export async function saveShares(
  userId: string,
  transactionId: string,
  input: SharesInput,
  db: Db = defaultDb,
): Promise<Result<{ claims: number }>> {
  try {
    return await db.transaction((tx) => writeShares(userId, transactionId, input, tx));
  } catch (e) {
    if (isForeignKeyViolation(e)) return fail("Personne introuvable.");
    if (isUniqueViolation(e)) return fail("Partage modifié en parallèle : rechargez la page.");
    throw e;
  }
}

/* -------------------------------------------------------------------------- */
/* Reimbursements                                                              */
/* -------------------------------------------------------------------------- */

type PaymentWrite = Omit<PaymentInput, "totalCents"> & {
  bankLineKey?: string | null;
  bankLabel?: string | null;
};

/**
 * Records money received from a person (inside an open DB transaction): one
 * `reimbursement` movement on the receiving account, one payment row per claim, and the
 * claims fully paid back become `reimbursed`. Checks run before any write.
 */
export async function writePayment(
  userId: string,
  input: PaymentWrite,
  tx: Tx,
): Promise<Result<{ transactionId: string }>> {
  const [person] = await tx
    .select({ name: people.name })
    .from(people)
    .where(and(eq(people.userId, userId), eq(people.id, input.personId)));
  if (!person) return fail(NOT_FOUND);
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, input.accountId)));
  if (!account) return fail("Compte introuvable.");

  const ids = input.allocations.map((a) => a.claimId);
  const rows = await tx
    .select({
      id: claims.id,
      amountCents: claims.amountCents,
      status: claims.status,
      paidCents: paidSql,
    })
    .from(claims)
    .where(
      and(eq(claims.userId, userId), eq(claims.personId, input.personId), inArray(claims.id, ids)),
    )
    .for("update");
  if (rows.length !== ids.length) return fail("Créance introuvable.");
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of input.allocations) {
    const error = checkPayment(byId.get(a.claimId)!, a.amountCents);
    if (error) return fail(error);
  }

  const total = input.allocations.reduce((s, a) => s + a.amountCents, 0);
  const [movement] = await tx
    .insert(transactions)
    .values({
      userId,
      kind: "reimbursement",
      accountId: input.accountId,
      amountCents: total,
      occurredOn: input.occurredOn,
      label: `Remboursement ${person.name}`.slice(0, 200),
      bankLineKey: input.bankLineKey ?? null,
      bankLabel: input.bankLabel ?? null,
    })
    .returning({ id: transactions.id });
  const transactionId = movement!.id;
  await tx.insert(claimPayments).values(
    input.allocations.map((a) => ({
      userId,
      claimId: a.claimId,
      transactionId,
      amountCents: a.amountCents,
    })),
  );
  const settled = input.allocations
    .filter((a) => {
      const c = byId.get(a.claimId)!;
      return statusAfterPayments(c, c.paidCents + a.amountCents) === "reimbursed";
    })
    .map((a) => a.claimId);
  if (settled.length) {
    await tx
      .update(claims)
      .set({ status: "reimbursed", resolvedAt: new Date() })
      .where(and(eq(claims.userId, userId), inArray(claims.id, settled)));
  }
  return ok({ transactionId });
}

export async function recordPayment(
  userId: string,
  input: PaymentInput,
  db: Db = defaultDb,
): Promise<Result<{ transactionId: string }>> {
  try {
    return await db.transaction((tx) => writePayment(userId, input, tx));
  } catch (e) {
    if (isForeignKeyViolation(e)) return fail("Compte ou créance introuvable.");
    throw e;
  }
}

/**
 * Before deleting reimbursement movements (inside an open DB transaction): the claims
 * they paid go back to pending when they are no longer fully paid. The payment rows
 * cascade with the movement.
 */
export async function releasePayments(userId: string, transactionIds: string[], tx: Tx) {
  if (!transactionIds.length) return;
  const affected = await tx
    .selectDistinct({ claimId: claimPayments.claimId })
    .from(claimPayments)
    .where(
      and(eq(claimPayments.userId, userId), inArray(claimPayments.transactionId, transactionIds)),
    );
  if (!affected.length) return;
  const rows = await tx
    .select({
      id: claims.id,
      amountCents: claims.amountCents,
      status: claims.status,
      remainingPaid: sql<number>`coalesce((
        select sum(p.amount_cents) from claim_payments p
        where p.user_id = ${claims}.user_id and p.claim_id = ${claims}.id
          and p.transaction_id not in (${sql.join(
            transactionIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})), 0)`.mapWith(Number),
    })
    .from(claims)
    .where(
      and(
        eq(claims.userId, userId),
        inArray(
          claims.id,
          affected.map((a) => a.claimId),
        ),
      ),
    )
    .for("update");
  const reopened = rows
    .filter(
      (c) =>
        c.status === "reimbursed" &&
        statusAfterPayments({ ...c, paidCents: c.amountCents }, c.remainingPaid) === "pending",
    )
    .map((c) => c.id);
  if (reopened.length) {
    await tx
      .update(claims)
      .set({ status: "pending", resolvedAt: null })
      .where(and(eq(claims.userId, userId), inArray(claims.id, reopened)));
  }
}

/** Cancels a reimbursement: the movement is deleted and its claims are due again. */
export async function cancelPayment(
  userId: string,
  transactionId: string,
  db: Db = defaultDb,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ kind: transactions.kind })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)))
      .for("update");
    if (!t || t.kind !== "reimbursement") return fail(NOT_FOUND);
    await releasePayments(userId, [transactionId], tx);
    await tx
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, transactionId)));
    return ok(undefined);
  });
}

const ACTION_ERRORS = {
  gift: "Seule une créance en attente avec un reste dû peut être offerte.",
  cancel: "Seule une créance en attente sans remboursement peut être annulée.",
  reopen: "Seule une créance offerte ou annulée peut être rouverte.",
} as const;

/** Gift (forget the debt), cancel (not owed) or reopen (undo a gift or a cancellation). */
export async function applyClaimAction(
  userId: string,
  claimId: string,
  action: "gift" | "cancel" | "reopen",
  db: Db = defaultDb,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        amountCents: claims.amountCents,
        status: claims.status,
        paidCents: paidSql,
      })
      .from(claims)
      .where(and(eq(claims.userId, userId), eq(claims.id, claimId)))
      .for("update");
    if (!c) return fail(NOT_FOUND);
    const allowed =
      action === "gift" ? canGift(c) : action === "cancel" ? canCancel(c) : canReopen(c);
    if (!allowed) return fail(ACTION_ERRORS[action]);
    let status: ClaimStatus;
    if (action === "gift") status = "gifted";
    else if (action === "cancel") status = "cancelled";
    else status = statusAfterPayments({ ...c, status: "pending" }, c.paidCents);
    await tx
      .update(claims)
      .set({ status, resolvedAt: status === "pending" ? null : new Date() })
      .where(and(eq(claims.userId, userId), eq(claims.id, claimId)));
    return ok(undefined);
  });
}

/* -------------------------------------------------------------------------- */
/* Receivables                                                                 */
/* -------------------------------------------------------------------------- */

/** Pending claims with what is left to pay, oldest expense first (bank import). */
export async function listOpenClaims(userId: string, db: Conn = defaultDb): Promise<OpenClaim[]> {
  const rows = await db
    .select({
      id: claims.id,
      personId: claims.personId,
      date: transactions.occurredOn,
      amountCents: claims.amountCents,
      status: claims.status,
      paidCents: paidSql,
    })
    .from(claims)
    .innerJoin(
      transactions,
      and(eq(transactions.userId, claims.userId), eq(transactions.id, claims.transactionId)),
    )
    .where(and(eq(claims.userId, userId), eq(claims.status, "pending")))
    .orderBy(asc(transactions.occurredOn), asc(claims.createdAt), asc(claims.id));
  return rows
    .map((r) => ({
      id: r.id,
      personId: r.personId,
      date: r.date,
      remainingCents: remainingCents(r),
    }))
    .filter((r) => r.remainingCents > 0);
}

/** "À récupérer": total still owed and the people who owe the most. */
export async function getReceivables(userId: string, db: Db = defaultDb, top = 3) {
  const list = await listPeople(userId, db);
  const owing = list
    .filter((p) => p.pendingCents > 0)
    .sort((a, b) => b.pendingCents - a.pendingCents || a.name.localeCompare(b.name));
  return {
    pendingCents: owing.reduce((s, p) => s + p.pendingCents, 0),
    people: owing
      .slice(0, top)
      .map((p) => ({ id: p.id, name: p.name, pendingCents: p.pendingCents })),
  };
}
