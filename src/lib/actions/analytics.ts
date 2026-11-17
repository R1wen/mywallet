"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { toParisDateString } from "@/lib/domain/dates";
import { dismissSubscription, trackSubscription } from "@/lib/server/analytics";
import { answerQuestion, type Answer } from "@/lib/server/ask";
import { fail, type Result } from "@/lib/server/result";
import { questionSchema } from "@/lib/validation/ask";

/** Analyses actions: session user first, Zod on every input (ADR-010). */

const keySchema = z.string().min(3).max(300);
const today = () => toParisDateString(new Date());

export async function askAction(question: unknown): Promise<Result<Answer>> {
  const user = await requireUser();
  const parsed = questionSchema.safeParse(question);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Question invalide.");
  return answerQuestion(user.id, parsed.data, today());
}

export async function dismissSubscriptionAction(key: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = keySchema.safeParse(key);
  if (!parsed.success) return fail("Abonnement introuvable.");
  const r = await dismissSubscription(user.id, parsed.data);
  if (r.ok) refresh();
  return r;
}

export async function trackSubscriptionAction(key: unknown): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = keySchema.safeParse(key);
  if (!parsed.success) return fail("Abonnement introuvable.");
  const r = await trackSubscription(user.id, parsed.data, today());
  if (r.ok) refresh();
  return r;
}
