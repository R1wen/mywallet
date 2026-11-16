import { z } from "zod";
import { normalizeDomain, normalizeMerchantName } from "@/lib/domain/merchant";

export const merchantInputSchema = z
  .object({
    name: z.string().trim().min(1, "Saisissez un nom.").max(80, "80 caractères maximum."),
    domain: z.string().trim().max(253, "Domaine trop long."),
    defaultCategoryId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((v) => v || null),
    /** One raw alias per line, as printed on tickets or bank statements. */
    aliases: z.string().max(2000, "Trop d'alias."),
  })
  .transform((v, ctx) => {
    const normalizedName = normalizeMerchantName(v.name);
    if (!normalizedName) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Nom invalide." });
      return z.NEVER;
    }
    let domain: string | null = null;
    if (v.domain) {
      domain = normalizeDomain(v.domain);
      if (!domain) {
        ctx.addIssue({
          code: "custom",
          path: ["domain"],
          message: "Domaine invalide (ex. fnac.com).",
        });
        return z.NEVER;
      }
    }
    const aliases = [
      ...new Set(v.aliases.split(/\r?\n/).map(normalizeMerchantName).filter(Boolean)),
    ]
      .filter((a) => a !== normalizedName)
      .sort();
    if (aliases.length > 30) {
      ctx.addIssue({ code: "custom", path: ["aliases"], message: "30 alias maximum." });
      return z.NEVER;
    }
    return {
      name: v.name,
      normalizedName,
      domain,
      defaultCategoryId: v.defaultCategoryId,
      aliases,
    };
  });
export type MerchantFormValues = z.input<typeof merchantInputSchema>;
export type MerchantInput = z.output<typeof merchantInputSchema>;

export const merchantMergeSchema = z.object({
  targetId: z.uuid(),
  sourceId: z.uuid("Choisissez le magasin à fusionner."),
});

export const MERCHANT_SORTS = ["depense", "achats", "recent", "nom"] as const;
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export const merchantFiltersSchema = z.object({
  q: z.preprocess(first, z.string().trim().max(100).optional().catch(undefined)),
  tri: z.preprocess(first, z.enum(MERCHANT_SORTS).catch("depense")),
  /** "tous" shows catalogue merchants without purchases too. */
  vue: z.preprocess(first, z.enum(["actifs", "tous"]).catch("actifs")),
});
export type MerchantFilters = z.output<typeof merchantFiltersSchema>;
