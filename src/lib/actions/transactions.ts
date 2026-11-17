"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getAccount, listAccounts } from "@/lib/server/accounts";
import { listCategories, type CategoryRow } from "@/lib/server/categories";
import { listMerchantNames } from "@/lib/server/merchants";
import { fail, type Result } from "@/lib/server/result";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  updateTransaction,
  type TransactionDetail,
  type WriteResult,
} from "@/lib/server/transactions";
import { alertsAfterExpense, type BudgetAlert } from "@/lib/server/budgets";
import { proposeRules, type ProposedRule } from "@/lib/server/rules";
import { toParisDateString } from "@/lib/domain/dates";
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

/**
 * Everything the dialog needs in one round trip: form choices and, when editing, the
 * transaction. Archived accounts are listed only when the edited transaction uses them,
 * so editing an old movement never silently moves it to another account.
 */
export async function loadTransactionDialog(editId: unknown): Promise<{
  data: TransactionFormData;
  transaction: TransactionDetail | null;
}> {
  const user = await requireUser();
  const id = editId === null ? null : idSchema.safeParse(editId);
  const [accounts, categories, merchants, transaction] = await Promise.all([
    listAccounts(user.id),
    listCategories(user.id),
    listMerchantNames(user.id),
    id?.success ? getTransaction(user.id, id.data) : Promise.resolve(null),
  ]);
  const options = accounts.map((a) => ({ id: a.id, name: a.name }));
  for (const accountId of [transaction?.accountId, transaction?.toAccountId]) {
    if (!accountId || options.some((o) => o.id === accountId)) continue;
    const archived = await getAccount(user.id, accountId);
    if (archived) options.push({ id: archived.id, name: `${archived.name} (archivé)` });
  }
  return {
    data: {
      accounts: options,
      categories: categories.map(({ id, parentId, name, kind }) => ({ id, parentId, name, kind })),
      merchants: merchants.map((m) => m.name),
    },
    transaction,
  };
}

/** What to tell the user after saving: a rule to learn, budget thresholds crossed. */
export type SaveFeedback = { id: string; proposals: ProposedRule[]; alerts: BudgetAlert[] };

export async function saveTransaction(
  id: unknown,
  values: TransactionFormValues,
): Promise<Result<SaveFeedback>> {
  const user = await requireUser();
  const parsed = transactionInputSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  let result: Result<WriteResult>;
  if (id === null) {
    result = await createTransaction(user.id, parsed.data);
  } else {
    const txId = idSchema.safeParse(id);
    if (!txId.success) return fail("Élément introuvable.");
    result = await updateTransaction(user.id, txId.data, parsed.data);
  }
  if (!result.ok) return result;
  refresh();
  const correction = result.data.correction;
  const [proposals, alerts] = await Promise.all([
    correction ? proposeRules(user.id, [correction]) : Promise.resolve([]),
    // An edit never "crosses" a threshold again: alerts are for new expenses only.
    id === null
      ? alertsAfterExpense(user.id, result.data.id, toParisDateString(new Date()))
      : Promise.resolve([]),
  ]);
  return { ok: true, data: { id: result.data.id, proposals, alerts } };
}

export async function removeTransaction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Élément introuvable.");
  const result = await deleteTransaction(user.id, parsed.data);
  if (result.ok) refresh();
  return result;
}
