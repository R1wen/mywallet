"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { MERCHANT_LOGO_MAX_BYTES } from "@/lib/db/schema";
import { detectImageType } from "@/lib/domain/logo";
import { mergeMerchants, setMerchantLogo, updateMerchant } from "@/lib/server/merchants";
import { fail, NOT_FOUND, type Result } from "@/lib/server/result";
import {
  merchantInputSchema,
  merchantMergeSchema,
  type MerchantFormValues,
} from "@/lib/validation/merchant";
import { idSchema } from "@/lib/validation/settings";

/** Merchant directory. Session user only; every input validated (Zod, image signature). */

export async function saveMerchant(id: unknown, values: MerchantFormValues): Promise<Result> {
  const user = await requireUser();
  const merchantId = idSchema.safeParse(id);
  if (!merchantId.success) return fail(NOT_FOUND);
  const parsed = merchantInputSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  const result = await updateMerchant(user.id, merchantId.data, parsed.data);
  if (result.ok) refresh();
  return result;
}

const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"] as const);

export async function uploadMerchantLogo(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const merchantId = idSchema.safeParse(formData.get("merchantId"));
  if (!merchantId.success) return fail(NOT_FOUND);
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return fail("Choisissez une image.");
  if (file.size > MERCHANT_LOGO_MAX_BYTES) return fail("Image trop lourde (256 Ko maximum).");
  const data = Buffer.from(await file.arrayBuffer());
  // Le type déclaré par le navigateur n'est pas fiable : on lit la signature du fichier.
  const type = detectImageType(data);
  if (!type || !UPLOAD_TYPES.has(type as never)) {
    return fail("Format non pris en charge : PNG, JPEG ou WebP.");
  }
  const result = await setMerchantLogo(user.id, merchantId.data, {
    source: "upload",
    data,
    contentType: type as "image/png" | "image/jpeg" | "image/webp",
  });
  if (result.ok) refresh();
  return result;
}

export async function resetMerchantLogo(id: unknown, mode: unknown): Promise<Result> {
  const user = await requireUser();
  const merchantId = idSchema.safeParse(id);
  if (!merchantId.success) return fail(NOT_FOUND);
  const source = mode === "none" ? "none" : "auto";
  const result = await setMerchantLogo(user.id, merchantId.data, { source });
  if (result.ok) refresh();
  return result;
}

export async function mergeMerchantAction(values: {
  targetId: string;
  sourceId: string;
}): Promise<Result> {
  const user = await requireUser();
  const parsed = merchantMergeSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
  const result = await mergeMerchants(user.id, parsed.data.targetId, parsed.data.sourceId);
  if (result.ok) refresh();
  return result;
}
