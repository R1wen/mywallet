/**
 * Sprint 4 on a real PostgreSQL: cost sharing at receipt validation ("Tout est à moi ?"),
 * shares of a whole expense, partial and multi-claim reimbursements, gift, cancel, reopen,
 * cancelling a reimbursement, my real expense in the month figures, guards on shared
 * expenses and isolation: user B can neither see nor touch user A's people and claims.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { claims } from "@/lib/db/schema";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import { commitBankImport, previewBankImport } from "@/lib/server/bank-import";
import { getMonthDashboard } from "@/lib/server/dashboard";
import { provisionUser } from "@/lib/server/provisioning";
import { confirmReceipt, createReceipt } from "@/lib/server/receipts";
import {
  applyClaimAction,
  cancelPayment,
  createPerson,
  deletePerson,
  getPersonDetail,
  getShareState,
  listOpenClaims,
  listPeople,
  recordPayment,
  saveShares,
  setPersonArchived,
} from "@/lib/server/sharing";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from "@/lib/server/transactions";
import { receiptReviewSchema, type ReceiptReviewValues } from "@/lib/validation/imports";
import { paymentInputSchema } from "@/lib/validation/sharing";
import { createUsers, deleteUsers } from "./helpers";

let A = "";
let B = "";
let checking = "";
let checkingOfB = "";
let lea = "";
let karim = "";

const MONTH = { year: 2026, month: 10 };

const jpeg = (seed: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, seed, 0xff, 0xd9]);

const balance = async (user = A, account = checking) =>
  (await listAccountsWithBalance(user)).find((a) => a.id === account)!.balanceCents;

let seed = 1;
async function receiptOf(user: string) {
  const r = await createReceipt(user, {
    data: jpeg(seed++),
    filename: "ticket.jpg",
    thumbnail: null,
  });
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

/** 80 € receipt: pizza 20 €, wine 12 €, groceries 50 €, discount -2 €. */
function review(patch: Partial<ReceiptReviewValues> = {}) {
  return receiptReviewSchema.parse({
    merchantName: "Pizzeria",
    occurredOn: "2026-10-05",
    amount: "80,00",
    accountId: checking,
    categoryId: "",
    notes: "",
    items: [
      { label: "Pizza", quantity: "1", amount: "20,00" },
      { label: "Vin", quantity: "1", amount: "12,00" },
      { label: "Courses", quantity: "1", amount: "50,00" },
      { label: "Remise", quantity: "1", amount: "-2,00" },
    ],
    returnDeadline: "",
    warrantyUntil: "",
    attachToTransactionId: "",
    ...patch,
  } satisfies ReceiptReviewValues);
}

async function expense(user: string, account: string, cents: number, label = "Restaurant") {
  const r = await createTransaction(user, {
    kind: "expense",
    amountCents: cents,
    occurredOn: "2026-10-12",
    label,
    merchantName: label,
    accountId: account,
    toAccountId: null,
    categoryId: null,
    notes: null,
  });
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

const pay = (personId: string, allocations: { claimId: string; amount: string }[], user = A) =>
  recordPayment(
    user,
    paymentInputSchema.parse({
      personId,
      occurredOn: "2026-10-20",
      accountId: user === A ? checking : checkingOfB,
      allocations,
    }),
  );

const claimsOf = async (transactionId: string) =>
  db
    .select({
      id: claims.id,
      personId: claims.personId,
      amountCents: claims.amountCents,
      status: claims.status,
    })
    .from(claims)
    .where(and(eq(claims.userId, A), eq(claims.transactionId, transactionId)))
    // Léa first between equal amounts, so tests can destructure.
    .orderBy(claims.amountCents, sql`${claims.personId} = ${lea} desc`);

const spent = async () => (await getMonthDashboard(A, MONTH)).flows;

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  await provisionUser(A);
  await provisionUser(B);
  checking = (await listAccountsWithBalance(A))[0]!.id;
  checkingOfB = (await listAccountsWithBalance(B))[0]!.id;
  const l = await createPerson(A, { name: "Léa", notes: null });
  const k = await createPerson(A, { name: "Karim", notes: "Collègue" });
  if (!l.ok || !k.ok) throw new Error("people");
  lea = l.data.id;
  karim = k.data.id;
});

afterAll(() => deleteUsers([A, B]));

describe("people", () => {
  it("returns the existing person when the same name is created again", async () => {
    const again = await createPerson(A, { name: "léa", notes: null });
    expect(again).toEqual({ ok: true, data: { id: lea, name: "Léa" } });
  });

  it("archives a person and deletes one without history", async () => {
    const tmp = await createPerson(A, { name: "Temporaire", notes: null });
    if (!tmp.ok) throw new Error(tmp.error);
    expect(await setPersonArchived(A, tmp.data.id, true)).toEqual({ ok: true, data: undefined });
    expect((await listPeople(A)).find((p) => p.id === tmp.data.id)?.archived).toBe(true);
    expect(await deletePerson(A, tmp.data.id)).toEqual({ ok: true, data: undefined });
  });
});

describe("receipt validated with shares", () => {
  let tx = "";

  it("debits the full receipt and creates one pending claim per shared line", async () => {
    const before = await balance();
    const id = await receiptOf(A);
    const r = await confirmReceipt(
      A,
      id,
      review({
        shares: { lines: [[lea], ["me", lea, karim], [], []], whole: [] },
      }),
    );
    if (!r.ok) throw new Error(r.error);
    tx = r.data.transactionId;
    // Rule 1: the balance reflects the real movement, 80 €.
    expect(await balance()).toBe(before - 8000);
    // Discount 2 € spread pro rata: pizza 19,51 €, wine 11,71 € (Léa and Karim 3,90 €).
    const rows = await claimsOf(tx);
    expect(rows.map((c) => [c.personId, c.amountCents, c.status])).toEqual([
      [lea, 390, "pending"],
      [karim, 390, "pending"],
      [lea, 1951, "pending"],
    ]);
  });

  it("counts only my real expense in the month and the rest as receivable", async () => {
    const flows = await spent();
    expect(flows.sharedCents).toBe(2731);
    expect(flows.spentCents).toBe(8000 - 2731);
    const dash = await getMonthDashboard(A, MONTH);
    expect(dash.receivables.pendingCents).toBe(2731);
    expect(dash.receivables.people[0]).toMatchObject({ id: lea, pendingCents: 2341 });
    const list = await listTransactions(A, { tri: "date", ordre: "desc", page: 1 });
    expect(list.rows.find((r) => r.id === tx)?.sharedCents).toBe(2731);
  });

  it("rolls the whole validation back when a share is invalid", async () => {
    const before = await balance();
    const id = await receiptOf(A);
    const r = await confirmReceipt(
      A,
      id,
      review({
        shares: { lines: [["0190a7c4-0000-7000-8000-00000000dead"], [], [], []], whole: [] },
      }),
    );
    expect(r).toEqual({ ok: false, error: "Personne introuvable." });
    expect(await balance()).toBe(before);
  });

  it("reimburses partially, then fully, without income", async () => {
    const [, , pizza] = await claimsOf(tx);
    const before = await balance();
    const income = (await spent()).incomeCents;

    const part = await pay(lea, [{ claimId: pizza!.id, amount: "10" }]);
    if (!part.ok) throw new Error(part.error);
    expect(await balance()).toBe(before + 1000);
    expect((await spent()).incomeCents).toBe(income); // rule 3: not income
    expect((await claimsOf(tx))[2]?.status).toBe("pending");

    const over = await pay(lea, [{ claimId: pizza!.id, amount: "9,52" }]);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error.replace(/\s/g, " ")).toBe(
      "Le montant dépasse le reste dû (9,51 €).",
    );
    const rest = await pay(lea, [{ claimId: pizza!.id, amount: "9,51" }]);
    if (!rest.ok) throw new Error(rest.error);
    expect((await claimsOf(tx))[2]?.status).toBe("reimbursed");
    expect(await balance()).toBe(before + 1951);
    // Reimbursed parts stay outside my expense.
    expect((await spent()).spentCents).toBe(8000 - 2731);
  });

  it("refuses to pay a claim of another person in the same payment", async () => {
    const [, karimWine] = await claimsOf(tx);
    expect(await pay(lea, [{ claimId: karimWine!.id, amount: "1" }])).toEqual({
      ok: false,
      error: "Créance introuvable.",
    });
  });

  it("cancelling a reimbursement makes the claim due again", async () => {
    const detail = await getPersonDetail(A, lea);
    const last = detail!.payments[0]!;
    const before = await balance();
    expect(await cancelPayment(A, last.transactionId)).toEqual({ ok: true, data: undefined });
    expect(await balance()).toBe(before - last.amountCents);
    const pizza = (await claimsOf(tx))[2]!;
    expect(pizza.status).toBe("pending");
    const after = await getPersonDetail(A, lea);
    expect(after!.totals.pendingCents).toBe(390 + 951);
  });

  it("deleting a reimbursement movement does the same", async () => {
    const pizza = (await claimsOf(tx))[2]!;
    const r = await pay(lea, [{ claimId: pizza.id, amount: "9,51" }]);
    if (!r.ok) throw new Error(r.error);
    expect((await claimsOf(tx))[2]?.status).toBe("reimbursed");
    expect(await deleteTransaction(A, r.data.transactionId)).toEqual({ ok: true, data: undefined });
    expect((await claimsOf(tx))[2]?.status).toBe("pending");
  });

  it("gifts a claim: my expense grows, nothing comes back; reopen undoes it", async () => {
    const [, karimWine] = await claimsOf(tx);
    const before = (await spent()).spentCents;
    expect(await applyClaimAction(A, karimWine!.id, "gift")).toEqual({ ok: true, data: undefined });
    expect((await spent()).spentCents).toBe(before + 390);
    expect(await pay(karim, [{ claimId: karimWine!.id, amount: "1" }])).toEqual({
      ok: false,
      error: "Seule une créance en attente peut être remboursée.",
    });
    expect(await applyClaimAction(A, karimWine!.id, "cancel")).toMatchObject({ ok: false });
    expect(await applyClaimAction(A, karimWine!.id, "reopen")).toEqual({
      ok: true,
      data: undefined,
    });
    expect((await spent()).spentCents).toBe(before);
  });

  it("gifting after a partial payment makes only the rest mine", async () => {
    const pizza = (await claimsOf(tx))[2]!;
    const before = (await spent()).spentCents;
    const p = await pay(lea, [{ claimId: pizza.id, amount: "5" }]);
    if (!p.ok) throw new Error(p.error);
    expect(await applyClaimAction(A, pizza.id, "gift")).toEqual({ ok: true, data: undefined });
    // 10 € (earlier) + 5 € paid on 19,51 €: only the 4,51 € left become mine.
    expect((await spent()).spentCents).toBe(before + 451);
    const detail = await getPersonDetail(A, lea);
    expect(detail!.totals.giftedCents).toBe(451);
    expect(detail!.totals.pendingCents).toBe(390);
    // Cancelling the payment keeps the gift: what it paid becomes mine too.
    expect(await cancelPayment(A, p.data.transactionId)).toEqual({ ok: true, data: undefined });
    expect((await claimsOf(tx))[2]?.status).toBe("gifted");
    expect((await spent()).spentCents).toBe(before + 951);
    expect(await applyClaimAction(A, pizza.id, "reopen")).toEqual({ ok: true, data: undefined });
    expect((await claimsOf(tx))[2]?.status).toBe("pending");
  });

  it("cancels an unpaid claim (kept in history) and refuses a paid one", async () => {
    const [leaWine, , pizza] = await claimsOf(tx);
    expect(await applyClaimAction(A, leaWine!.id, "cancel")).toEqual({
      ok: true,
      data: undefined,
    });
    expect((await claimsOf(tx)).find((c) => c.id === leaWine!.id)?.status).toBe("cancelled");
    const p = await pay(lea, [{ claimId: pizza!.id, amount: "1" }]);
    if (!p.ok) throw new Error(p.error);
    expect(await applyClaimAction(A, pizza!.id, "cancel")).toEqual({
      ok: false,
      error: "Seule une créance en attente sans remboursement peut être annulée.",
    });
    await cancelPayment(A, p.data.transactionId);
  });

  it("re-shares: pending parts follow, a cancelled part comes back, a paid part is locked", async () => {
    const state = await getShareState(A, tx);
    expect(state?.items).toHaveLength(4);
    // Wine now shared by Léa and Karim only, pizza unchanged.
    const r = await saveShares(A, tx, { lines: [[lea], [lea, karim], [], []], whole: [] });
    expect(r).toEqual({ ok: true, data: { claims: 3 } });
    const rows = await claimsOf(tx);
    expect(rows.map((c) => [c.personId, c.amountCents, c.status])).toEqual([
      [karim, 585, "pending"],
      [lea, 586, "pending"],
      [lea, 1951, "pending"],
    ]);
    const pizza = rows[2]!;
    const p = await pay(lea, [{ claimId: pizza.id, amount: "1" }]);
    if (!p.ok) throw new Error(p.error);
    expect(await saveShares(A, tx, { lines: [[], [lea, karim], [], []], whole: [] })).toMatchObject(
      { ok: false },
    );
    await cancelPayment(A, p.data.transactionId);
  });

  it("guards the shared expense: no deletion with payments, no amount under the shares", async () => {
    const pizza = (await claimsOf(tx))[2]!;
    const p = await pay(lea, [{ claimId: pizza.id, amount: "2" }]);
    if (!p.ok) throw new Error(p.error);
    expect(await deleteTransaction(A, tx)).toEqual({
      ok: false,
      error: "Ce mouvement est lié à un remboursement reçu : annulez d'abord ce remboursement.",
    });
    await cancelPayment(A, p.data.transactionId);
    const input = {
      kind: "expense" as const,
      amountCents: 1000,
      occurredOn: "2026-10-05",
      label: "Pizzeria",
      merchantName: "Pizzeria",
      accountId: checking,
      toAccountId: null,
      categoryId: null,
      notes: null,
    };
    const under = await updateTransaction(A, tx, input);
    expect(!under.ok && under.error.replace(/\s/g, " ")).toBe(
      "Le montant ne peut pas être inférieur aux parts dues par d'autres (31,22 €).",
    );
    expect(await updateTransaction(A, tx, { ...input, kind: "income" })).toMatchObject({
      ok: false,
    });
  });
});

describe("whole expense and multi-claim payment", () => {
  let restaurant = "";

  it("splits an expense without lines in equal parts, I keep the leftover cent", async () => {
    restaurant = await expense(A, checking, 10000);
    expect(await saveShares(A, restaurant, { lines: [], whole: ["me", lea, karim] })).toEqual({
      ok: true,
      data: { claims: 2 },
    });
    expect((await claimsOf(restaurant)).map((c) => c.amountCents)).toEqual([3333, 3333]);
  });

  it("allocates one transfer over several claims", async () => {
    const open = (await listOpenClaims(A)).filter((c) => c.personId === lea);
    expect(open.length).toBeGreaterThanOrEqual(2);
    const due = open.reduce((s, c) => s + c.remainingCents, 0);
    const r = await pay(
      lea,
      open.map((c) => ({
        claimId: c.id,
        amount: String(c.remainingCents / 100).replace(".", ","),
      })),
    );
    if (!r.ok) throw new Error(r.error);
    const detail = await getPersonDetail(A, lea);
    expect(detail!.totals.pendingCents).toBe(0);
    expect(detail!.payments[0]).toMatchObject({ amountCents: due });
    expect(detail!.payments[0]!.parts).toHaveLength(open.length);
  });

  it("a fully shared receipt leaves me no expense", async () => {
    const id = await receiptOf(A);
    const before = (await spent()).spentCents;
    const r = await confirmReceipt(
      A,
      id,
      review({ shares: { lines: [[lea], [karim], [lea], [lea]], whole: [] } }),
    );
    if (!r.ok) throw new Error(r.error);
    const rows = await claimsOf(r.data.transactionId);
    expect(rows.reduce((s, c) => s + c.amountCents, 0)).toBe(8000);
    expect((await spent()).spentCents).toBe(before);
  });

  it("a person with claims cannot be deleted, only archived", async () => {
    expect(await deletePerson(A, karim)).toEqual({
      ok: false,
      error: "Cette personne a un historique de créances : archivez-la plutôt.",
    });
  });
});

describe("bank import of a transfer paying a claim back", () => {
  let sophie = "";
  let dinner = "";
  const csv = (...lines: string[]) => ["Date;Libellé;Montant", ...lines].join("\n");
  const mapping = { date: 0, label: 1, amount: 2, debit: null, credit: null };

  beforeAll(async () => {
    const s = await createPerson(A, { name: "Sophie", notes: null });
    if (!s.ok) throw new Error(s.error);
    sophie = s.data.id;
    dinner = await expense(A, checking, 5000, "Dîner");
    await saveShares(A, dinner, { lines: [], whole: ["me", sophie] });
  });

  it("proposes the reimbursement and records it with the bank line", async () => {
    const file = csv("21/10/2026;VIR SEPA SOPHIE MARTIN;25,00", "22/10/2026;VIR SALAIRE;2100,00");
    const preview = await previewBankImport(A, { accountId: checking, csv: file, mapping: null });
    if (!preview.ok) throw new Error(preview.error);
    const [transfer, salary] = preview.data.lines;
    expect(transfer?.reimbursement).toMatchObject({ personId: sophie });
    expect(salary?.reimbursement).toBeNull();
    expect(preview.data.debtors.map((d) => d.name)).toContain("Sophie");

    const before = await spent();
    const r = await commitBankImport(A, { accountId: checking, csv: file, mapping, decisions: [] });
    expect(r).toEqual({ ok: true, data: { created: 1, linked: 0, skipped: 0, reimbursed: 1 } });
    const [claim] = await claimsOf(dinner);
    expect(claim?.status).toBe("reimbursed");
    // The transfer is not income; the salary is.
    expect((await spent()).incomeCents).toBe(before.incomeCents + 210000);

    // Re-importing the same statement adds nothing.
    const again = await commitBankImport(A, {
      accountId: checking,
      csv: file,
      mapping,
      decisions: [],
    });
    expect(again).toEqual({ ok: true, data: { created: 0, linked: 0, skipped: 2, reimbursed: 0 } });
  });

  it("lets the user pick the person (oldest claims first) and refuses more than owed", async () => {
    const due = (await getPersonDetail(A, karim))!.totals.pendingCents;
    const file = csv("23/10/2026;VIR K BENALI;7,00");
    const r = await commitBankImport(A, {
      accountId: checking,
      csv: file,
      mapping,
      decisions: [{ row: 2, action: "reimburse", personId: karim }],
    });
    expect(r).toMatchObject({ ok: true, data: { reimbursed: 1 } });
    expect((await getPersonDetail(A, karim))!.totals.pendingCents).toBe(due - 700);

    const before = await balance();
    const tooMuch = csv("24/10/2026;VIR K BENALI;999,00", "24/10/2026;CB CAFE;-3,00");
    const refused = await commitBankImport(A, {
      accountId: checking,
      csv: tooMuch,
      mapping,
      decisions: [{ row: 2, action: "reimburse", personId: karim }],
    });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/^Ligne 2 : Le montant dépasse le reste dû/);
    // Nothing of the file was written.
    expect(await balance()).toBe(before);
  });
});

describe("isolation A/B", () => {
  it("B sees none of A's people, claims or shares", async () => {
    expect(await listPeople(B)).toEqual([]);
    expect(await getPersonDetail(B, lea)).toBeNull();
    expect(await listOpenClaims(B)).toEqual([]);
    const anyA = await db
      .select({ t: claims.transactionId })
      .from(claims)
      .where(eq(claims.userId, A));
    expect(await getShareState(B, anyA[0]!.t)).toBeNull();
  });

  it("B cannot share A's expense, nor use A's person on its own expense", async () => {
    const anyA = await db
      .select({ t: claims.transactionId })
      .from(claims)
      .where(eq(claims.userId, A));
    expect(await saveShares(B, anyA[0]!.t, { lines: [], whole: [lea] })).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    const own = await expense(B, checkingOfB, 2000);
    expect(await saveShares(B, own, { lines: [], whole: [lea] })).toEqual({
      ok: false,
      error: "Personne introuvable.",
    });
  });

  it("B cannot pay, gift, cancel or delete A's claims, payments and people", async () => {
    const [open] = await listOpenClaims(A);
    expect(await pay(lea, [{ claimId: open!.id, amount: "1" }], B)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    for (const action of ["gift", "cancel", "reopen"] as const) {
      expect(await applyClaimAction(B, open!.id, action)).toEqual({
        ok: false,
        error: "Élément introuvable.",
      });
    }
    const payment = (await getPersonDetail(A, lea))!.payments[0]!;
    expect(await cancelPayment(B, payment.transactionId)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    expect(await deletePerson(B, lea)).toEqual({ ok: false, error: "Élément introuvable." });
    expect(await setPersonArchived(B, lea, true)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    expect((await getPersonDetail(A, lea))!.person.archived).toBe(false);
  });
});
