/**
 * Sprint 6 on a real PostgreSQL: month series and comparison, subscriptions (detected,
 * tracked in one click, ignored), unusual expenses, forecast, return and warranty
 * reminders, monthly report, deterministic answers to translated questions, isolation.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { receipts, recurringRules } from "@/lib/db/schema";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import {
  categoryComparison,
  dismissSubscription,
  getForecast,
  getMonthlyReport,
  listAnomalies,
  listDeadlines,
  listSubscriptions,
  monthlySeries,
  simulationBaseline,
  trackSubscription,
} from "@/lib/server/analytics";
import { runQuery } from "@/lib/server/ask";
import { listCategories } from "@/lib/server/categories";
import { provisionUser } from "@/lib/server/provisioning";
import { createReceipt } from "@/lib/server/receipts";
import { createTransaction } from "@/lib/server/transactions";
import { createUsers, deleteUsers } from "./helpers";

let A = "";
let B = "";
let checking = "";
const cat: Record<string, string> = {};
const TODAY = "2026-11-17";
const NOV = { year: 2026, month: 11 };
const OCT = { year: 2026, month: 10 };

async function add(
  date: string,
  cents: number,
  merchantName: string,
  category: string | null,
  kind: "expense" | "income" = "expense",
  user = A,
) {
  const r = await createTransaction(user, {
    kind,
    amountCents: cents,
    occurredOn: date,
    label: merchantName,
    merchantName,
    accountId: checking,
    toAccountId: null,
    categoryId: category ? cat[category]! : null,
    notes: null,
  });
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

let lists: {
  categories: { id: string; name: string; parentId: string | null }[];
  merchants: { id: string; name: string }[];
};

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  await provisionUser(A);
  await provisionUser(B);
  checking = (await listAccountsWithBalance(A))[0]!.id;
  const cats = await listCategories(A);
  for (const c of cats) cat[c.name] = c.id;
  // Five months of a subscription whose price rose in October.
  for (const [d, cents] of [
    ["2026-07-12", 1099],
    ["2026-08-12", 1099],
    ["2026-09-12", 1099],
    ["2026-10-12", 1199],
    ["2026-11-12", 1199],
  ] as const) {
    await add(d, cents, "Spotify", "Restaurants");
  }
  // Restaurants: a usual size around 20 €, then a big dinner in November.
  for (const [d, cents] of [
    ["2026-08-03", 2000],
    ["2026-08-20", 2400],
    ["2026-09-07", 1800],
    ["2026-09-25", 2200],
    ["2026-10-09", 2100],
    ["2026-10-22", 1900],
  ] as const) {
    await add(d, cents, "Bistrot", "Restaurants");
  }
  await add("2026-11-08", 12_000, "Le Grand Restaurant", "Restaurants");
  await add("2026-10-01", 250_000, "Salaire", null, "income");
  await add("2026-11-01", 250_000, "Salaire", null, "income");
  await add("2026-11-05", 4_000, "Lidl", "Courses");
  lists = {
    categories: cats.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
    merchants: [],
  };
});

afterAll(() => deleteUsers([A, B]));

describe("month by month", () => {
  it("returns my spending and income for each month, empty months included", async () => {
    const series = await monthlySeries(A, NOV, 3);
    expect(series.map((p) => p.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(series[1]).toMatchObject({ spentCents: 1199 + 2100 + 1900, incomeCents: 250_000 });
    expect(series[2]).toMatchObject({ spentCents: 1199 + 12_000 + 4_000, incomeCents: 250_000 });
  });

  it("compares main categories with last month", async () => {
    const rows = await categoryComparison(A, NOV);
    const alimentation = rows.find((r) => r.name === "Alimentation")!;
    expect(alimentation).toMatchObject({
      currentCents: 1199 + 12_000 + 4_000,
      previousCents: 1199 + 2100 + 1900,
    });
  });
});

describe("subscriptions", () => {
  it("detects the monthly charge and its price rise", async () => {
    const [s] = await listSubscriptions(A, TODAY);
    expect(s).toMatchObject({
      name: "Spotify",
      tracked: false,
      lastAmountCents: 1199,
      increase: { fromCents: 1099, toCents: 1199, sinceDate: "2026-10-12" },
      nextDate: "2026-12-12",
    });
  });

  it("tracks it in one click as a monthly rule starting at the next charge", async () => {
    const [s] = await listSubscriptions(A, TODAY);
    const r = await trackSubscription(A, s!.key, TODAY);
    if (!r.ok) throw new Error(r.error);
    const [rule] = await db.select().from(recurringRules).where(eq(recurringRules.id, r.data.id));
    expect(rule).toMatchObject({
      kind: "expense",
      amountCents: -1199,
      frequency: "monthly",
      dayOfMonth: 12,
      startOn: "2026-12-12",
    });
    expect((await listSubscriptions(A, TODAY))[0]?.tracked).toBe(true);
    expect(await trackSubscription(A, s!.key, TODAY)).toEqual({
      ok: false,
      error: "Cet abonnement est déjà suivi dans Récurrent.",
    });
  });

  it("forgets an ignored subscription", async () => {
    const [s] = await listSubscriptions(A, TODAY);
    await dismissSubscription(A, s!.key);
    await dismissSubscription(A, s!.key);
    expect(await listSubscriptions(A, TODAY)).toEqual([]);
  });
});

describe("unusual expenses, forecast, reminders", () => {
  it("flags the big dinner against the usual restaurant bill", async () => {
    const anomalies = await listAnomalies(A, NOV);
    expect(anomalies.map((a) => a.label)).toEqual(["Le Grand Restaurant"]);
    expect(anomalies[0]!.ratio).toBeGreaterThan(5);
  });

  it("projects the end-of-month balance", async () => {
    const f = await getForecast(A, TODAY);
    expect(f.daysLeft).toBe(13);
    expect(f.projectedCents).toBe(f.balanceCents + f.plannedNetCents - f.dailyCents * 13);
    expect(f.dailyCents).toBeGreaterThan(0);
  });

  it("lists returns ending soon and warranties", async () => {
    const up = await createReceipt(A, {
      data: new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46,
      ]),
      filename: "darty.pdf",
      thumbnail: null,
    });
    if (!up.ok) throw new Error(up.error);
    await db
      .update(receipts)
      .set({
        status: "validated",
        validatedAt: new Date(),
        returnDeadline: "2026-11-20",
        warrantyUntil: "2028-11-01",
      })
      .where(eq(receipts.id, up.data.id));
    expect(await listDeadlines(A, TODAY)).toMatchObject([
      { kind: "return", date: "2026-11-20", daysLeft: 3, label: "darty.pdf" },
    ]);
    expect(await listDeadlines(B, TODAY)).toEqual([]);
  });
});

describe("report and simulator", () => {
  it("writes the month's report from the figures", async () => {
    const r = await getMonthlyReport(A, NOV, TODAY);
    expect(r.monthLabel).toBe("novembre 2026");
    const brief = r.sections.find((s) => s.title === "En bref")!.lines;
    expect(brief[0]).toMatch(/^Dépenses : 171,99 €, en hausse de \d+ %/);
    expect(r.sections.find((s) => s.title === "À surveiller")?.lines[0]).toMatch(
      /^Le Grand Restaurant : 120,00 €/,
    );
  });

  it("averages the last three months for the simulator", async () => {
    const b = await simulationBaseline(A, TODAY);
    expect(b.incomeCents).toBe(Math.round(250_000 / 3));
    expect(b.categories[0]?.name).toBe("Alimentation");
  });
});

describe("answers to translated questions", () => {
  it("computes spending of a category over a month, and per month", async () => {
    const one = await runQuery(
      A,
      {
        measure: "spent",
        period: "last_month",
        category: "restaurants",
        merchant: null,
        groupBy: null,
      },
      TODAY,
      lists,
    );
    expect(one).toEqual({
      ok: true,
      data: {
        understood: "Dépenses · Restaurants · octobre 2026",
        measure: "spent",
        total: 1199 + 2100 + 1900,
        rows: [],
      },
    });
    const months = await runQuery(
      A,
      {
        measure: "count",
        period: "last_3_months",
        category: null,
        merchant: null,
        groupBy: "month",
      },
      TODAY,
      lists,
    );
    expect(months.ok && months.data.rows.map((r) => r.value)).toEqual([3, 3, 3]);
  });

  it("refuses unknown names and periods instead of guessing", async () => {
    expect(
      await runQuery(
        A,
        {
          measure: "spent",
          period: "this_month",
          category: "Voyages lointains",
          merchant: null,
          groupBy: null,
        },
        TODAY,
        lists,
      ),
    ).toEqual({ ok: false, error: "Catégorie « Voyages lointains » introuvable." });
    expect(
      await runQuery(
        A,
        { measure: "spent", period: "hier", category: null, merchant: null, groupBy: null },
        TODAY,
        lists,
      ),
    ).toEqual({ ok: false, error: "Période non comprise. Précisez un mois ou une année." });
  });
});

describe("isolation A/B", () => {
  it("B's analyses never include A's data", async () => {
    expect((await monthlySeries(B, NOV, 3)).every((p) => p.spentCents === 0)).toBe(true);
    expect(await listSubscriptions(B, TODAY)).toEqual([]);
    expect(await listAnomalies(B, NOV)).toEqual([]);
    const bLists = {
      categories: (await listCategories(B)).map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
      })),
      merchants: [],
    };
    const r = await runQuery(
      B,
      {
        measure: "spent",
        period: "last_month",
        category: "Restaurants",
        merchant: null,
        groupBy: null,
      },
      TODAY,
      bLists,
    );
    expect(r.ok && r.data.total).toBe(0);
  });

  it("B cannot track A's subscription", async () => {
    expect(await trackSubscription(B, "m:does-not-matter", TODAY)).toEqual({
      ok: false,
      error: "Élément introuvable.",
    });
    expect(await categoryComparison(B, OCT)).toEqual([]);
  });
});
