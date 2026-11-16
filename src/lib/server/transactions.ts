import "server-only";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { type Conn, db as defaultDb, type Db } from "@/lib/db/client";
import { accounts, categories, merchants, transactions } from "@/lib/db/schema";
import { findMerchantByLabel, normalizeMerchantName } from "@/lib/domain/merchant";
import { signedAmount, type TxKind } from "@/lib/domain/transactions";
import { logoInfo, type MerchantLogoInfo } from "./merchants";
import {
  PAGE_SIZE,
  type TransactionFilters,
  type TransactionInput,
} from "@/lib/validation/transaction";
import {
  fail,
  isCheckViolation,
  isForeignKeyViolation,
  NOT_FOUND,
  ok,
  type Result,
} from "./result";

/**
 * Transactions. Every function takes the session `userId` first and filters on it;
 * composite foreign keys (ADR-010) make it impossible to attach another user's account,
 * category or merchant even if a forged id reaches the database.
 */

type Tx = Exclude<Conn, Db>;

export type TransactionListRow = {
  id: string;
  kind: TxKind;
  amountCents: number;
  currency: string;
  occurredOn: string;
  label: string;
  notes: string | null;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  merchantId: string | null;
  merchantName: string | null;
  /** Logo of the merchant, for <MerchantLogo>. */
  merchantLogo: MerchantLogoInfo | null;
  transferGroupId: string | null;
};

/** `%` and `_` typed by the user are literal characters, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function filterConditions(userId: string, f: TransactionFilters, categoryIds: string[] | null) {
  const where: SQL[] = [eq(transactions.userId, userId)];
  if (f.compte) where.push(eq(transactions.accountId, f.compte));
  if (categoryIds) where.push(inArray(transactions.categoryId, categoryIds));
  if (f.marchand) where.push(eq(transactions.merchantId, f.marchand));
  if (f.type) where.push(eq(transactions.kind, f.type));
  if (f.du) where.push(gte(transactions.occurredOn, f.du));
  if (f.au) where.push(lte(transactions.occurredOn, f.au));
  if (f.q) {
    const p = likePattern(f.q);
    where.push(
      or(ilike(transactions.label, p), ilike(transactions.notes, p), ilike(merchants.name, p))!,
    );
  }
  return and(...where)!;
}

/** A root category filter also matches its sub-categories. */
async function expandCategory(userId: string, id: string | undefined, db: Conn) {
  if (!id) return null;
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.userId, userId), or(eq(categories.id, id), eq(categories.parentId, id))),
    );
  return rows.length ? rows.map((r) => r.id) : [id];
}

export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
  db: Db = defaultDb,
): Promise<{ rows: TransactionListRow[]; total: number; page: number; pageCount: number }> {
  const categoryIds = await expandCategory(userId, filters.categorie, db);
  const where = filterConditions(userId, filters, categoryIds);
  const dir = filters.ordre === "asc" ? asc : desc;
  const primary =
    filters.tri === "montant"
      ? dir(transactions.amountCents)
      : filters.tri === "libelle"
        ? dir(sql`lower(${transactions.label})`)
        : dir(transactions.occurredOn);

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(transactions)
    .leftJoin(
      merchants,
      and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
    )
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const rows = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      occurredOn: transactions.occurredOn,
      label: transactions.label,
      notes: transactions.notes,
      accountId: transactions.accountId,
      accountName: accounts.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      merchantId: transactions.merchantId,
      merchantName: merchants.name,
      merchantNormalizedName: merchants.normalizedName,
      merchantDomain: merchants.domain,
      merchantLogoSource: merchants.logoSource,
      merchantHasUpload: sql<boolean>`${merchants.logoData} is not null`,
      merchantUpdatedAt: merchants.updatedAt,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(eq(accounts.userId, transactions.userId), eq(accounts.id, transactions.accountId)),
    )
    .leftJoin(
      categories,
      and(eq(categories.userId, transactions.userId), eq(categories.id, transactions.categoryId)),
    )
    .leftJoin(
      merchants,
      and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
    )
    .where(where)
    .orderBy(primary, desc(transactions.createdAt), desc(transactions.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    rows: rows.map(
      ({
        merchantNormalizedName,
        merchantDomain,
        merchantLogoSource,
        merchantHasUpload,
        merchantUpdatedAt,
        ...r
      }): TransactionListRow => ({
        ...r,
        merchantLogo:
          r.merchantId && merchantNormalizedName && merchantUpdatedAt
            ? logoInfo({
                normalizedName: merchantNormalizedName,
                domain: merchantDomain,
                logoSource: merchantLogoSource,
                hasUpload: merchantHasUpload,
                updatedAt: merchantUpdatedAt,
              })
            : null,
      }),
    ),
    total,
    page,
    pageCount,
  };
}

export type TransactionDetail = {
  id: string;
  kind: TxKind;
  /** Positive magnitude, as typed in the form. */
  amountCents: number;
  occurredOn: string;
  label: string;
  notes: string | null;
  merchantName: string;
  accountId: string;
  /** Credited account for a transfer. */
  toAccountId: string | null;
  categoryId: string | null;
};

/** One transaction in form shape; a transfer is returned as its debit side + credit account. */
export async function getTransaction(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<TransactionDetail | null> {
  const [row] = await db
    .select({ tx: transactions, merchantName: merchants.name })
    .from(transactions)
    .leftJoin(
      merchants,
      and(eq(merchants.userId, transactions.userId), eq(merchants.id, transactions.merchantId)),
    )
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .limit(1);
  if (!row) return null;
  const { tx } = row;
  let accountId = tx.accountId;
  let toAccountId: string | null = null;
  if (tx.kind === "transfer" && tx.transferGroupId) {
    const legs = await db
      .select({ accountId: transactions.accountId, amountCents: transactions.amountCents })
      .from(transactions)
      .where(
        and(eq(transactions.userId, userId), eq(transactions.transferGroupId, tx.transferGroupId)),
      );
    accountId = legs.find((l) => l.amountCents < 0)?.accountId ?? tx.accountId;
    toAccountId = legs.find((l) => l.amountCents > 0)?.accountId ?? null;
  }
  return {
    id: tx.id,
    kind: tx.kind,
    amountCents: Math.abs(tx.amountCents),
    occurredOn: tx.occurredOn,
    label: tx.label,
    notes: tx.notes,
    merchantName: row.merchantName ?? "",
    accountId,
    toAccountId,
    categoryId: tx.categoryId,
  };
}

const EXPECTED_CATEGORY_KIND = {
  expense: "expense",
  refund: "expense",
  income: "income",
  transfer: "transfer",
  reimbursement: "expense",
} as const;

/** Links the typed merchant name to an existing merchant (name or alias) or creates it. */
async function resolveMerchant(userId: string, name: string, tx: Tx) {
  if (!name) return null;
  const normalizedName = normalizeMerchantName(name);
  if (!normalizedName) return null;
  const known = await tx
    .select({
      id: merchants.id,
      normalizedName: merchants.normalizedName,
      aliases: merchants.aliases,
      defaultCategoryId: merchants.defaultCategoryId,
    })
    .from(merchants)
    .where(eq(merchants.userId, userId));
  const match = findMerchantByLabel(name, known);
  if (match) return match;
  const [created] = await tx
    .insert(merchants)
    .values({ userId, name, normalizedName })
    .onConflictDoNothing()
    .returning({ id: merchants.id, defaultCategoryId: merchants.defaultCategoryId });
  return created ?? null;
}

async function checkReferences(
  userId: string,
  input: TransactionInput,
  tx: Tx,
): Promise<string | null> {
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
    if (cat.kind !== EXPECTED_CATEGORY_KIND[input.kind]) {
      return "Cette catégorie ne correspond pas au type de mouvement.";
    }
  }
  return null;
}

async function writeTransaction(
  userId: string,
  input: TransactionInput,
  tx: Tx,
  existing?: { id: string; transferGroupId: string | null },
): Promise<Result<{ id: string }>> {
  const refError = await checkReferences(userId, input, tx);
  if (refError) return fail(refError);

  const common = {
    userId,
    kind: input.kind,
    occurredOn: input.occurredOn,
    label: input.label,
    notes: input.notes,
  };

  if (input.kind === "transfer") {
    const groupId = existing?.transferGroupId ?? randomUUID();
    if (existing) {
      await tx
        .delete(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.transferGroupId, groupId)));
    }
    const legs = await tx
      .insert(transactions)
      .values([
        {
          ...common,
          ...(existing ? { id: existing.id } : {}),
          accountId: input.accountId,
          amountCents: signedAmount("transfer", input.amountCents, "out"),
          categoryId: input.categoryId,
          transferGroupId: groupId,
        },
        {
          ...common,
          accountId: input.toAccountId!,
          amountCents: signedAmount("transfer", input.amountCents, "in"),
          categoryId: input.categoryId,
          transferGroupId: groupId,
        },
      ])
      .returning({ id: transactions.id });
    return ok({ id: legs[0]!.id });
  }

  const merchant = await resolveMerchant(userId, input.merchantName, tx);
  let categoryId = input.categoryId;
  if (!categoryId && merchant?.defaultCategoryId && input.kind !== "income") {
    categoryId = merchant.defaultCategoryId;
  }
  const values = {
    ...common,
    accountId: input.accountId,
    amountCents: signedAmount(input.kind, input.amountCents),
    merchantId: merchant?.id ?? null,
    categoryId,
    transferGroupId: null,
  };
  if (existing) {
    const rows = await tx
      .update(transactions)
      .set(values)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, existing.id)))
      .returning({ id: transactions.id });
    return rows[0] ? ok(rows[0]) : fail(NOT_FOUND);
  }
  const [row] = await tx.insert(transactions).values(values).returning({ id: transactions.id });
  return ok(row!);
}

function mapWriteError(e: unknown): Result<never> {
  if (isForeignKeyViolation(e)) return fail("Compte, catégorie ou magasin introuvable.");
  if (isCheckViolation(e)) return fail("Mouvement invalide.");
  throw e;
}

export async function createTransaction(
  userId: string,
  input: TransactionInput,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  try {
    return await db.transaction((tx) => writeTransaction(userId, input, tx));
  } catch (e) {
    return mapWriteError(e);
  }
}

export async function updateTransaction(
  userId: string,
  id: string,
  input: TransactionInput,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ kind: transactions.kind, transferGroupId: transactions.transferGroupId })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
        .for("update");
      if (!current) return fail(NOT_FOUND);
      if (current.kind === "reimbursement") {
        return fail("Un remboursement se modifie depuis sa créance.");
      }
      if ((current.kind === "transfer") !== (input.kind === "transfer")) {
        return fail("Un virement ne peut pas changer de type : supprimez-le puis recréez-le.");
      }
      return writeTransaction(userId, input, tx, { id, transferGroupId: current.transferGroupId });
    });
  } catch (e) {
    return mapWriteError(e);
  }
}

/** Deletes a transaction (both legs for a transfer). Lines of a receipt cascade. */
export async function deleteTransaction(
  userId: string,
  id: string,
  db: Db = defaultDb,
): Promise<Result> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ kind: transactions.kind, transferGroupId: transactions.transferGroupId })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
      if (!current) return fail(NOT_FOUND);
      // Supprimer un remboursement doit remettre la créance en attente (Sprint 4).
      if (current.kind === "reimbursement") {
        return fail("Un remboursement s'annule depuis sa créance.");
      }
      await tx
        .delete(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            current.transferGroupId
              ? eq(transactions.transferGroupId, current.transferGroupId)
              : eq(transactions.id, id),
          ),
        );
      return ok(undefined);
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return fail(
        "Ce mouvement est lié à un remboursement reçu : annulez d'abord ce remboursement.",
      );
    }
    throw e;
  }
}
