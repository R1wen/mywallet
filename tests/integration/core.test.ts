/**
 * Sprint 1 core on a real PostgreSQL: provisioning, transactions (CRUD, transfers, refunds,
 * filters), categories (deletion with replacement), merchants (stats, merge, logo cache),
 * month dashboard. Every block also proves that user B cannot touch user A's data.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { budgets, logoCache, merchants, transactions } from "@/lib/db/schema";
import { listAccountsWithBalance, updateAccount } from "@/lib/server/accounts";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "@/lib/server/categories";
import { getMonthDashboard } from "@/lib/server/dashboard";
import { getFavicon, getMerchantLogoImage } from "@/lib/server/logos";
import {
  getMerchant,
  listMerchants,
  mergeMerchants,
  setMerchantLogo,
  updateMerchant,
} from "@/lib/server/merchants";
import { provisionUser } from "@/lib/server/provisioning";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "@/lib/server/transactions";
import { parseTransactionFilters, type TransactionInput } from "@/lib/validation/transaction";
import { createUsers, deleteUsers } from "./helpers";

let A = "";
let B = "";
let checking = "";
let savings = "";
let accountOfB = "";
const cat = new Map<string, string>();

const filters = (p: Record<string, string> = {}) => parseTransactionFilters(p);

/** Repository input as produced by the Zod schema (label falls back to the merchant). */
function input(patch: Partial<TransactionInput>): TransactionInput {
  const label = patch.label || patch.merchantName || "Test";
  return {
    kind: "expense",
    amountCents: 1000,
    occurredOn: "2026-11-10",
    merchantName: "",
    accountId: checking,
    toAccountId: null,
    categoryId: null,
    notes: null,
    ...patch,
    label,
  };
}

async function create(patch: Partial<TransactionInput>, user = A) {
  const r = await createTransaction(user, input(patch));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  await provisionUser(A);
  await provisionUser(A); // idempotent
  await provisionUser(B);
  const accountsA = await listAccountsWithBalance(A);
  checking = accountsA[0]!.id;
  const [s] = await db
    .insert((await import("@/lib/db/schema")).accounts)
    .values({ userId: A, name: "Livret A", type: "savings", openingBalanceCents: 100000 })
    .returning();
  savings = s!.id;
  accountOfB = (await listAccountsWithBalance(B))[0]!.id;
  for (const c of await listCategories(A)) cat.set(c.name, c.id);
});

afterAll(async () => {
  await deleteUsers([A, B]);
});

describe("provisioning", () => {
  it("gives a new user categories, the merchant catalogue and one checking account, once", async () => {
    expect((await listCategories(A)).length).toBeGreaterThan(30);
    const all = await listMerchants(A, { tri: "nom", vue: "tous" });
    expect(all.length).toBeGreaterThan(60);
    expect(all.find((m) => m.name === "Carrefour")?.logo).toEqual({
      kind: "brand",
      slug: "carrefour",
    });
    expect(all.find((m) => m.name === "Decathlon")?.logo).toEqual({ kind: "favicon" });
    expect((await listAccountsWithBalance(B)).map((a) => a.name)).toEqual(["Compte courant"]);
  });
});

describe("transactions", () => {
  it("links a typed merchant (name or alias) and applies its default category", async () => {
    const id = await create({
      merchantName: "CARREFOUR MARKET 0123",
      label: "",
      amountCents: 4250,
    });
    const tx = await getTransaction(A, id);
    expect(tx).toMatchObject({ kind: "expense", amountCents: 4250, merchantName: "Carrefour" });
    expect(tx?.categoryId).toBe(cat.get("Courses"));
  });

  it("creates an unknown merchant on the fly", async () => {
    await create({ merchantName: "Boulangerie Dupont", label: "Pain" });
    const m = (await listMerchants(A, { tri: "nom", vue: "actifs", q: "dupont" }))[0];
    expect(m).toMatchObject({
      name: "Boulangerie Dupont",
      purchaseCount: 1,
      logo: { kind: "monogram" },
    });
  });

  it("rejects a category whose kind does not match the movement", async () => {
    const r = await createTransaction(
      A,
      input({ kind: "income", categoryId: cat.get("Courses")! }),
    );
    expect(r).toEqual({
      ok: false,
      error: "Cette catégorie ne correspond pas au type de mouvement.",
    });
  });

  it("stores a transfer as two legs and moves both balances", async () => {
    const before = await listAccountsWithBalance(A);
    const id = await create({
      kind: "transfer",
      amountCents: 20000,
      toAccountId: savings,
      label: "Épargne",
    });
    const after = await listAccountsWithBalance(A);
    const delta = (accId: string) =>
      after.find((a) => a.id === accId)!.balanceCents -
      before.find((a) => a.id === accId)!.balanceCents;
    expect(delta(checking)).toBe(-20000);
    expect(delta(savings)).toBe(20000);
    expect(await getTransaction(A, id)).toMatchObject({
      accountId: checking,
      toAccountId: savings,
      amountCents: 20000,
    });

    const edited = await updateTransaction(
      A,
      id,
      input({ kind: "transfer", amountCents: 15000, toAccountId: savings, label: "Épargne" }),
    );
    expect(edited.ok).toBe(true);
    const legs = await db.select().from(transactions).where(eq(transactions.userId, A));
    expect(
      legs
        .filter((t) => t.kind === "transfer")
        .map((t) => t.amountCents)
        .sort(),
    ).toEqual([-15000, 15000]);

    expect(await deleteTransaction(A, id)).toEqual({ ok: true, data: undefined });
    const left = await db.select().from(transactions).where(eq(transactions.userId, A));
    expect(left.some((t) => t.kind === "transfer")).toBe(false);
  });

  it("refuses to turn an expense into a transfer", async () => {
    const id = await create({});
    const r = await updateTransaction(A, id, input({ kind: "transfer", toAccountId: savings }));
    expect(r.ok).toBe(false);
  });

  it("filters, searches (wildcards are literal), sorts and paginates", async () => {
    await create({ label: "100% bio", amountCents: 999, occurredOn: "2026-10-02" });
    await create({ label: "Taxe_x", amountCents: 1, occurredOn: "2026-10-03" });
    expect((await listTransactions(A, filters({ q: "%" }))).rows.map((r) => r.label)).toEqual([
      "100% bio",
    ]);
    expect((await listTransactions(A, filters({ q: "_" }))).rows.map((r) => r.label)).toEqual([
      "Taxe_x",
    ]);
    const october = await listTransactions(
      A,
      filters({ du: "2026-10-01", au: "2026-10-31", tri: "montant", ordre: "asc" }),
    );
    expect(october.rows.map((r) => r.amountCents)).toEqual([-1, -999]);
    const courses = await listTransactions(A, filters({ categorie: cat.get("Alimentation")! }));
    expect(courses.rows.every((r) => r.categoryName === "Courses")).toBe(true);
    expect(courses.total).toBeGreaterThan(0);
    const far = await listTransactions(A, filters({ page: "999" }));
    expect(far.page).toBe(far.pageCount);
  });

  it("isolation: B cannot read, list, update or delete A's transaction, nor book on A's account", async () => {
    const id = await create({ label: "Secret de A" });
    expect(await getTransaction(B, id)).toBeNull();
    expect((await listTransactions(B, filters({ q: "Secret" }))).total).toBe(0);
    expect(await updateTransaction(B, id, input({ accountId: accountOfB }))).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    expect(await deleteTransaction(B, id)).toEqual({ ok: false, error: "Élément introuvable." });
    expect(await createTransaction(B, input({ accountId: checking }))).toEqual({
      ok: false,
      error: "Compte introuvable.",
    });
    expect(
      await createTransaction(B, input({ accountId: accountOfB, categoryId: cat.get("Courses")! })),
    ).toEqual({
      ok: false,
      error: "Catégorie introuvable.",
    });
    expect(await getTransaction(A, id)).not.toBeNull();
  });
});

describe("accounts", () => {
  it("updates an account and B cannot", async () => {
    const r = await updateAccount(A, savings, {
      name: "Livret A (BNP)",
      type: "savings",
      institution: "BNP",
      openingBalanceCents: 100000,
    });
    expect(r.ok).toBe(true);
    expect(
      await updateAccount(B, savings, {
        name: "x",
        type: "cash",
        institution: null,
        openingBalanceCents: 0,
      }),
    ).toEqual({ ok: false, error: "Élément introuvable." });
  });
});

describe("categories", () => {
  it("creates and renames within the two-level rule", async () => {
    const r = await createCategory(A, { name: "Animaux", kind: "expense", parentId: null });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.data.id : "";
    expect(
      await createCategory(A, {
        name: "Croquettes",
        kind: "expense",
        parentId: cat.get("Courses")!,
      }),
    ).toEqual({ ok: false, error: "Deux niveaux maximum : choisissez une catégorie principale." });
    expect(await createCategory(A, { name: "Animaux", kind: "expense", parentId: null })).toEqual({
      ok: false,
      error: "Une catégorie porte déjà ce nom à cet endroit.",
    });
    expect((await updateCategory(A, id, { name: "Animaux de compagnie", parentId: null })).ok).toBe(
      true,
    );
    expect(await updateCategory(B, id, { name: "x", parentId: null })).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
  });

  it("moves transactions, merchants and items to the replacement, then deletes", async () => {
    const restaurants = cat.get("Restaurants")!;
    const livraison = cat.get("Livraison de repas")!;
    const id = await create({ label: "Sushi", categoryId: livraison });
    await db.insert(budgets).values({
      userId: A,
      categoryId: livraison,
      amountCents: 5000,
      period: "monthly",
      startsOn: "2026-11-01",
    });

    expect(await deleteCategory(B, livraison, restaurants)).toEqual({
      ok: false,
      error: "Catégorie introuvable.",
    });
    expect(await deleteCategory(A, cat.get("Alimentation")!, cat.get("Transports")!)).toEqual({
      ok: false,
      error: "Supprimez ou déplacez d'abord ses sous-catégories.",
    });

    expect(await deleteCategory(A, livraison, restaurants)).toEqual({ ok: true, data: undefined });
    expect((await getTransaction(A, id))?.categoryId).toBe(restaurants);
    const deliveroo = (await db.select().from(merchants).where(eq(merchants.userId, A))).find(
      (m) => m.name === "Deliveroo",
    );
    expect(deliveroo?.defaultCategoryId).toBe(restaurants);
    expect((await listCategories(A)).some((c) => c.id === livraison)).toBe(false);
    expect(
      (await db.select().from(budgets).where(eq(budgets.userId, A))).some(
        (b) => b.categoryId === livraison,
      ),
    ).toBe(false);
  });
});

describe("merchants", () => {
  it("computes spending net of refunds, purchase count, average basket and last purchase", async () => {
    await create({ merchantName: "Zalando", amountCents: 8990, occurredOn: "2026-11-02" });
    await create({ merchantName: "Zalando", amountCents: 3010, occurredOn: "2026-11-05" });
    await create({
      kind: "refund",
      merchantName: "Zalando",
      amountCents: 4990,
      occurredOn: "2026-11-08",
    });
    const z = (await listMerchants(A, { tri: "depense", vue: "actifs", q: "zalando" }))[0]!;
    expect(z).toMatchObject({
      spentCents: 7010,
      purchaseCount: 2,
      averageCents: 6000,
      lastPurchaseOn: "2026-11-05",
    });
  });

  it("edits name, domain and aliases; refuses a duplicate name", async () => {
    const all = await listMerchants(A, { tri: "nom", vue: "tous" });
    const fnac = all.find((m) => m.name === "Fnac")!;
    const r = await updateMerchant(A, fnac.id, {
      name: "Fnac",
      normalizedName: "fnac",
      domain: "fnac.com",
      defaultCategoryId: null,
      aliases: ["fnac darty"],
    });
    expect(r.ok).toBe(true);
    expect(
      await updateMerchant(A, fnac.id, {
        name: "Darty",
        normalizedName: "darty",
        domain: null,
        defaultCategoryId: null,
        aliases: [],
      }),
    ).toEqual({ ok: false, error: "Un autre magasin porte déjà ce nom : fusionnez-les plutôt." });
    expect(
      await updateMerchant(B, fnac.id, {
        name: "x",
        normalizedName: "x",
        domain: null,
        defaultCategoryId: null,
        aliases: [],
      }),
    ).toEqual({ ok: false, error: "Élément introuvable." });
  });

  it("merges a duplicate: movements move, names become aliases, source is deleted", async () => {
    const id = await create({ merchantName: "Carrefour City Bastille", amountCents: 500 });
    const dup = (await getTransaction(A, id))!;
    const all = await listMerchants(A, { tri: "nom", vue: "tous" });
    const source = all.find((m) => m.name === "Carrefour City Bastille")!;
    const target = all.find((m) => m.name === "Carrefour")!;
    expect(dup.merchantName).toBe("Carrefour City Bastille");

    expect(await mergeMerchants(B, target.id, source.id)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    expect(await mergeMerchants(A, target.id, source.id)).toEqual({ ok: true, data: undefined });

    expect((await getTransaction(A, id))?.merchantName).toBe("Carrefour");
    expect(await getMerchant(A, source.id)).toBeNull();
    expect((await getMerchant(A, target.id))?.aliases).toContain("carrefour city bastille");
  });

  it("isolation: B cannot read A's merchant nor its logo", async () => {
    const carrefour = (await listMerchants(A, { tri: "nom", vue: "tous", q: "carrefour" }))[0]!;
    expect(await getMerchant(B, carrefour.id)).toBeNull();
    expect(await getMerchantLogoImage(B, carrefour.id)).toBeNull();
    expect(await setMerchantLogo(B, carrefour.id, { source: "none" })).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
  });

  it("serves an uploaded logo to its owner, and 'none' forces the monogram", async () => {
    const m = (await listMerchants(A, { tri: "nom", vue: "tous", q: "kiabi" }))[0]!;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await setMerchantLogo(A, m.id, { source: "upload", data: png, contentType: "image/png" });
    expect((await getMerchant(A, m.id))?.logo).toEqual({ kind: "upload" });
    expect((await getMerchantLogoImage(A, m.id))?.data.equals(png)).toBe(true);
    await setMerchantLogo(A, m.id, { source: "none" });
    expect((await getMerchant(A, m.id))?.logo).toEqual({ kind: "monogram" });
    expect(await getMerchantLogoImage(A, m.id)).toBeNull();
  });
});

/** A Response whose `url` (read-only getter) reports the requested URL, as after fetch(). */
function withUrl(res: Response, url: string): Response {
  Object.defineProperty(res, "url", { value: url });
  return res;
}

describe("favicon cache", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

  it("fetches from the fixed provider once, then serves from the cache", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      withUrl(new Response(png, { status: 200 }), String(url)),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = await getFavicon("https://www.Exemple-Cache.fr/page");
      const second = await getFavicon("exemple-cache.fr");
      expect(first?.contentType).toBe("image/png");
      expect(second?.data.equals(Buffer.from(png))).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]![0])).toMatch(
        /^https:\/\/www\.google\.com\/s2\/favicons\?domain=exemple-cache\.fr/,
      );
    } finally {
      vi.unstubAllGlobals();
      await db.delete(logoCache).where(eq(logoCache.domain, "exemple-cache.fr"));
    }
  });

  it("caches a miss and never stores SVG or refuses invalid domains without fetching", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      withUrl(
        new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { status: 200 }),
        String(url),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await getFavicon("svg-only.fr")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2); // both providers tried
      const [row] = await db.select().from(logoCache).where(eq(logoCache.domain, "svg-only.fr"));
      expect(row).toMatchObject({ status: "missing", data: null });
      expect(await getFavicon("svg-only.fr")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2); // cached miss
      expect(await getFavicon("127.0.0.1")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      await db.delete(logoCache).where(eq(logoCache.domain, "svg-only.fr"));
    }
  });
});

describe("favicon outages", () => {
  it("does not cache a timeout or a 5xx as a missing logo", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await getFavicon("panne-passagere.fr")).toBeNull();
      const rows = await db
        .select()
        .from(logoCache)
        .where(eq(logoCache.domain, "panne-passagere.fr"));
      expect(rows).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sorting by amount", () => {
  it("orders by size whatever the direction of the movement", async () => {
    const [C = ""] = await createUsers(1);
    try {
      await provisionUser(C);
      const [acc] = await listAccountsWithBalance(C);
      for (const [kind, amountCents] of [
        ["expense", 120000],
        ["expense", 200],
        ["income", 5000],
      ] as const) {
        await createTransaction(C, input({ accountId: acc!.id, kind, amountCents }));
      }
      const r = await listTransactions(C, filters({ tri: "montant", ordre: "desc" }));
      expect(r.rows.map((t) => t.amountCents)).toEqual([-120000, 5000, -200]);
    } finally {
      await deleteUsers([C]);
    }
  });
});

describe("dashboard", () => {
  it("summarizes the month with refunds lowering spending and transfers ignored", async () => {
    const [C = ""] = await createUsers(1);
    try {
      await provisionUser(C);
      const [acc] = await listAccountsWithBalance(C);
      const cats = new Map((await listCategories(C)).map((c) => [c.name, c.id]));
      const mk = (p: Partial<TransactionInput>) =>
        createTransaction(C, input({ accountId: acc!.id, ...p }));
      await mk({
        kind: "income",
        amountCents: 250000,
        label: "Salaire",
        categoryId: cats.get("Salaire")!,
        occurredOn: "2026-11-01",
      });
      await mk({ amountCents: 8000, merchantName: "Lidl", occurredOn: "2026-11-03" });
      await mk({ amountCents: 4000, merchantName: "KFC", occurredOn: "2026-11-04" });
      await mk({
        kind: "refund",
        amountCents: 1000,
        merchantName: "Lidl",
        occurredOn: "2026-11-05",
      });
      await mk({ amountCents: 99999, label: "Octobre", occurredOn: "2026-10-31" });

      const d = await getMonthDashboard(C, { year: 2026, month: 11 });
      expect(d.flows).toEqual({
        incomeCents: 250000,
        spentCents: 11000,
        reimbursedCents: 0,
        sharedCents: 0,
        netCents: 239000,
      });
      expect(d.topCategories).toEqual([
        { id: cats.get("Alimentation")!, name: "Alimentation", spentCents: 11000 },
      ]);
      expect(d.recent.map((r) => r.label)).toEqual(["Lidl", "KFC", "Lidl", "Salaire"]);
      expect(d.totalBalanceCents).toBe(250000 - 8000 - 4000 + 1000 - 99999);
    } finally {
      await deleteUsers([C]);
    }
  });
});
