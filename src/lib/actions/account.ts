"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { requestDeletion } from "@/lib/server/account";
import { fail, ok, type Result } from "@/lib/server/result";

/** Asks for the deletion of my account (ADR-043): password and a typed confirmation. */
const deletionSchema = z.object({
  password: z.string().min(1, "Saisissez votre mot de passe.").max(128),
  confirmation: z.literal("SUPPRIMER", { message: "Tapez SUPPRIMER pour confirmer." }),
});

export async function requestDeletionAction(input: unknown): Promise<Result<{ purgeOn: string }>> {
  const user = await requireUser();
  const parsed = deletionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides.");
  const r = await requestDeletion(user.id, parsed.data.password);
  if (!r.ok) return r;
  return ok({ purgeOn: r.data.purgeAfter.toISOString() });
}
