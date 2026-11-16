"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { archiveAccount, createAccount, updateAccount } from "@/lib/server/accounts";
import { createCategory, deleteCategory, updateCategory } from "@/lib/server/categories";
import { fail, NOT_FOUND, ok, type Result } from "@/lib/server/result";
import {
  accountInputSchema,
  categoryDeletionSchema,
  categoryInputSchema,
  idSchema,
  type AccountFormValues,
  type CategoryFormValues,
} from "@/lib/validation/settings";

/** Accounts and categories. Session user only; every input validated with Zod. */

const firstIssue = (e: { issues: { message: string }[] }) =>
  e.issues[0]?.message ?? "Saisie invalide.";

export async function saveAccount(id: unknown, values: AccountFormValues): Promise<Result> {
  const user = await requireUser();
  const parsed = accountInputSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  let result: Result;
  if (id === null) {
    await createAccount(user.id, parsed.data);
    result = ok(undefined);
  } else {
    const accountId = idSchema.safeParse(id);
    if (!accountId.success) return fail(NOT_FOUND);
    result = await updateAccount(user.id, accountId.data, parsed.data);
  }
  if (result.ok) refresh();
  return result;
}

export async function archiveAccountAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const accountId = idSchema.safeParse(id);
  if (!accountId.success) return fail(NOT_FOUND);
  const done = await archiveAccount(user.id, accountId.data);
  if (!done) return fail(NOT_FOUND);
  refresh();
  return ok(undefined);
}

export async function saveCategory(id: unknown, values: CategoryFormValues): Promise<Result> {
  const user = await requireUser();
  const parsed = categoryInputSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  let result: Result;
  if (id === null) {
    const created = await createCategory(user.id, parsed.data);
    result = created.ok ? ok(undefined) : created;
  } else {
    const categoryId = idSchema.safeParse(id);
    if (!categoryId.success) return fail(NOT_FOUND);
    result = await updateCategory(user.id, categoryId.data, parsed.data);
  }
  if (result.ok) refresh();
  return result;
}

export async function removeCategory(values: {
  id: string;
  replacementId: string;
}): Promise<Result> {
  const user = await requireUser();
  const parsed = categoryDeletionSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const result = await deleteCategory(user.id, parsed.data.id, parsed.data.replacementId);
  if (result.ok) refresh();
  return result;
}
