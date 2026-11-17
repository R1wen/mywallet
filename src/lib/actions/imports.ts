"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { toParisDateString } from "@/lib/domain/dates";
import {
  commitBankImport,
  previewBankImport,
  type BankPreview,
  type ImportSummary,
} from "@/lib/server/bank-import";
import { saveImportSettings } from "@/lib/server/import-settings";
import {
  confirmReceipt,
  createReceipt,
  deleteReceipt,
  markProcessing,
  rejectReceipt,
  reopenReceipt,
  saveExtraction,
  type UploadedReceipt,
} from "@/lib/server/receipts";
import { alertsAfterExpense, type BudgetAlert } from "@/lib/server/budgets";
import { fail, ok, type Result } from "@/lib/server/result";
import { proposeRules, type ProposedRule } from "@/lib/server/rules";
import {
  bankCommitSchema,
  bankPreviewSchema,
  extractionInputSchema,
  importSettingsSchema,
  receiptReviewSchema,
} from "@/lib/validation/imports";
import { idSchema } from "@/lib/validation/settings";

/**
 * Import actions. Each is a public POST endpoint: user from the session, Zod on every
 * input, repositories filtered by that user. Files are re-checked by their bytes on the
 * server whatever the browser claims.
 */

const today = () => toParisDateString(new Date());
const firstIssue = (e: { issues: { message: string }[] }) =>
  e.issues[0]?.message ?? "Données invalides.";

export async function uploadReceipt(form: FormData): Promise<Result<UploadedReceipt>> {
  const user = await requireUser();
  const file = form.get("file");
  const thumb = form.get("thumbnail");
  if (!(file instanceof File)) return fail("Aucun fichier reçu.");
  const data = new Uint8Array(await file.arrayBuffer());
  const thumbnail =
    thumb instanceof File && thumb.size ? new Uint8Array(await thumb.arrayBuffer()) : null;
  return createReceipt(user.id, { data, filename: file.name, thumbnail });
}

export async function startReading(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Ticket introuvable.");
  return markProcessing(user.id, parsed.data);
}

export async function submitOcr(input: unknown): Promise<Result<{ status: string }>> {
  const user = await requireUser();
  const parsed = extractionInputSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await saveExtraction(user.id, parsed.data, today());
  if (r.ok) refresh();
  return r;
}

export async function validateReceipt(
  id: unknown,
  values: unknown,
): Promise<Result<{ transactionId: string; proposals: ProposedRule[]; alerts: BudgetAlert[] }>> {
  const user = await requireUser();
  const receiptId = idSchema.safeParse(id);
  if (!receiptId.success) return fail("Ticket introuvable.");
  const parsed = receiptReviewSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await confirmReceipt(user.id, receiptId.data, parsed.data);
  if (!r.ok) return r;
  refresh();
  const [proposals, alerts] = await Promise.all([
    proposeRules(user.id, r.data.corrections),
    alertsAfterExpense(user.id, r.data.transactionId, toParisDateString(new Date())),
  ]);
  return { ok: true, data: { transactionId: r.data.transactionId, proposals, alerts } };
}

async function simple(id: unknown, run: (userId: string, id: string) => Promise<Result>) {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Ticket introuvable.");
  const r = await run(user.id, parsed.data);
  if (r.ok) refresh();
  return r;
}

export async function rejectReceiptAction(id: unknown): Promise<Result> {
  return simple(id, (u, i) => rejectReceipt(u, i));
}

export async function reopenReceiptAction(id: unknown): Promise<Result> {
  return simple(id, (u, i) => reopenReceipt(u, i));
}

export async function deleteReceiptAction(id: unknown): Promise<Result> {
  return simple(id, (u, i) => deleteReceipt(u, i));
}

export async function previewBankImportAction(input: unknown): Promise<Result<BankPreview>> {
  const user = await requireUser();
  const parsed = bankPreviewSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await previewBankImport(user.id, parsed.data);
  if (!r.ok) return r;
  // Line keys stay on the server: the commit recomputes everything from the file.
  const { keys: _keys, openClaims: _open, ...preview } = r.data;
  return ok(preview);
}

export async function commitBankImportAction(input: unknown): Promise<Result<ImportSummary>> {
  const user = await requireUser();
  const parsed = bankCommitSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await commitBankImport(user.id, parsed.data);
  if (r.ok) refresh();
  return r;
}

export async function saveImportSettingsAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = importSettingsSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await saveImportSettings(user.id, parsed.data);
  if (r.ok) refresh();
  return r;
}
