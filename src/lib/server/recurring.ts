import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as defaultDb, type Db } from "@/lib/db/client";
import {
  accounts,
  categories,
  merchants,
  recurringOccurrences,
  recurringRules,
  transactions,
  type OccurrenceStatus,
} from "@/lib/db/schema";
import { monthBounds, parseMonthKey, shiftMonth } from "@/lib/domain/dates";
import {
  describeRecurrence,
  addDaysIso,
  GENERATION_HORIZON_MONTHS,
  occurrencesBetween,
  periodKey,
  startOfNextPeriod,
  initialNextRunOn,
  planGeneration,
  type RecurrenceSpec,
} from "@/lib/domain/recurrence";
import { computeResteAVivre, type ResteAVivre } from "@/lib/domain/reste-a-vivre";
import type { OccurrenceConfirmInput, RecurringRuleInput } from "@/lib/validation/recurring";
import { listAccountsWithBalance, type AccountWithBalance } from "./accounts";
import { logoInfo, type MerchantLogoInfo } from "./merchants";
import {
  fail,
  isCheckViolation,
  isForeignKeyViolation,
  NOT_FOUND,
  ok,
  type Result,
} from "./result";
import { deleteTransaction, resolveMerchant, type Tx, writeTransaction } from "./transactions";

/**
 * Recurring rules and their occurrences (ADR-024 to 026). Every function takes the session
 * `userId` first and filters on it; composite foreign keys keep rules, occurrences and the
 * transactions they create inside one user's data.
 */

export type RecurringKind = "expense" | "income" | "transfer";

/** Account types counted in the "reste à vivre" (ADR-025). */
export const SPENDABLE_ACCOUNT_TYPES = ["checking", "cash"] as const;

const toAccounts = alias(accounts, "to_account");

const merchantLogoFields = {
  merchantId: merchants.id,
  merchantName: merchants.name,
  merchantNormalizedName: merchants.normalizedName,
  merchantDomain: merchants.domain,
  merchantLogoSource: merchants.logoSource,
  merchantHasUpload: sql<boolean>`${merchants.logoData} is not null`,
  merchantUpdatedAt: merchants.updatedAt,
};

type MerchantLogoRow = {
  merchantId: string | null;
  merchantName: string | null;
  merchantNormalizedName: string | null;
  merchantDomain: string | null;
  merchantLogoSource: string | null;
  merchantHasUpload: boolean | null;
  merchantUpdatedAt: Date | null;
};

function merchantLogo(r: MerchantLogoRow): MerchantLogoInfo | null {
  if (r.merchantNormalizedName === null || r.merchantUpdatedAt === null) return null;
  return logoInfo({
    normalizedName: r.merchantNormalizedName,
    domain: r.merchantDomain,
    logoSource: r.merchantLogoSource,
    hasUpload: !!r.merchantHasUpload,
    updatedAt: r.merchantUpdatedAt,
  });
}

const specOf = (r: {
  frequency: RecurrenceSpec["frequency"];
  interval: number;
  dayOfMonth: number | null;
  startOn: string;
  endOn: string | null;
}): RecurrenceSpec => ({
  frequency: r.frequency,
  interval: r.interval,
  dayOfMonth: r.dayOfMonth,
  startOn: r.startOn,
  endOn: r.endOn,
});

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

export type RecurringRuleRow = {
  id: string;
  kind: RecurringKind;
  label: string;
  amountCents: number;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  categoryName: string | null;
  merchantId: string | null;
  merchantName: string | null;
  merchantLogo: MerchantLogoInfo | null;
  schedule: string;
  startOn: string;
  endOn: string | null;
  /** Next date to generate, null when the rule has ended. */
  nextDueOn: string | null;
};

/** Rules with their next due date: first planned occurrence from `today`, else the cursor. */
export async function listRules(
  userId: string,
  today: string,
  db: Db = defaultDb,
): Promise<RecurringRuleRow[]> {
  const rows = await db
    .select({
      rule: recurringRules,
      nextPlanned: sql<string | null>`(
        select min(o.due_on)::text from ${recurringOccurrences} o
        where o.user_id = ${recurringRules.userId} and o.rule_id = ${recurringRules.id}
          and o.status = 'planned' and o.due_on >= ${today}
      )`,
      accountName: accounts.name,
      toAccountName: toAccounts.name,
      categoryName: categories.name,
      ...merchantLogoFields,
    })
    .from(recurringRules)
    .innerJoin(
      accounts,
      and(eq(accounts.userId, recurringRules.userId), eq(accounts.id, recurringRules.accountId)),
    )
    .leftJoin(
      toAccounts,
      and(
        eq(toAccounts.userId, recurringRules.userId),
        eq(toAccounts.id, recurringRules.toAccountId),
      ),
    )
    .leftJoin(
      categories,
      and(
        eq(categories.userId, recurringRules.userId),
        eq(categories.id, recurringRules.categoryId),
      ),
    )
    .leftJoin(
      merchants,
      and(eq(merchants.userId, recurringRules.userId), eq(merchants.id, recurringRules.merchantId)),
    )
    .where(eq(recurringRules.userId, userId))
    .orderBy(asc(recurringRules.kind), asc(sql`lower(${recurringRules.label})`));

  return rows.map(({ rule, nextPlanned, ...r }) => {
    const ended = rule.endOn !== null && rule.nextRunOn > rule.endOn;
    return {
      id: rule.id,
      kind: rule.kind,
      label: rule.label,
      amountCents: rule.amountCents,
      accountId: rule.accountId,
      accountName: r.accountName,
      toAccountId: rule.toAccountId,
      toAccountName: r.toAccountName,
      categoryName: r.categoryName,
      merchantId: r.merchantId,
      merchantName: r.merchantName,
      merchantLogo: merchantLogo(r),
      schedule: describeRecurrence(specOf(rule)),
      startOn: rule.startOn,
      endOn: rule.endOn,
      nextDueOn: !rule.active ? null : (nextPlanned ?? (ended ? null : rule.nextRunOn)),
    };
  });
}

/** Rule in the form's shape (positive magnitude), or null. */
export async function getRule(userId: string, id: string, db: Db = defaultDb) {
  const [row] = await db
    .select({ rule: recurringRules, merchantName: merchants.name })
    .from(recurringRules)
    .leftJoin(
      merchants,
      and(eq(merchants.userId, recurringRules.userId), eq(merchants.id, recurringRules.merchantId)),
    )
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
  if (!row) return null;
  const { rule } = row;
  return {
    id: rule.id,
    kind: rule.kind,
    label: rule.label,
    amountCents: Math.abs(rule.amountCents),
    merchantName: row.merchantName ?? "",
    accountId: rule.accountId,
    toAccountId: rule.toAccountId,
    categoryId: rule.categoryId,
    frequency: rule.frequency,
    interval: rule.interval,
    dayOfMonth: rule.dayOfMonth,
    startOn: rule.startOn,
    endOn: rule.endOn,
  };
}

async function checkRuleReferences(userId: string, input: RecurringRuleInput, tx: Tx) {
  const accountIds = [input.accountId, input.toAccountId].filter((v): v is string => !!v);
  const owned = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
  if (owned.length !== accountIds.length) return "Compte introuvable.";
  if (input.categoryId) {
    const [cat] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.id, input.categoryId)));
    if (!cat) return "Catégorie introuvable.";
    if (cat.kind !== input.kind) return "Cette catégorie ne correspond pas au type de règle.";
  }
  return null;
}

async function ruleValues(userId: string, input: RecurringRuleInput, tx: Tx) {
  const merchant =
    input.kind === "transfer" ? null : await resolveMerchant(userId, input.merchantName, tx);
  const categoryId =
    input.categoryId ?? (input.kind === "expense" ? (merchant?.defaultCategoryId ?? null) : null);
  return {
    kind: input.kind,
    label: input.label,
    amountCents: input.amountCents,
    accountId: input.accountId,
    toAccountId: input.toAccountId,
    merchantId: merchant?.id ?? null,
    categoryId,
    frequency: input.frequency,
    interval: input.interval,
    dayOfMonth: input.dayOfMonth,
    startOn: input.startOn,
    endOn: input.endOn,
  };
}

function mapRuleError(e: unknown): Result<never> {
  if (isForeignKeyViolation(e)) return fail("Compte, catégorie ou magasin introuvable.");
  if (isCheckViolation(e)) return fail("Règle invalide.");
  throw e;
}

/** Creates a rule; its first occurrence is the first date from today (ADR-024). */
export async function createRule(
  userId: string,
  input: RecurringRuleInput,
  today: string,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  try {
    return await db.transaction(async (tx) => {
      const refError = await checkRuleReferences(userId, input, tx);
      if (refError) return fail(refError);
      const values = await ruleValues(userId, input, tx);
      const [row] = await tx
        .insert(recurringRules)
        .values({ ...values, userId, nextRunOn: initialNextRunOn(specOf(values), today) })
        .returning({ id: recurringRules.id });
      return ok(row!);
    });
  } catch (e) {
    return mapRuleError(e);
  }
}

/**
 * Updates a rule. Future planned occurrences (from today) are regenerated with the new
 * amount and schedule; overdue planned ones take the new amount; validated and skipped ones
 * are kept, and the new schedule starts after the last period they cover (no second
 * occurrence in a month already handled).
 */
export async function updateRule(
  userId: string,
  id: string,
  input: RecurringRuleInput,
  today: string,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ kind: recurringRules.kind })
        .from(recurringRules)
        .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)))
        .for("update");
      if (!current) return fail(NOT_FOUND);
      if ((current.kind === "transfer") !== (input.kind === "transfer")) {
        return fail("Une épargne ne peut pas changer de type : supprimez-la puis recréez-la.");
      }
      const refError = await checkRuleReferences(userId, input, tx);
      if (refError) return fail(refError);
      const values = await ruleValues(userId, input, tx);
      await tx
        .delete(recurringOccurrences)
        .where(
          and(
            eq(recurringOccurrences.userId, userId),
            eq(recurringOccurrences.ruleId, id),
            eq(recurringOccurrences.status, "planned"),
            gte(recurringOccurrences.dueOn, today),
          ),
        );
      // Échéances en retard encore prévues : nouveau montant (et nouveau signe si le type a changé).
      await tx
        .update(recurringOccurrences)
        .set({ amountCents: values.amountCents })
        .where(
          and(
            eq(recurringOccurrences.userId, userId),
            eq(recurringOccurrences.ruleId, id),
            eq(recurringOccurrences.status, "planned"),
          ),
        );
      // Périodes à venir déjà traitées (validées en avance ou ignorées) : pas de seconde
      // échéance dans ces périodes avec le nouveau calendrier.
      const handled = await tx
        .select({ dueOn: recurringOccurrences.dueOn })
        .from(recurringOccurrences)
        .where(
          and(
            eq(recurringOccurrences.userId, userId),
            eq(recurringOccurrences.ruleId, id),
            inArray(recurringOccurrences.status, ["confirmed", "skipped"]),
            gte(recurringOccurrences.dueOn, today),
          ),
        );
      const spec = specOf(values);
      let from = today;
      if (handled.length) {
        const last = handled.reduce((m, h) => (h.dueOn > m ? h.dueOn : m), handled[0]!.dueOn);
        from = startOfNextPeriod(values.frequency, last);
        const done = new Set(handled.map((h) => periodKey(values.frequency, h.dueOn)));
        const dates = occurrencesBetween(spec, today, addDaysIso(from, -1)).filter(
          (d) => !done.has(periodKey(values.frequency, d)),
        );
        if (dates.length) {
          await tx
            .insert(recurringOccurrences)
            .values(
              dates.map((dueOn) => ({
                userId,
                ruleId: id,
                dueOn,
                amountCents: values.amountCents,
              })),
            )
            .onConflictDoNothing();
        }
      }
      await tx
        .update(recurringRules)
        .set({ ...values, nextRunOn: initialNextRunOn(spec, from) })
        .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
      return ok({ id });
    });
  } catch (e) {
    return mapRuleError(e);
  }
}

/** Deletes a rule and its occurrences. Movements already validated stay, unlinked. */
export async function deleteRule(userId: string, id: string, db: Db = defaultDb): Promise<Result> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: recurringRules.id })
      .from(recurringRules)
      .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)))
      .for("update");
    if (!current) return fail(NOT_FOUND);
    await tx
      .update(transactions)
      .set({ recurringRuleId: null })
      .where(and(eq(transactions.userId, userId), eq(transactions.recurringRuleId, id)));
    await tx
      .delete(recurringRules)
      .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
    return ok(undefined);
  });
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

/** Last day of the generation window for a month view (capped GENERATION_HORIZON_MONTHS ahead). */
export function generationLimit(viewedMonthEnd: string, today: string): string {
  const now = parseMonthKey(today.slice(0, 7))!;
  const last = shiftMonth(now.year, now.month, GENERATION_HORIZON_MONTHS);
  const cap = monthBounds(last.year, last.month).to;
  return viewedMonthEnd < cap ? viewedMonthEnd : cap;
}

/**
 * Generates the planned occurrences of every active rule up to `through` (ADR-024).
 * Idempotent: rows are locked, the cursor moves forward and (rule, due date) is unique,
 * so concurrent or repeated calls never create a second occurrence.
 */
export async function generateOccurrences(
  userId: string,
  through: string,
  db: Db = defaultDb,
): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.userId, userId),
          eq(recurringRules.active, true),
          lte(recurringRules.nextRunOn, through),
        ),
      )
      .for("update");
    let created = 0;
    for (const rule of due) {
      const plan = planGeneration(specOf(rule), rule.nextRunOn, through);
      if (plan.dates.length) {
        const rows = await tx
          .insert(recurringOccurrences)
          .values(
            plan.dates.map((dueOn) => ({
              userId,
              ruleId: rule.id,
              dueOn,
              amountCents: rule.amountCents,
              currency: rule.currency,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: recurringOccurrences.id });
        created += rows.length;
      }
      await tx
        .update(recurringRules)
        .set({ nextRunOn: plan.nextRunOn })
        .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, rule.id)));
    }
    return created;
  });
}

/* -------------------------------------------------------------------------- */
/* Occurrences                                                                */
/* -------------------------------------------------------------------------- */

export type OccurrenceRow = {
  id: string;
  ruleId: string;
  dueOn: string;
  status: OccurrenceStatus;
  kind: RecurringKind;
  label: string;
  /** Expected amount (signed like the rule). */
  amountCents: number;
  /** Amount of the validated movement, when confirmed. */
  actualCents: number | null;
  transactionId: string | null;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  merchantId: string | null;
  merchantName: string | null;
  merchantLogo: MerchantLogoInfo | null;
};

export async function listOccurrences(
  userId: string,
  range: { from: string; to: string; status?: OccurrenceStatus },
  db: Db = defaultDb,
): Promise<OccurrenceRow[]> {
  const rows = await db
    .select({
      o: recurringOccurrences,
      kind: recurringRules.kind,
      label: recurringRules.label,
      accountId: recurringRules.accountId,
      accountName: accounts.name,
      toAccountId: recurringRules.toAccountId,
      toAccountName: toAccounts.name,
      actualCents: transactions.amountCents,
      ...merchantLogoFields,
    })
    .from(recurringOccurrences)
    .innerJoin(
      recurringRules,
      and(
        eq(recurringRules.userId, recurringOccurrences.userId),
        eq(recurringRules.id, recurringOccurrences.ruleId),
      ),
    )
    .innerJoin(
      accounts,
      and(eq(accounts.userId, recurringRules.userId), eq(accounts.id, recurringRules.accountId)),
    )
    .leftJoin(
      toAccounts,
      and(
        eq(toAccounts.userId, recurringRules.userId),
        eq(toAccounts.id, recurringRules.toAccountId),
      ),
    )
    .leftJoin(
      merchants,
      and(eq(merchants.userId, recurringRules.userId), eq(merchants.id, recurringRules.merchantId)),
    )
    .leftJoin(
      transactions,
      and(
        eq(transactions.userId, recurringOccurrences.userId),
        eq(transactions.id, recurringOccurrences.transactionId),
      ),
    )
    .where(
      and(
        eq(recurringOccurrences.userId, userId),
        gte(recurringOccurrences.dueOn, range.from),
        lte(recurringOccurrences.dueOn, range.to),
        range.status ? eq(recurringOccurrences.status, range.status) : undefined,
      ),
    )
    .orderBy(asc(recurringOccurrences.dueOn), asc(sql`lower(${recurringRules.label})`));

  return rows.map(({ o, ...r }) => ({
    id: o.id,
    ruleId: o.ruleId,
    dueOn: o.dueOn,
    status: o.status,
    kind: r.kind,
    label: r.label,
    amountCents: o.amountCents,
    actualCents: r.actualCents,
    transactionId: o.transactionId,
    accountId: r.accountId,
    accountName: r.accountName,
    toAccountId: r.toAccountId,
    toAccountName: r.toAccountName,
    merchantId: r.merchantId,
    merchantName: r.merchantName,
    merchantLogo: merchantLogo(r),
  }));
}

/**
 * Validates an occurrence: creates the real movement (amount, date and account as typed)
 * and links it. Works on a planned or skipped occurrence.
 */
export async function confirmOccurrence(
  userId: string,
  id: string,
  input: OccurrenceConfirmInput,
  db: Db = defaultDb,
): Promise<Result<{ transactionId: string }>> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ o: recurringOccurrences, rule: recurringRules, merchantName: merchants.name })
        .from(recurringOccurrences)
        .innerJoin(
          recurringRules,
          and(
            eq(recurringRules.userId, recurringOccurrences.userId),
            eq(recurringRules.id, recurringOccurrences.ruleId),
          ),
        )
        .leftJoin(
          merchants,
          and(
            eq(merchants.userId, recurringRules.userId),
            eq(merchants.id, recurringRules.merchantId),
          ),
        )
        .where(and(eq(recurringOccurrences.userId, userId), eq(recurringOccurrences.id, id)))
        .for("update", { of: recurringOccurrences });
      if (!row) return fail(NOT_FOUND);
      if (row.o.status === "confirmed") return fail("Cette échéance est déjà validée.");
      const { rule } = row;
      if (rule.kind === "transfer" && rule.toAccountId === input.accountId) {
        return fail("Choisissez deux comptes différents.");
      }
      const written = await writeTransaction(
        userId,
        {
          kind: rule.kind,
          amountCents: input.magnitudeCents,
          occurredOn: input.occurredOn,
          label: rule.label,
          merchantName: row.merchantName ?? "",
          accountId: input.accountId,
          toAccountId: rule.kind === "transfer" ? rule.toAccountId : null,
          categoryId: rule.categoryId,
          notes: null,
        },
        tx,
        undefined,
        rule.id,
      );
      if (!written.ok) return written;
      await tx
        .update(recurringOccurrences)
        .set({ status: "confirmed", transactionId: written.data.id })
        .where(and(eq(recurringOccurrences.userId, userId), eq(recurringOccurrences.id, id)));
      return ok({ transactionId: written.data.id });
    });
  } catch (e) {
    // Erreur sur le mouvement créé, pas sur la règle.
    if (isForeignKeyViolation(e)) return fail("Compte, catégorie ou magasin introuvable.");
    if (isCheckViolation(e)) return fail("Mouvement invalide.");
    throw e;
  }
}

/** Marks a planned occurrence as skipped (not expected this time), or back to planned. */
export async function setOccurrenceSkipped(
  userId: string,
  id: string,
  skipped: boolean,
  db: Db = defaultDb,
): Promise<Result> {
  const rows = await db
    .update(recurringOccurrences)
    .set({ status: skipped ? "skipped" : "planned" })
    .where(
      and(
        eq(recurringOccurrences.userId, userId),
        eq(recurringOccurrences.id, id),
        eq(recurringOccurrences.status, skipped ? "planned" : "skipped"),
      ),
    )
    .returning({ id: recurringOccurrences.id });
  return rows[0] ? ok(undefined) : fail("Cette échéance a changé entre-temps : rechargez la page.");
}

/** Cancels a validation: deletes the created movement, the occurrence is planned again. */
export async function unconfirmOccurrence(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  const [row] = await db
    .select({ transactionId: recurringOccurrences.transactionId })
    .from(recurringOccurrences)
    .where(
      and(
        eq(recurringOccurrences.userId, userId),
        eq(recurringOccurrences.id, id),
        eq(recurringOccurrences.status, "confirmed"),
      ),
    );
  if (!row?.transactionId) return fail(NOT_FOUND);
  // deleteTransaction remet l'échéance « prévue » dans la même transaction SQL.
  return deleteTransaction(userId, row.transactionId, db);
}

/* -------------------------------------------------------------------------- */
/* Reste à vivre                                                              */
/* -------------------------------------------------------------------------- */

export type ResteAVivreSummary = ResteAVivre & {
  spendableBalanceCents: number;
  /** Planned occurrences of the month still to validate, by due date. */
  pending: OccurrenceRow[];
};

/**
 * "Reste à vivre" of the current month (ADR-025): balance of the checking and cash accounts,
 * plus every occurrence of the month still planned (overdue ones included: probably already
 * debited at the bank but not recorded yet).
 */
export async function getResteAVivre(
  userId: string,
  today: string,
  db: Db = defaultDb,
  /** Data the page already loaded (avoids querying it twice). */
  preloaded: { accounts?: AccountWithBalance[]; monthOccurrences?: OccurrenceRow[] } = {},
): Promise<ResteAVivreSummary> {
  const month = parseMonthKey(today.slice(0, 7))!;
  const { from, to } = monthBounds(month.year, month.month);
  const [accountRows, pending] = await Promise.all([
    preloaded.accounts ?? listAccountsWithBalance(userId, db),
    preloaded.monthOccurrences
      ? preloaded.monthOccurrences.filter((o) => o.status === "planned")
      : listOccurrences(userId, { from, to, status: "planned" }, db),
  ]);
  const spendable = accountRows.filter((a) =>
    (SPENDABLE_ACCOUNT_TYPES as readonly string[]).includes(a.type),
  );
  const spendableBalanceCents = spendable.reduce((s, a) => s + a.balanceCents, 0);
  const result = computeResteAVivre({
    spendableBalanceCents,
    spendableAccountIds: new Set(spendable.map((a) => a.id)),
    planned: pending.map((o) => ({
      accountId: o.accountId,
      toAccountId: o.kind === "transfer" ? o.toAccountId : null,
      amountCents: o.amountCents,
    })),
    today,
    monthEnd: to,
  });
  return { ...result, spendableBalanceCents, pending };
}
