import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { brandIconFor, type BrandIcon } from "@/lib/catalog";
import { db as defaultDb, type Db } from "@/lib/db/client";
import {
  categories,
  categorizationRules,
  merchants,
  recurringRules,
  transactions,
} from "@/lib/db/schema";
import { resolveLogo, type ResolvedLogo } from "@/lib/domain/logo";
import { mergeAliases } from "@/lib/domain/merchant";
import type { MerchantFilters, MerchantInput } from "@/lib/validation/merchant";
import { fail, isUniqueViolation, NOT_FOUND, ok, type Result } from "./result";

/** Merchant directory of one user, with spending statistics. `userId` comes from the session. */

export type MerchantLogoInfo = {
  logo: ResolvedLogo;
  brand: BrandIcon | null;
  /** Cache-busting version for the logo route. */
  logoVersion: number;
};

export type MerchantSummary = MerchantLogoInfo & {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  domain: string | null;
  defaultCategoryId: string | null;
  categoryName: string | null;
  logoSource: string | null;
  /** Purchases minus refunds, positive magnitude. */
  spentCents: number;
  purchaseCount: number;
  /** Average basket (purchases only), rounded to the cent. */
  averageCents: number;
  lastPurchaseOn: string | null;
};

const stats = {
  purchaseCount: sql<number>`count(${transactions.id}) filter (where ${transactions.kind} = 'expense')::int`,
  purchasesCents: sql<string>`coalesce(sum(-${transactions.amountCents}) filter (where ${transactions.kind} = 'expense'), 0)`,
  refundsCents: sql<string>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.kind} = 'refund'), 0)`,
  lastPurchaseOn: sql<
    string | null
  >`max(${transactions.occurredOn}) filter (where ${transactions.kind} = 'expense')`,
};

const base = {
  id: merchants.id,
  name: merchants.name,
  normalizedName: merchants.normalizedName,
  aliases: merchants.aliases,
  domain: merchants.domain,
  defaultCategoryId: merchants.defaultCategoryId,
  categoryName: categories.name,
  logoSource: merchants.logoSource,
  hasUpload: sql<boolean>`${merchants.logoData} is not null`,
  updatedAt: merchants.updatedAt,
};

export function logoInfo(m: {
  normalizedName: string;
  domain: string | null;
  logoSource: string | null;
  hasUpload: boolean;
  updatedAt: Date;
}): MerchantLogoInfo {
  const brand = brandIconFor(m);
  return {
    logo: resolveLogo({
      logoSource: m.logoSource,
      hasUpload: m.hasUpload,
      brandSlug: brand?.slug ?? null,
      domain: m.domain,
    }),
    brand,
    logoVersion: m.updatedAt.getTime(),
  };
}

function summaryQuery(db: Db, where: SQL) {
  return db
    .select({ ...base, ...stats })
    .from(merchants)
    .leftJoin(
      categories,
      and(eq(categories.userId, merchants.userId), eq(categories.id, merchants.defaultCategoryId)),
    )
    .leftJoin(
      transactions,
      and(eq(transactions.userId, merchants.userId), eq(transactions.merchantId, merchants.id)),
    )
    .where(where)
    .groupBy(merchants.id, categories.name);
}

type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];

function toSummary(row: SummaryRow): MerchantSummary {
  const purchases = Number(row.purchasesCents);
  const spentCents = Math.max(0, purchases - Number(row.refundsCents));
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    aliases: row.aliases,
    domain: row.domain,
    defaultCategoryId: row.defaultCategoryId,
    categoryName: row.categoryName,
    logoSource: row.logoSource,
    ...logoInfo(row),
    spentCents,
    purchaseCount: row.purchaseCount,
    averageCents: row.purchaseCount ? Math.round(purchases / row.purchaseCount) : 0,
    lastPurchaseOn: row.lastPurchaseOn,
  };
}

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listMerchants(
  userId: string,
  filters: MerchantFilters,
  db: Db = defaultDb,
): Promise<MerchantSummary[]> {
  const where: SQL[] = [eq(merchants.userId, userId)];
  if (filters.q) {
    const p = likePattern(filters.q);
    where.push(or(ilike(merchants.name, p), ilike(merchants.domain, p))!);
  }
  const order =
    filters.tri === "nom"
      ? [asc(sql`lower(${merchants.name})`)]
      : filters.tri === "achats"
        ? [desc(stats.purchaseCount), asc(merchants.name)]
        : filters.tri === "recent"
          ? [sql`${stats.lastPurchaseOn} desc nulls last`, asc(merchants.name)]
          : [desc(sql`${stats.purchasesCents} - ${stats.refundsCents}`), asc(merchants.name)];
  let query = summaryQuery(db, and(...where)!).$dynamic();
  if (filters.vue === "actifs") query = query.having(sql`count(${transactions.id}) > 0`);
  const rows = await query.orderBy(...order);
  return rows.map(toSummary);
}

export async function getMerchant(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<MerchantSummary | null> {
  const [row] = await summaryQuery(db, and(eq(merchants.userId, userId), eq(merchants.id, id))!);
  return row ? toSummary(row) : null;
}

/** Names and ids for pickers (merge target, transaction form suggestions). */
export async function listMerchantNames(userId: string, db: Db = defaultDb) {
  return db
    .select({ id: merchants.id, name: merchants.name })
    .from(merchants)
    .where(eq(merchants.userId, userId))
    .orderBy(asc(sql`lower(${merchants.name})`));
}

const DUPLICATE = "Un autre magasin porte déjà ce nom : fusionnez-les plutôt.";

export async function updateMerchant(
  userId: string,
  id: string,
  input: MerchantInput,
  db: Db = defaultDb,
): Promise<Result> {
  try {
    const rows = await db
      .update(merchants)
      .set(input)
      .where(and(eq(merchants.userId, userId), eq(merchants.id, id)))
      .returning({ id: merchants.id });
    return rows.length ? ok(undefined) : fail(NOT_FOUND);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(DUPLICATE);
    throw e;
  }
}

/** Logo choice: own image (bytes already validated), automatic chain, or monogram only. */
export async function setMerchantLogo(
  userId: string,
  id: string,
  choice:
    | { source: "upload"; data: Buffer; contentType: "image/png" | "image/jpeg" | "image/webp" }
    | { source: "auto" | "none" },
  db: Db = defaultDb,
): Promise<Result> {
  const values =
    choice.source === "upload"
      ? {
          logoSource: "upload" as const,
          logoData: choice.data,
          logoContentType: choice.contentType,
        }
      : {
          logoSource: choice.source === "none" ? ("none" as const) : null,
          logoData: null,
          logoContentType: null,
        };
  const rows = await db
    .update(merchants)
    .set(values)
    .where(and(eq(merchants.userId, userId), eq(merchants.id, id)))
    .returning({ id: merchants.id });
  return rows.length ? ok(undefined) : fail(NOT_FOUND);
}

/**
 * Merges `sourceId` into `targetId`: its movements, recurring and categorization rules move
 * to the target, its name and aliases become target aliases, then the source is deleted.
 */
export async function mergeMerchants(
  userId: string,
  targetId: string,
  sourceId: string,
  db: Db = defaultDb,
): Promise<Result> {
  if (targetId === sourceId) return fail("Choisissez un autre magasin.");
  return db.transaction(async (tx) => {
    const found = await tx
      .select({
        id: merchants.id,
        normalizedName: merchants.normalizedName,
        aliases: merchants.aliases,
        domain: merchants.domain,
        defaultCategoryId: merchants.defaultCategoryId,
      })
      .from(merchants)
      .where(and(eq(merchants.userId, userId), inArray(merchants.id, [targetId, sourceId])))
      .for("update");
    const target = found.find((m) => m.id === targetId);
    const source = found.find((m) => m.id === sourceId);
    if (!target || !source) return fail(NOT_FOUND);

    const set = { merchantId: targetId };
    await tx
      .update(transactions)
      .set(set)
      .where(and(eq(transactions.userId, userId), eq(transactions.merchantId, sourceId)));
    await tx
      .update(recurringRules)
      .set(set)
      .where(and(eq(recurringRules.userId, userId), eq(recurringRules.merchantId, sourceId)));
    await tx
      .update(categorizationRules)
      .set(set)
      .where(
        and(eq(categorizationRules.userId, userId), eq(categorizationRules.merchantId, sourceId)),
      );
    await tx.delete(merchants).where(and(eq(merchants.userId, userId), eq(merchants.id, sourceId)));
    await tx
      .update(merchants)
      .set({
        aliases: mergeAliases(target, [source]),
        domain: target.domain ?? source.domain,
        defaultCategoryId: target.defaultCategoryId ?? source.defaultCategoryId,
      })
      .where(and(eq(merchants.userId, userId), eq(merchants.id, targetId)));
    return ok(undefined);
  });
}
