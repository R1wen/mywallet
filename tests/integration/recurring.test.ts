/**
 * Sprint 2 on a real PostgreSQL: recurring rules, idempotent generation of occurrences,
 * validation (adjusted amount, savings transfers), skip / undo, "reste à vivre", and
 * isolation: user B can neither see nor change user A's rules and occurrences.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { accounts, recurringOccurrences, recurringRules, transactions } from "@/lib/db/schema";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import { listCategories } from "@/lib/server/categories";
import { provisionUser } from "@/lib/server/provisioning";
import {
  confirmOccurrence,
  createRule,
  deleteRule,
  generateOccurrences,
  generationLimit,
  getResteAVivre,
  getRule,
  listOccurrences,
  listRules,
  setOccurrenceSkipped,
  unconfirmOccurrence,
  updateRule,
} from "@/lib/server/recurring";
import { deleteTransaction, getTransaction, updateTransaction } from "@/lib/server/transactions";
import type { RecurringRuleInput } from "@/lib/validation/recurring";
import { createUsers, deleteUsers } from "./helpers";

const TODAY = "2026-11-16";
const NOV = { from: "2026-11-01", to: "2026-11-30" };

let A = "";
let B = "";
let checking = "";
let savings = "";
let checkingOfB = "";
let incomeCat = "";

function rule(patch: Partial<RecurringRuleInput>): RecurringRuleInput {
  return {
    kind: "expense",
    label: "Loyer",
    amountCents: -89_000,
    merchantName: "Foncia",
    accountId: checking,
    toAccountId: null,
    categoryId: null,
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 5,
    startOn: "2026-01-05",
    endOn: null,
    ...patch,
  };
}

async function create(patch: Partial<RecurringRuleInput>, user = A) {
  const r = await createRule(user, rule(patch), TODAY);
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

const balanceOf = async (user: string, id: string) =>
  (await listAccountsWithBalance(user)).find((a) => a.id === id)!.balanceCents;

let rent = "";
let salary = "";
let saving = "";

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  await provisionUser(A);
  await provisionUser(B);
  checking = (await listAccountsWithBalance(A))[0]!.id;
  checkingOfB = (await listAccountsWithBalance(B))[0]!.id;
  const [s] = await db
    .insert(accounts)
    .values({ userId: A, name: "Livret A", type: "savings", openingBalanceCents: 100_000 })
    .returning();
  savings = s!.id;
  // Solde du compte courant : 1 500,00 €.
  await db.update(accounts).set({ openingBalanceCents: 150_000 }).where(eq(accounts.id, checking));
  const cats = await listCategories(A);
  incomeCat = cats.find((c) => c.kind === "income")!.id;

  rent = await create({});
  salary = await create({
    kind: "income",
    label: "Salaire",
    amountCents: 245_000,
    merchantName: "",
    dayOfMonth: 28,
    categoryId: incomeCat,
  });
  saving = await create({
    kind: "transfer",
    label: "Épargne Livret A",
    amountCents: -20_000,
    merchantName: "",
    toAccountId: savings,
    dayOfMonth: 20,
  });
});

afterAll(() => deleteUsers([A, B]));

describe("rules", () => {
  it("starts from today: past dates of the month are not generated", async () => {
    const rows = await listRules(A);
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get("Loyer")).toMatchObject({
      nextDueOn: "2026-12-05",
      schedule: "Tous les mois, le 5",
      merchantName: "Foncia",
      amountCents: -89_000,
    });
    expect(byLabel.get("Salaire")?.nextDueOn).toBe("2026-11-28");
    expect(byLabel.get("Épargne Livret A")).toMatchObject({
      nextDueOn: "2026-11-20",
      toAccountName: "Livret A",
    });
  });

  it("applies the merchant's default category to a charge", async () => {
    const detail = await getRule(A, rent);
    expect(detail).toMatchObject({ amountCents: 89_000, merchantName: "Foncia" });
    expect(detail?.categoryId).not.toBeNull();
  });

  it("rejects a category of the wrong kind and an account of another user", async () => {
    expect(await createRule(A, rule({ categoryId: incomeCat }), TODAY)).toEqual({
      ok: false,
      error: "Cette catégorie ne correspond pas au type de règle.",
    });
    expect(await createRule(B, rule({ accountId: checking }), TODAY)).toEqual({
      ok: false,
      error: "Compte introuvable.",
    });
  });
});

describe("generation", () => {
  it("creates each occurrence once, even when called again or concurrently", async () => {
    const through = generationLimit(NOV.to, TODAY);
    expect(through).toBe("2026-11-30");
    expect(await generateOccurrences(A, through)).toBe(2); // salaire 28, épargne 20
    expect(await generateOccurrences(A, through)).toBe(0);
    const counts = await Promise.all([1, 2, 3].map(() => generateOccurrences(A, "2026-12-31")));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3); // décembre : loyer, épargne, salaire
    const all = await db
      .select({ ruleId: recurringOccurrences.ruleId, dueOn: recurringOccurrences.dueOn })
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.userId, A));
    expect(all).toHaveLength(5);
    expect(new Set(all.map((o) => `${o.ruleId}:${o.dueOn}`)).size).toBe(5);
  });

  it("caps the generation window twelve months ahead", () => {
    expect(generationLimit("2030-01-31", TODAY)).toBe("2027-11-30");
  });

  it("lists the occurrences of a month with their rule", async () => {
    const rows = await listOccurrences(A, NOV);
    expect(rows.map((o) => [o.dueOn, o.label, o.status, o.amountCents])).toEqual([
      ["2026-11-20", "Épargne Livret A", "planned", -20_000],
      ["2026-11-28", "Salaire", "planned", 245_000],
    ]);
  });
});

describe("reste à vivre", () => {
  it("is the spendable balance minus remaining charges and savings plus expected income", async () => {
    const r = await getResteAVivre(A, TODAY);
    expect(r).toMatchObject({
      spendableBalanceCents: 150_000, // le Livret A n'est pas compté
      plannedChargesCents: -20_000,
      plannedIncomeCents: 245_000,
      resteCents: 375_000,
      daysLeft: 15,
      perDayCents: 25_000,
    });
    expect(r.pending).toHaveLength(2);
  });
});

describe("validation", () => {
  const occurrenceOf = async (ruleId: string, dueOn: string) =>
    (await listOccurrences(A, { from: dueOn, to: dueOn })).find((o) => o.ruleId === ruleId)!;

  it("creates the real movement with the adjusted amount and links it", async () => {
    const o = await occurrenceOf(salary, "2026-11-28");
    const r = await confirmOccurrence(A, o.id, {
      magnitudeCents: 246_012,
      occurredOn: "2026-11-27",
      accountId: checking,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tx = await getTransaction(A, r.data.transactionId);
    expect(tx).toMatchObject({ kind: "income", amountCents: 246_012, occurredOn: "2026-11-27" });
    const [row] = await db
      .select({ ruleId: transactions.recurringRuleId })
      .from(transactions)
      .where(eq(transactions.id, r.data.transactionId));
    expect(row?.ruleId).toBe(salary);
    expect((await occurrenceOf(salary, "2026-11-28")).actualCents).toBe(246_012);

    // Le salaire est dans le solde, plus dans les revenus attendus.
    const rav = await getResteAVivre(A, TODAY);
    expect(rav.spendableBalanceCents).toBe(150_000 + 246_012);
    expect(rav.plannedIncomeCents).toBe(0);
    expect(rav.resteCents).toBe(150_000 + 246_012 - 20_000);

    expect(
      await confirmOccurrence(A, o.id, {
        magnitudeCents: 1,
        occurredOn: TODAY,
        accountId: checking,
      }),
    ).toEqual({ ok: false, error: "Cette échéance est déjà validée." });
  });

  it("validates a saving as a transfer, editable in place", async () => {
    const o = await occurrenceOf(saving, "2026-11-20");
    expect(
      await confirmOccurrence(A, o.id, {
        magnitudeCents: 20_000,
        occurredOn: "2026-11-20",
        accountId: savings,
      }),
    ).toEqual({ ok: false, error: "Choisissez deux comptes différents." });
    const r = await confirmOccurrence(A, o.id, {
      magnitudeCents: 20_000,
      occurredOn: "2026-11-20",
      accountId: checking,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await balanceOf(A, savings)).toBe(120_000);

    // Modifier le virement validé garde le lien avec l'échéance.
    const edited = await updateTransaction(A, r.data.transactionId, {
      kind: "transfer",
      amountCents: 25_000,
      occurredOn: "2026-11-20",
      label: "Épargne Livret A",
      merchantName: "",
      accountId: checking,
      toAccountId: savings,
      categoryId: null,
      notes: null,
    });
    expect(edited.ok).toBe(true);
    expect(await balanceOf(A, savings)).toBe(125_000);
    expect((await occurrenceOf(saving, "2026-11-20")).status).toBe("confirmed");
  });

  it("puts the occurrence back to planned when its movement is deleted", async () => {
    const o = await occurrenceOf(saving, "2026-11-20");
    expect((await deleteTransaction(A, o.transactionId!)).ok).toBe(true);
    const after = await occurrenceOf(saving, "2026-11-20");
    expect(after).toMatchObject({ status: "planned", transactionId: null });
    expect(await balanceOf(A, savings)).toBe(100_000);
  });

  it("cancels a validation", async () => {
    const o = await occurrenceOf(salary, "2026-11-28");
    expect((await unconfirmOccurrence(A, o.id)).ok).toBe(true);
    expect((await occurrenceOf(salary, "2026-11-28")).status).toBe("planned");
    expect(await balanceOf(A, checking)).toBe(150_000);
  });

  it("skips and restores an occurrence; a skipped one leaves the reste à vivre", async () => {
    const o = await occurrenceOf(saving, "2026-11-20");
    expect((await setOccurrenceSkipped(A, o.id, true)).ok).toBe(true);
    expect((await getResteAVivre(A, TODAY)).plannedChargesCents).toBe(0);
    expect((await setOccurrenceSkipped(A, o.id, true)).ok).toBe(false);
    expect((await setOccurrenceSkipped(A, o.id, false)).ok).toBe(true);
    expect((await getResteAVivre(A, TODAY)).plannedChargesCents).toBe(-20_000);
  });
});

describe("rule changes", () => {
  it("regenerates future planned occurrences, keeps validated ones", async () => {
    const dec = await listOccurrences(A, { from: "2026-12-01", to: "2026-12-31" });
    const decSaving = dec.find((o) => o.ruleId === saving)!;
    await confirmOccurrence(A, decSaving.id, {
      magnitudeCents: 20_000,
      occurredOn: "2026-12-20",
      accountId: checking,
    });

    const r = await updateRule(
      A,
      saving,
      rule({
        kind: "transfer",
        label: "Épargne Livret A",
        amountCents: -30_000,
        merchantName: "",
        toAccountId: savings,
        dayOfMonth: 20,
      }),
      TODAY,
    );
    expect(r.ok).toBe(true);
    await generateOccurrences(A, "2027-01-31");
    const rows = (await listOccurrences(A, { from: TODAY, to: "2027-01-31" })).filter(
      (o) => o.ruleId === saving,
    );
    expect(rows.map((o) => [o.dueOn, o.status, o.amountCents])).toEqual([
      ["2026-11-20", "planned", -30_000],
      ["2026-12-20", "confirmed", -20_000],
      ["2027-01-20", "planned", -30_000],
    ]);
  });

  it("refuses to turn a saving into a charge", async () => {
    expect(await updateRule(A, saving, rule({}), TODAY)).toEqual({
      ok: false,
      error: "Une épargne ne peut pas changer de type : supprimez-la puis recréez-la.",
    });
  });

  it("deletes a rule with its occurrences, validated movements stay", async () => {
    const before = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, A), eq(transactions.recurringRuleId, saving)));
    expect(before.length).toBe(2); // deux jambes du virement de décembre
    expect((await deleteRule(A, saving)).ok).toBe(true);
    const left = await db
      .select({ id: transactions.id, ruleId: transactions.recurringRuleId })
      .from(transactions)
      .where(eq(transactions.userId, A));
    expect(left.filter((t) => before.some((b) => b.id === t.id))).toEqual(
      before.map((b) => ({ id: b.id, ruleId: null })),
    );
    const occ = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.ruleId, saving));
    expect(occ).toHaveLength(0);
  });
});

describe("isolation", () => {
  it("user B sees nothing of user A", async () => {
    expect(await listRules(B)).toEqual([]);
    expect(await getRule(B, rent)).toBeNull();
    expect(await listOccurrences(B, { from: "2026-01-01", to: "2027-12-31" })).toEqual([]);
    expect(await generateOccurrences(B, "2027-12-31")).toBe(0);
    expect((await getResteAVivre(B, TODAY)).pending).toEqual([]);
  });

  it("user B cannot change, validate, skip or delete user A's data", async () => {
    const [o] = await listOccurrences(A, {
      from: "2026-12-01",
      to: "2026-12-31",
      status: "planned",
    });
    expect(o).toBeDefined();
    expect(await updateRule(B, rent, rule({ accountId: checkingOfB }), TODAY)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    expect(await deleteRule(B, rent)).toEqual({ ok: false, error: "Élément introuvable." });
    expect(
      await confirmOccurrence(B, o!.id, {
        magnitudeCents: 100,
        occurredOn: TODAY,
        accountId: checkingOfB,
      }),
    ).toEqual({ ok: false, error: "Élément introuvable." });
    expect((await setOccurrenceSkipped(B, o!.id, true)).ok).toBe(false);
    expect(await unconfirmOccurrence(B, o!.id)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    const [still] = await db
      .select({ status: recurringOccurrences.status })
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.id, o!.id));
    expect(still?.status).toBe("planned");
    const [r] = await db
      .select({ accountId: recurringRules.accountId })
      .from(recurringRules)
      .where(eq(recurringRules.id, rent));
    expect(r?.accountId).toBe(checking);
  });

  it("the database refuses an occurrence pointing to another user's rule", async () => {
    await expect(
      db.insert(recurringOccurrences).values({
        userId: B,
        ruleId: rent,
        dueOn: "2027-03-05",
        amountCents: -1,
      }),
    ).rejects.toThrow();
  });
});
