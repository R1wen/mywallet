import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { type Conn, db as defaultDb, type Db } from "@/lib/db/client";
import {
  budgets,
  categories,
  categorizationRules,
  merchants,
  recurringRules,
  transactionItems,
  transactions,
} from "@/lib/db/schema";
import { checkCategoryDeletion, checkCategoryParent } from "@/lib/domain/categories";
import type { CategoryInput } from "@/lib/validation/settings";
import { fail, isUniqueViolation, NOT_FOUND, ok, type Result } from "./result";

/** Categories of one user (ADR-021). `userId` always comes from the session. */

export type CategoryRow = {
  id: string;
  parentId: string | null;
  name: string;
  kind: "expense" | "income" | "transfer";
  position: number;
  icon: string | null;
};

export async function listCategories(userId: string, db: Conn = defaultDb): Promise<CategoryRow[]> {
  return db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      kind: categories.kind,
      position: categories.position,
      icon: categories.icon,
    })
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.position), asc(categories.name));
}

const DUPLICATE = "Une catégorie porte déjà ce nom à cet endroit.";

export async function createCategory(
  userId: string,
  input: CategoryInput,
  db: Db = defaultDb,
): Promise<Result<{ id: string }>> {
  const all = await listCategories(userId, db);
  const error = checkCategoryParent(all, { id: null, ...input });
  if (error) return fail(error);
  const siblings = all.filter((c) => c.parentId === input.parentId);
  try {
    const [row] = await db
      .insert(categories)
      .values({
        userId,
        name: input.name,
        kind: input.kind,
        parentId: input.parentId,
        position: siblings.length,
      })
      .returning({ id: categories.id });
    return ok(row!);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(DUPLICATE);
    throw e;
  }
}

/** Renames or moves a category. Its kind cannot change once created (transactions use it). */
export async function updateCategory(
  userId: string,
  id: string,
  input: Pick<CategoryInput, "name" | "parentId">,
  db: Db = defaultDb,
): Promise<Result> {
  const all = await listCategories(userId, db);
  const current = all.find((c) => c.id === id);
  if (!current) return fail(NOT_FOUND);
  const error = checkCategoryParent(all, { id, parentId: input.parentId, kind: current.kind });
  if (error) return fail(error);
  try {
    const rows = await db
      .update(categories)
      .set({ name: input.name, parentId: input.parentId })
      .where(and(eq(categories.userId, userId), eq(categories.id, id)))
      .returning({ id: categories.id });
    return rows.length ? ok(undefined) : fail(NOT_FOUND);
  } catch (e) {
    if (isUniqueViolation(e)) return fail(DUPLICATE);
    throw e;
  }
}

/**
 * Deletes a category after moving everything that uses it to `replacementId`, in one SQL
 * transaction. Budgets of the deleted category are removed (ADR-021).
 */
export async function deleteCategory(
  userId: string,
  id: string,
  replacementId: string,
  db: Db = defaultDb,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const all = await listCategories(userId, tx);
    const error = checkCategoryDeletion(all, id, replacementId);
    if (error) return fail(error);
    const set = { categoryId: replacementId };
    await tx
      .update(transactions)
      .set(set)
      .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, id)));
    await tx
      .update(transactionItems)
      .set(set)
      .where(and(eq(transactionItems.userId, userId), eq(transactionItems.categoryId, id)));
    await tx
      .update(recurringRules)
      .set(set)
      .where(and(eq(recurringRules.userId, userId), eq(recurringRules.categoryId, id)));
    await tx
      .update(categorizationRules)
      .set(set)
      .where(and(eq(categorizationRules.userId, userId), eq(categorizationRules.categoryId, id)));
    await tx
      .update(merchants)
      .set({ defaultCategoryId: replacementId })
      .where(and(eq(merchants.userId, userId), eq(merchants.defaultCategoryId, id)));
    await tx.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.categoryId, id)));
    const rows = await tx
      .delete(categories)
      .where(and(eq(categories.userId, userId), eq(categories.id, id)))
      .returning({ id: categories.id });
    return rows.length ? ok(undefined) : fail(NOT_FOUND);
  });
}
