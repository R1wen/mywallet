"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { listAccounts } from "@/lib/server/accounts";
import { fail, type Result } from "@/lib/server/result";
import {
  applyClaimAction,
  cancelPayment,
  createPerson,
  deletePerson,
  getShareState,
  listPersonOptions,
  recordPayment,
  saveShares,
  setPersonArchived,
  updatePerson,
  type PersonOption,
  type ShareState,
} from "@/lib/server/sharing";
import { idSchema } from "@/lib/validation/settings";
import {
  claimActionSchema,
  paymentInputSchema,
  personInputSchema,
  saveSharesSchema,
} from "@/lib/validation/sharing";

/**
 * Cost sharing actions. Each one reads the user from the session, validates its input
 * with Zod, then calls a repository filtered by that user (ADR-010).
 */

const INVALID = "Données invalides.";

export async function createPersonAction(input: unknown): Promise<Result<PersonOption>> {
  const user = await requireUser();
  const parsed = personInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? INVALID);
  const r = await createPerson(user.id, parsed.data);
  if (r.ok) refresh();
  return r;
}

export async function updatePersonAction(id: unknown, input: unknown): Promise<Result> {
  const user = await requireUser();
  const pid = idSchema.safeParse(id);
  const parsed = personInputSchema.safeParse(input);
  if (!pid.success || !parsed.success) {
    return fail(parsed.error?.issues[0]?.message ?? INVALID);
  }
  const r = await updatePerson(user.id, pid.data, parsed.data);
  if (r.ok) refresh();
  return r;
}

export async function archivePersonAction(id: unknown, archived: unknown): Promise<Result> {
  const user = await requireUser();
  const pid = idSchema.safeParse(id);
  const flag = z.boolean().safeParse(archived);
  if (!pid.success || !flag.success) return fail(INVALID);
  const r = await setPersonArchived(user.id, pid.data, flag.data);
  if (r.ok) refresh();
  return r;
}

export async function deletePersonAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const pid = idSchema.safeParse(id);
  if (!pid.success) return fail(INVALID);
  const r = await deletePerson(user.id, pid.data);
  if (r.ok) refresh();
  return r;
}

/** What the share dialog needs: the expense, its lines, current claims and my people. */
export async function loadShareDialog(
  transactionId: unknown,
): Promise<{ state: ShareState; people: PersonOption[] } | null> {
  const user = await requireUser();
  const id = idSchema.safeParse(transactionId);
  if (!id.success) return null;
  const [state, people] = await Promise.all([
    getShareState(user.id, id.data),
    listPersonOptions(user.id),
  ]);
  return state ? { state, people } : null;
}

export async function saveSharesAction(input: unknown): Promise<Result<{ claims: number }>> {
  const user = await requireUser();
  const parsed = saveSharesSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? INVALID);
  const { transactionId, ...shares } = parsed.data;
  const r = await saveShares(user.id, transactionId, shares);
  if (r.ok) refresh();
  return r;
}

/** Accounts the reimbursement can land on. */
export async function loadPaymentAccounts(): Promise<{ id: string; name: string }[]> {
  const user = await requireUser();
  return (await listAccounts(user.id)).map((a) => ({ id: a.id, name: a.name }));
}

export async function recordPaymentAction(
  input: unknown,
): Promise<Result<{ transactionId: string }>> {
  const user = await requireUser();
  const parsed = paymentInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? INVALID);
  const r = await recordPayment(user.id, parsed.data);
  if (r.ok) refresh();
  return r;
}

export async function cancelPaymentAction(transactionId: unknown): Promise<Result> {
  const user = await requireUser();
  const id = idSchema.safeParse(transactionId);
  if (!id.success) return fail(INVALID);
  const r = await cancelPayment(user.id, id.data);
  if (r.ok) refresh();
  return r;
}

export async function claimAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = claimActionSchema.safeParse(input);
  if (!parsed.success) return fail(INVALID);
  const r = await applyClaimAction(user.id, parsed.data.claimId, parsed.data.action);
  if (r.ok) refresh();
  return r;
}
