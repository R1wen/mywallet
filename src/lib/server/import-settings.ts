import "server-only";
import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db/client";
import { importSettings, type ReceiptStructurerName } from "@/lib/db/schema";
import { fail, ok, type Result } from "./result";
import { availableStructurers } from "./structurers";

export type ImportSettingsView = {
  structurer: ReceiptStructurerName;
  geminiConsentAt: Date | null;
  available: Record<"ollama" | "gemini", boolean>;
};

export async function getImportSettings(
  userId: string,
  db: Db = defaultDb,
): Promise<ImportSettingsView> {
  const [row] = await db
    .select({
      structurer: importSettings.structurer,
      geminiConsentAt: importSettings.geminiConsentAt,
    })
    .from(importSettings)
    .where(eq(importSettings.userId, userId));
  return {
    structurer: row?.structurer ?? "rules",
    geminiConsentAt: row?.geminiConsentAt ?? null,
    available: availableStructurers(),
  };
}

/**
 * Chooses the fallback structurer. Gemini needs the explicit consent of this user (the
 * free tier may use content to improve Google products); switching away keeps the date
 * of consent only while Gemini stays selected.
 */
export async function saveImportSettings(
  userId: string,
  input: { structurer: ReceiptStructurerName; geminiConsent: boolean },
  db: Db = defaultDb,
): Promise<Result> {
  const available = availableStructurers();
  if (input.structurer !== "rules" && !available[input.structurer]) {
    return fail("Cette option n'est pas configurée sur ce serveur.");
  }
  if (input.structurer === "gemini" && !input.geminiConsent) {
    return fail("Acceptez l'avertissement de confidentialité pour activer Gemini.");
  }
  const geminiConsentAt = input.structurer === "gemini" ? new Date() : null;
  await db
    .insert(importSettings)
    .values({ userId, structurer: input.structurer, geminiConsentAt })
    .onConflictDoUpdate({
      target: importSettings.userId,
      set: { structurer: input.structurer, geminiConsentAt },
    });
  return ok(undefined);
}
