/**
 * Sprint 8 on a real PostgreSQL: account deletion with a delay (password checked, signed
 * out everywhere, cancelled by signing in again, purge of due accounts only), full data
 * export (my rows only, no secret, no binary) and transaction export with my share.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { accountDeletions, session, user } from "@/lib/db/schema";
import { cancelDeletion, purgeDueAccounts, requestDeletion } from "@/lib/server/account";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import {
  EXPORT_TABLES,
  exportProfile,
  exportTablePage,
  exportTransactions,
} from "@/lib/server/export";
import { createPerson, saveShares } from "@/lib/server/sharing";
import { createTransaction } from "@/lib/server/transactions";
import { parseTransactionFilters } from "@/lib/validation/transaction";
import { createUsers, deleteUsers } from "./helpers";

const password = "mot-de-passe-tres-sur-42";
const emails: string[] = [];

async function signUp(): Promise<string> {
  const email = `account-${randomUUID()}@test.local`;
  emails.push(email);
  await auth.api.signUpEmail({ body: { name: "Camille", email, password } });
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return u!.id;
}

let A = "";
let B = "";

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
});

afterAll(async () => {
  await deleteUsers([A, B]);
  for (const email of emails) await db.delete(user).where(eq(user.email, email));
});

describe("account deletion with a delay", () => {
  it("refuses a wrong password", async () => {
    const id = await signUp();
    expect(await requestDeletion(id, "pas-le-bon-mot-de-passe")).toEqual({
      ok: false,
      error: "Mot de passe incorrect.",
    });
  });

  it("schedules the purge 7 days later and signs out everywhere", async () => {
    const id = await signUp();
    expect((await db.select().from(session).where(eq(session.userId, id))).length).toBe(1);
    const now = new Date("2026-11-17T10:00:00Z");
    const r = await requestDeletion(id, password, now);
    expect(r).toEqual({ ok: true, data: { purgeAfter: new Date("2026-11-24T10:00:00Z") } });
    expect(await db.select().from(session).where(eq(session.userId, id))).toEqual([]);
  });

  it("is cancelled by signing in again", async () => {
    const id = await signUp();
    await requestDeletion(id, password);
    const email = emails[emails.length - 1]!;
    await auth.api.signInEmail({ body: { email, password } });
    expect(await db.select().from(accountDeletions).where(eq(accountDeletions.userId, id))).toEqual(
      [],
    );
    expect(await cancelDeletion(id)).toBe(false);
  });

  it("purges only the accounts whose delay is over, with all their data", async () => {
    const due = await signUp();
    const later = await signUp();
    await requestDeletion(due, password, new Date("2026-11-01T00:00:00Z"));
    await requestDeletion(later, password, new Date("2026-11-20T00:00:00Z"));
    expect(await purgeDueAccounts(new Date("2026-11-17T00:00:00Z"))).toBe(1);
    expect(await db.select().from(user).where(eq(user.id, due))).toEqual([]);
    expect(await listAccountsWithBalance(due)).toEqual([]);
    expect((await db.select().from(user).where(eq(user.id, later))).length).toBe(1);
  });
});

describe("deletion safeguards", () => {
  it("limits password attempts", async () => {
    const id = await signUp();
    const now = new Date("2026-11-17T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      expect(await requestDeletion(id, "mauvais", now)).toEqual({
        ok: false,
        error: "Mot de passe incorrect.",
      });
    }
    // Even the right password waits until the window is over.
    expect(await requestDeletion(id, password, now)).toEqual({
      ok: false,
      error: "Trop d'essais. Réessayez dans 10 minutes.",
    });
    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect((await requestDeletion(id, password, later)).ok).toBe(true);
  });

  it("never purges an account signed in again after the request", async () => {
    // Simulates a failed cancellation: the deletion row stays, but a newer session exists.
    const { db: database } = await import("@/lib/db/client");
    const { accountDeletions: deletions } = await import("@/lib/db/schema");
    const users = await createUsers(1);
    const id = users[0]!;
    await database.insert(deletions).values({
      userId: id,
      requestedAt: new Date("2026-11-01T00:00:00Z"),
      purgeAfter: new Date("2026-11-08T00:00:00Z"),
    });
    await database.insert(session).values({
      id: randomUUID(),
      userId: id,
      token: randomUUID(),
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      createdAt: new Date("2026-11-03T00:00:00Z"),
      updatedAt: new Date("2026-11-03T00:00:00Z"),
    });
    await purgeDueAccounts(new Date("2026-11-17T00:00:00Z"));
    expect((await database.select().from(user).where(eq(user.id, id))).length).toBe(1);
    await deleteUsers(users);
  });
});

describe("exports", () => {
  let checking = "";

  beforeAll(async () => {
    const { provisionUser } = await import("@/lib/server/provisioning");
    await provisionUser(A);
    await provisionUser(B);
    checking = (await listAccountsWithBalance(A))[0]!.id;
    const t = await createTransaction(A, {
      kind: "expense",
      amountCents: 8000,
      occurredOn: "2026-11-10",
      label: "=Restaurant",
      merchantName: "Restaurant du port",
      accountId: checking,
      toAccountId: null,
      categoryId: null,
      notes: null,
    });
    if (!t.ok) throw new Error(t.error);
    const lea = await createPerson(A, { name: "Léa", notes: null });
    if (!lea.ok) throw new Error(lea.error);
    await saveShares(A, t.data.id, { lines: [], whole: ["me", lea.data.id] });
  });

  it("exports every table with my rows only and no binary column", async () => {
    for (const name of Object.keys(EXPORT_TABLES) as (keyof typeof EXPORT_TABLES)[]) {
      const page = await exportTablePage(A, name, 0);
      for (const row of page.rows) expect(row.userId).toBe(A);
    }
    const merchants = await exportTablePage(A, "magasins", 0);
    expect(merchants.rows.length).toBeGreaterThan(10);
    expect(merchants.rows[0]).not.toHaveProperty("logoData");
    expect((await exportTablePage(B, "transactions", 0)).rows).toEqual([]);
  });

  it("exports the profile without any authentication secret", async () => {
    const profile = await exportProfile(A);
    expect(Object.keys(profile!).sort()).toEqual(["createdAt", "email", "id", "name"]);
  });

  it("exports the filtered movements with my share", async () => {
    const rows = await exportTransactions(A, parseTransactionFilters({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-11-10",
      type: "Dépense",
      label: "=Restaurant",
      amountCents: -8000,
      myShareCents: -4000,
    });
    expect(await exportTransactions(B, parseTransactionFilters({}))).toEqual([]);
  });
});

describe("palette search", () => {
  it("finds my data only, never a reimbursement to edit", async () => {
    const { searchMyData } = await import("@/lib/server/search");
    const mine = await searchMyData(A, "Restaurant");
    expect(mine.merchants.map((m) => m.name)).toContain("Restaurant du port");
    expect(mine.transactions.length).toBe(1);
    const theirs = await searchMyData(B, "Restaurant");
    expect(theirs.transactions).toEqual([]);
    expect(theirs.merchants.map((m) => m.name)).not.toContain("Restaurant du port");
    expect(await searchMyData(A, "x")).toEqual({
      merchants: [],
      people: [],
      categories: [],
      transactions: [],
    });
  });
});
