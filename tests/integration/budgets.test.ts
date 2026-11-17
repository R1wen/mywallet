/**
 * Sprint 5 on a real PostgreSQL: envelopes on "ma dépense réelle" (subcategories, receipt
 * lines with their own category, shares), alert thresholds, savings goals, rules learned
 * from corrections and applied to entries, bank imports and receipts, isolation A/B.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { merchants, transactionItems, transactions } from "@/lib/db/schema";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import { commitBankImport } from "@/lib/server/bank-import";
import {
  alertsAfterExpense,
  archiveGoal,
  budgetAlerts,
  contributeToGoal,
  createBudget,
  createGoal,
  deleteBudget,
  listBudgets,
  listGoals,
  updateBudget,
} from "@/lib/server/budgets";
import { listCategories } from "@/lib/server/categories";
import { getMonthDashboard } from "@/lib/server/dashboard";
import { provisionUser } from "@/lib/server/provisioning";
import { confirmReceipt, createReceipt } from "@/lib/server/receipts";
import { deleteRule, listRules, proposeRules, saveRule, setRuleActive } from "@/lib/server/rules";
import { createPerson, saveShares } from "@/lib/server/sharing";
import { createTransaction, updateTransaction } from "@/lib/server/transactions";
import { budgetInputSchema, goalInputSchema } from "@/lib/validation/budgets";
import { receiptReviewSchema, type ReceiptReviewValues } from "@/lib/validation/imports";
import { createUsers, deleteUsers } from "./helpers";

let A = "";
let B = "";
let checking = "";
let checkingOfB = "";
const cat: Record<string, string> = {};
const TODAY = "2026-11-17";
const NOV = { year: 2026, month: 11 };

const budget = (values: Record<string, unknown>) =>
  budgetInputSchema.parse({ categoryId: "", period: "monthly", alertPercent: 80, ...values });

async function expense(cents: number, patch: Record<string, unknown> = {}, user = A) {
  const r = await createTransaction(user, {
    kind: "expense",
    amountCents: cents,
    occurredOn: "2026-11-10",
    label: "Achat",
    merchantName: "",
    accountId: user === A ? checking : checkingOfB,
    toAccountId: null,
    categoryId: null,
    notes: null,
    ...patch,
  });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  await provisionUser(A);
  await provisionUser(B);
  checking = (await listAccountsWithBalance(A))[0]!.id;
  checkingOfB = (await listAccountsWithBalance(B))[0]!.id;
  for (const c of await listCategories(A)) cat[c.name] = c.id;
});

afterAll(() => deleteUsers([A, B]));

describe("envelopes", () => {
  let groceries = "";

  it("counts my real expense of the category and its subcategories", async () => {
    const created = await createBudget(
      A,
      budget({ categoryId: cat["Alimentation"], amount: "100" }),
      TODAY,
    );
    if (!created.ok) throw new Error(created.error);
    groceries = created.data.id;
    await expense(4000, { categoryId: cat["Courses"] });
    await expense(2000, { categoryId: cat["Restaurants"] });
    await expense(9000, { categoryId: cat["Shopping"] });
    const [b] = (await listBudgets(A, TODAY, TODAY)).filter((x) => x.id === groceries);
    expect(b).toMatchObject({
      name: "Alimentation",
      spentCents: 6000,
      status: { percent: 60, remainingCents: 4000, level: "ok" },
    });
    // 17 of 30 days: 56,67 € expected at a steady pace.
    expect(b?.expectedCents).toBe(5667);
  });

  it("refuses a second envelope on the same category and period", async () => {
    expect(
      await createBudget(A, budget({ categoryId: cat["Alimentation"], amount: "50" }), TODAY),
    ).toEqual({ ok: false, error: "Cette catégorie a déjà un budget sur cette période." });
  });

  it("alerts when an expense crosses the threshold, then when it goes over", async () => {
    const warn = await expense(2500, { categoryId: cat["Courses"] });
    expect(await alertsAfterExpense(A, warn.id, TODAY)).toEqual([
      { name: "Alimentation", level: "warning", percent: 85 },
    ]);
    // Already at warning: a small expense does not alert again.
    const small = await expense(100, { categoryId: cat["Courses"] });
    expect(await alertsAfterExpense(A, small.id, TODAY)).toEqual([]);
    const over = await expense(1500, { categoryId: cat["Courses"] });
    expect(await alertsAfterExpense(A, over.id, TODAY)).toEqual([
      { name: "Alimentation", level: "over", percent: 101 },
    ]);
    expect((await budgetAlerts(A, TODAY)).map((b) => b.name)).toEqual(["Alimentation"]);
  });

  it("does not carry over: the next month starts again", async () => {
    const [dec] = await listBudgets(A, "2026-12-05", TODAY);
    expect(dec).toMatchObject({ spentCents: 0, status: { level: "ok" }, expectedCents: null });
  });

  it("covers every expense with a global envelope", async () => {
    const all = await createBudget(A, budget({ amount: "1000", alertPercent: 90 }), TODAY);
    if (!all.ok) throw new Error(all.error);
    const view = (await listBudgets(A, TODAY, TODAY)).find((b) => b.id === all.data.id);
    expect(view).toMatchObject({ name: "Toutes les dépenses", spentCents: 19100 });
    expect(await updateBudget(A, all.data.id, budget({ amount: "150", alertPercent: 90 }))).toEqual(
      {
        ok: true,
        data: undefined,
      },
    );
    expect(
      (await listBudgets(A, TODAY, TODAY)).find((b) => b.id === all.data.id)?.status.level,
    ).toBe("over");
    expect(await deleteBudget(A, all.data.id)).toEqual({ ok: true, data: undefined });
  });

  it("refuses an income category", async () => {
    const income = (await listCategories(A)).find((c) => c.kind === "income")!;
    expect(await createBudget(A, budget({ categoryId: income.id, amount: "10" }), TODAY)).toEqual({
      ok: false,
      error: "Choisissez une catégorie de dépenses.",
    });
  });
});

describe("receipt lines with their own category", () => {
  function review(patch: Partial<ReceiptReviewValues> = {}) {
    return receiptReviewSchema.parse({
      merchantName: "Carrefour",
      occurredOn: "2026-11-12",
      amount: "45,00",
      accountId: checking,
      categoryId: cat["Courses"],
      notes: "",
      items: [
        { label: "PATES", quantity: "1", amount: "30,00", categoryId: "" },
        {
          label: "LESSIVE LIQUIDE 2L",
          quantity: "1",
          amount: "20,00",
          categoryId: cat["Maison et bricolage"],
        },
        { label: "Remises", quantity: "1", amount: "-5,00", categoryId: "" },
      ],
      returnDeadline: "",
      warrantyUntil: "",
      attachToTransactionId: "",
      ...patch,
    } satisfies ReceiptReviewValues);
  }

  let tx = "";

  it("splits the receipt over two envelopes and proposes a keyword rule", async () => {
    const maison = await createBudget(
      A,
      budget({ categoryId: cat["Maison et bricolage"], amount: "50" }),
      TODAY,
    );
    if (!maison.ok) throw new Error(maison.error);
    const before = (await listBudgets(A, TODAY, TODAY)).find((b) => b.name === "Alimentation")!;
    const up = await createReceipt(A, {
      data: new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 7, 0xff, 0xd9,
      ]),
      filename: "t.jpg",
      thumbnail: null,
    });
    if (!up.ok) throw new Error(up.error);
    const r = await confirmReceipt(A, up.data.id, review());
    if (!r.ok) throw new Error(r.error);
    tx = r.data.transactionId;
    expect(r.data.corrections).toEqual([
      { merchantId: null, label: "LESSIVE LIQUIDE 2L", categoryId: cat["Maison et bricolage"] },
    ]);
    const list = await listBudgets(A, TODAY, TODAY);
    // Discount -5 € spread 3 € / 2 €: groceries 27 €, detergent 18 €.
    expect(list.find((b) => b.name === "Alimentation")!.spentCents).toBe(before.spentCents + 2700);
    expect(list.find((b) => b.id === maison.data.id)!.spentCents).toBe(1800);
    const proposals = await proposeRules(A, r.data.corrections);
    expect(proposals).toEqual([
      {
        matchType: "contains",
        pattern: "lessive liquide",
        merchantId: null,
        categoryId: cat["Maison et bricolage"],
        text: "« lessive liquide » dans Maison et bricolage",
      },
    ]);
  });

  it("follows shares: the part a friend owes leaves my envelope", async () => {
    const lea = await createPerson(A, { name: "Léa", notes: null });
    if (!lea.ok) throw new Error(lea.error);
    await saveShares(A, tx, { lines: [[], [lea.data.id], []], whole: [] });
    const maison = (await listBudgets(A, TODAY, TODAY)).find(
      (b) => b.name === "Maison et bricolage",
    )!;
    expect(maison.spentCents).toBe(0);
    const dash = await getMonthDashboard(A, NOV);
    expect(dash.topCategories.find((c) => c.name === "Maison et bricolage")).toBeUndefined();
  });
});

describe("learned rules", () => {
  it("proposes a merchant rule when a category is corrected, then applies it", async () => {
    const first = await expense(3000, { label: "Commande", merchantName: "Amazon" });
    const [row] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.id, first.id));
    const [amazon] = await db
      .select({ defaultCategoryId: merchants.defaultCategoryId })
      .from(merchants)
      .where(and(eq(merchants.userId, A), eq(merchants.name, "Amazon")));
    expect(row?.categoryId).toBe(amazon?.defaultCategoryId); // catalogue default
    const edited = await updateTransaction(A, first.id, {
      kind: "expense",
      amountCents: 3000,
      occurredOn: "2026-11-10",
      label: "Commande",
      merchantName: "Amazon",
      accountId: checking,
      toAccountId: null,
      categoryId: cat["Maison et bricolage"]!,
      notes: null,
    });
    if (!edited.ok) throw new Error(edited.error);
    const [proposal] = await proposeRules(A, [edited.data.correction!]);
    expect(proposal).toMatchObject({
      matchType: "merchant",
      text: "Amazon dans Maison et bricolage",
    });
    const { text: _t, ...rule } = proposal!;
    expect(await saveRule(A, rule)).toMatchObject({ ok: true });
    // Learning the same thing twice updates the rule instead of duplicating it.
    expect(await saveRule(A, rule)).toMatchObject({ ok: true });
    expect((await listRules(A)).filter((r) => r.matchType === "merchant")).toHaveLength(1);

    const next = await expense(1200, { label: "Commande", merchantName: "Amazon" });
    const [applied] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.id, next.id));
    expect(applied?.categoryId).toBe(cat["Maison et bricolage"]);
    // Nothing to propose any more for that merchant.
    expect(
      await proposeRules(A, [
        { merchantId: proposal!.merchantId, label: "x", categoryId: cat["Maison et bricolage"]! },
      ]),
    ).toEqual([]);
  });

  it("applies keyword rules to bank lines and receipt lines; inactive rules are ignored", async () => {
    const saved = await saveRule(A, {
      matchType: "contains",
      pattern: "Navigo",
      merchantId: null,
      categoryId: cat["Transports"] ?? cat["Shopping"]!,
    });
    if (!saved.ok) throw new Error(saved.error);
    const csv = ["Date;Libellé;Montant", "05/11/2026;PRLV NAVIGO ANNUEL;-86,40"].join("\n");
    const mapping = { date: 0, label: 1, amount: 2, debit: null, credit: null };
    await commitBankImport(A, { accountId: checking, csv, mapping, decisions: [] });
    const [line] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.userId, A), eq(transactions.amountCents, -8640)));
    expect(line?.categoryId).toBe(cat["Transports"] ?? cat["Shopping"]);

    expect(await setRuleActive(A, saved.data.id, false)).toEqual({ ok: true, data: undefined });
    await commitBankImport(A, {
      accountId: checking,
      csv: ["Date;Libellé;Montant", "06/11/2026;PRLV NAVIGO MOIS;-8,64"].join("\n"),
      mapping,
      decisions: [],
    });
    const [off] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.userId, A), eq(transactions.amountCents, -864)));
    expect(off?.categoryId).toBeNull();
    expect(await deleteRule(A, saved.data.id)).toEqual({ ok: true, data: undefined });
  });

  it("stores a receipt line's category only when it differs from the receipt's", async () => {
    const lines = await db
      .select({ label: transactionItems.label, categoryId: transactionItems.categoryId })
      .from(transactionItems)
      .where(eq(transactionItems.userId, A))
      .orderBy(transactionItems.position);
    expect(lines.find((l) => l.label === "PATES")?.categoryId).toBeNull();
    expect(lines.find((l) => l.label === "LESSIVE LIQUIDE 2L")?.categoryId).toBe(
      cat["Maison et bricolage"],
    );
  });
});

describe("goals", () => {
  it("tracks a goal by hand, never below zero, and archives it", async () => {
    const g = await createGoal(
      A,
      goalInputSchema.parse({ name: "Japon", target: "3500", targetDate: "2027-09-01" }),
    );
    if (!g.ok) throw new Error(g.error);
    expect(await contributeToGoal(A, g.data.id, 85_000)).toEqual({
      ok: true,
      data: { savedCents: 85_000 },
    });
    expect(await contributeToGoal(A, g.data.id, -90_000)).toEqual({
      ok: false,
      error: "Le montant mis de côté ne peut pas devenir négatif.",
    });
    const [view] = (await listGoals(A, TODAY)).filter((x) => x.id === g.data.id);
    expect(view?.progress).toMatchObject({
      percent: 24,
      monthsLeft: 10,
      monthlyNeededCents: 26_500,
    });
    expect(await archiveGoal(A, g.data.id)).toEqual({ ok: true, data: undefined });
    expect((await listGoals(A, TODAY)).some((x) => x.id === g.data.id)).toBe(false);
  });

  it("follows the balance of a linked account and refuses manual amounts", async () => {
    const g = await createGoal(
      A,
      goalInputSchema.parse({ name: "Précaution", target: "100000", accountId: checking }),
    );
    if (!g.ok) throw new Error(g.error);
    const balance = (await listAccountsWithBalance(A)).find((a) => a.id === checking)!.balanceCents;
    const [view] = (await listGoals(A, TODAY)).filter((x) => x.id === g.data.id);
    expect(view?.savedCents).toBe(Math.max(balance, 0));
    expect(await contributeToGoal(A, g.data.id, 100)).toEqual({
      ok: false,
      error: "Cet objectif suit le solde de son compte.",
    });
  });
});

describe("isolation A/B", () => {
  it("B sees none of A's budgets, goals or rules and cannot change them", async () => {
    expect(await listBudgets(B, TODAY, TODAY)).toEqual([]);
    expect(await listGoals(B, TODAY)).toEqual([]);
    expect(await listRules(B)).toEqual([]);
    const [aBudget] = await listBudgets(A, TODAY, TODAY);
    const [aGoal] = await listGoals(A, TODAY);
    const [aRule] = await listRules(A);
    const notFound = { ok: false, error: "Élément introuvable." };
    expect(await deleteBudget(B, aBudget!.id)).toEqual(notFound);
    expect(await updateBudget(B, aBudget!.id, budget({ amount: "1" }))).toEqual(notFound);
    expect(await archiveGoal(B, aGoal!.id)).toEqual(notFound);
    expect(await contributeToGoal(B, aGoal!.id, 100)).toEqual(notFound);
    expect(await deleteRule(B, aRule!.id)).toEqual(notFound);
    expect(await setRuleActive(B, aRule!.id, false)).toEqual(notFound);
  });

  it("B cannot point a budget, goal or rule to A's category or account", async () => {
    expect(
      await createBudget(B, budget({ categoryId: cat["Courses"], amount: "10" }), TODAY),
    ).toEqual({ ok: false, error: "Catégorie introuvable." });
    expect(
      await createGoal(B, goalInputSchema.parse({ name: "x", target: "10", accountId: checking })),
    ).toEqual({ ok: false, error: "Compte introuvable." });
    expect(
      await saveRule(B, {
        matchType: "contains",
        pattern: "pizza",
        merchantId: null,
        categoryId: cat["Courses"]!,
      }),
    ).toEqual({ ok: false, error: "Catégorie ou magasin introuvable." });
  });

  it("A's rules never categorize B's movements", async () => {
    const t = await expense(1000, { label: "Commande", merchantName: "Amazon" }, B);
    const [row] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.id, t.id));
    const [amazon] = await db
      .select({ defaultCategoryId: merchants.defaultCategoryId })
      .from(merchants)
      .where(and(eq(merchants.userId, B), eq(merchants.name, "Amazon")));
    expect(row?.categoryId).toBe(amazon?.defaultCategoryId);
  });
});
