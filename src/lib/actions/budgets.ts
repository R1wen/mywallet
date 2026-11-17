"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { toParisDateString } from "@/lib/domain/dates";
import {
  archiveGoal,
  contributeToGoal,
  createBudget,
  createGoal,
  deleteBudget,
  updateBudget,
  updateGoal,
} from "@/lib/server/budgets";
import { db } from "@/lib/db/client";
import { Abort, abortedResult, fail, type Result } from "@/lib/server/result";
import { deleteRule, saveRule, setRuleActive } from "@/lib/server/rules";
import {
  budgetInputSchema,
  contributionSchema,
  goalInputSchema,
  ruleInputSchema,
} from "@/lib/validation/budgets";
import { idSchema } from "@/lib/validation/settings";

/**
 * Budgets, goals and categorization rules. Each action reads the user from the session,
 * validates its input with Zod, then calls a repository filtered by that user.
 */

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Données invalides.";
const today = () => toParisDateString(new Date());

async function done<T>(r: Promise<Result<T>>): Promise<Result<T>> {
  const result = await r;
  if (result.ok) refresh();
  return result;
}

export async function saveBudgetAction(id: unknown, values: unknown): Promise<Result<unknown>> {
  const user = await requireUser();
  const parsed = budgetInputSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (id === null) return done(createBudget(user.id, parsed.data, today()));
  const budgetId = idSchema.safeParse(id);
  if (!budgetId.success) return fail("Budget introuvable.");
  return done(updateBudget(user.id, budgetId.data, parsed.data, today()));
}

export async function deleteBudgetAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Budget introuvable.");
  return done(deleteBudget(user.id, parsed.data));
}

export async function saveGoalAction(id: unknown, values: unknown): Promise<Result<unknown>> {
  const user = await requireUser();
  const parsed = goalInputSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  if (id === null) return done(createGoal(user.id, parsed.data));
  const goalId = idSchema.safeParse(id);
  if (!goalId.success) return fail("Objectif introuvable.");
  return done(updateGoal(user.id, goalId.data, parsed.data));
}

export async function contributeAction(values: unknown): Promise<Result<{ savedCents: number }>> {
  const user = await requireUser();
  const parsed = contributionSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  return done(contributeToGoal(user.id, parsed.data.goalId, parsed.data.amount));
}

export async function archiveGoalAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Objectif introuvable.");
  return done(archiveGoal(user.id, parsed.data));
}

/** Saves rules the user confirmed ("Toujours classer … dans … ?"). */
export async function saveRulesAction(values: unknown): Promise<Result<{ count: number }>> {
  const user = await requireUser();
  const parsed = z.array(ruleInputSchema).min(1).max(50).safeParse(values);
  if (!parsed.success) return fail("Règle invalide.");
  try {
    // All or nothing: a batch is never half-saved.
    await db.transaction(async (tx) => {
      for (const rule of parsed.data) {
        const r = await saveRule(user.id, rule, tx);
        if (!r.ok) throw new Abort(r);
      }
    });
  } catch (e) {
    const aborted = abortedResult(e);
    if (aborted) return aborted;
    throw e;
  }
  refresh();
  return { ok: true, data: { count: parsed.data.length } };
}

export async function deleteRuleAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail("Règle introuvable.");
  return done(deleteRule(user.id, parsed.data));
}

export async function setRuleActiveAction(id: unknown, active: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = idSchema.safeParse(id);
  const flag = z.boolean().safeParse(active);
  if (!parsed.success || !flag.success) return fail("Règle introuvable.");
  return done(setRuleActive(user.id, parsed.data, flag.data));
}
