"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { toParisDateString } from "@/lib/domain/dates";
import { getAccount, listAccounts } from "@/lib/server/accounts";
import { listCategories, type CategoryRow } from "@/lib/server/categories";
import { listMerchantNames } from "@/lib/server/merchants";
import {
  confirmOccurrence,
  createRule,
  deleteRule,
  getRule,
  setOccurrenceSkipped,
  unconfirmOccurrence,
  updateRule,
} from "@/lib/server/recurring";
import { fail, type Result } from "@/lib/server/result";
import {
  occurrenceConfirmSchema,
  recurringRuleInputSchema,
  type OccurrenceConfirmValues,
  type RecurringRuleFormValues,
} from "@/lib/validation/recurring";
import { idSchema } from "@/lib/validation/settings";

/**
 * Recurring rules and occurrences. Each action reads the user from the session, validates
 * its input with Zod, then calls a repository filtered by that user.
 */

const today = () => toParisDateString(new Date());

export type RecurringFormData = {
  accounts: { id: string; name: string; type: string }[];
  categories: Pick<CategoryRow, "id" | "parentId" | "name" | "kind">[];
  merchants: string[];
};

export type RuleDetail = NonNullable<Awaited<ReturnType<typeof getRule>>>;

export async function loadRuleDialog(editId: unknown): Promise<{
  data: RecurringFormData;
  rule: RuleDetail | null;
}> {
  const user = await requireUser();
  const id = editId === null ? null : idSchema.safeParse(editId);
  const [accounts, categories, merchants, rule] = await Promise.all([
    listAccounts(user.id),
    listCategories(user.id),
    listMerchantNames(user.id),
    id?.success ? getRule(user.id, id.data) : Promise.resolve(null),
  ]);
  const options = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }));
  for (const accountId of [rule?.accountId, rule?.toAccountId]) {
    if (!accountId || options.some((o) => o.id === accountId)) continue;
    const archived = await getAccount(user.id, accountId);
    if (archived) {
      options.push({ id: archived.id, name: `${archived.name} (archivé)`, type: archived.type });
    }
  }
  return {
    data: {
      accounts: options,
      categories: categories.map(({ id, parentId, name, kind }) => ({ id, parentId, name, kind })),
      merchants: merchants.map((m) => m.name),
    },
    rule,
  };
}

export async function saveRule(
  id: unknown,
  values: RecurringRuleFormValues,
): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = recurringRuleInputSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  let result: Result<{ id: string }>;
  if (id === null) {
    result = await createRule(user.id, parsed.data, today());
  } else {
    const ruleId = idSchema.safeParse(id);
    if (!ruleId.success) return fail("Élément introuvable.");
    result = await updateRule(user.id, ruleId.data, parsed.data, today());
  }
  if (result.ok) refresh();
  return result;
}

export async function removeRule(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Élément introuvable.");
  const result = await deleteRule(user.id, parsed.data);
  if (result.ok) refresh();
  return result;
}

export async function validateOccurrence(
  id: unknown,
  values: OccurrenceConfirmValues,
): Promise<Result<{ transactionId: string }>> {
  const user = await requireUser();
  const occurrenceId = idSchema.safeParse(id);
  if (!occurrenceId.success) return fail("Élément introuvable.");
  const parsed = occurrenceConfirmSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  const result = await confirmOccurrence(user.id, occurrenceId.data, parsed.data);
  if (result.ok) refresh();
  return result;
}

export async function skipOccurrence(id: unknown, skipped: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || typeof skipped !== "boolean") return fail("Élément introuvable.");
  const result = await setOccurrenceSkipped(user.id, parsed.data, skipped);
  if (result.ok) refresh();
  return result;
}

export async function cancelOccurrenceValidation(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Élément introuvable.");
  const result = await unconfirmOccurrence(user.id, parsed.data);
  if (result.ok) refresh();
  return result;
}
