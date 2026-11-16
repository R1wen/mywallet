"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { listAccounts } from "@/lib/server/accounts";
import { listCategories, type CategoryRow } from "@/lib/server/categories";
import { listMerchantNames } from "@/lib/server/merchants";
import { fail, type Result } from "@/lib/server/result";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  updateTransaction,
  type TransactionDetail,
} from "@/lib/server/transactions";
import { idSchema } from "@/lib/validation/settings";
import { transactionInputSchema, type TransactionFormValues } from "@/lib/validation/transaction";

/**
 * Server actions are public POST endpoints: each one reads the user from the session,
 * validates its input with Zod and only then calls a repository filtered by that user.
 */

export type TransactionFormData = {
  accounts: { id: string; name: string }[];
  categories: Pick<CategoryRow, "id" | "parentId" | "name" | "kind">[];
  merchants: string[];
};

export async function loadTransactionFormData(): Promise<TransactionFormData> {
  const user = await requireUser();
  const [accounts, categories, merchants] = await Promise.all([
    listAccounts(user.id),
    listCategories(user.id),
    listMerchantNames(user.id),
  ]);
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map(({ id, parentId, name, kind }) => ({ id, parentId, name, kind })),
    merchants: merchants.map((m) => m.name),
  };
}

export async function loadTransaction(id: unknown): Promise<TransactionDetail | null> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  return parsed.success ? getTransaction(user.id, parsed.data) : null;
}

export async function saveTransaction(
  id: unknown,
  values: TransactionFormValues,
): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = transactionInputSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  let result: Result<{ id: string }>;
  if (id === null) {
    result = await createTransaction(user.id, parsed.data);
  } else {
    const txId = idSchema.safeParse(id);
    if (!txId.success) return fail("Élément introuvable.");
    result = await updateTransaction(user.id, txId.data, parsed.data);
  }
  if (result.ok) refresh();
  return result;
}

export async function removeTransaction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Élément introuvable.");
  const result = await deleteTransaction(user.id, parsed.data);
  if (result.ok) refresh();
  return result;
}
