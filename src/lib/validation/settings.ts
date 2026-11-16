import { z } from "zod";
import { parseAmountToCents } from "@/lib/domain/money";

export const ACCOUNT_TYPE_LABELS = {
  checking: "Compte courant",
  savings: "Épargne",
  cash: "Espèces",
  credit_card: "Carte de crédit",
  other: "Autre",
} as const;
export type AccountTypeValue = keyof typeof ACCOUNT_TYPE_LABELS;
const ACCOUNT_TYPE_VALUES = Object.keys(ACCOUNT_TYPE_LABELS) as [
  AccountTypeValue,
  ...AccountTypeValue[],
];

const name = (max: number) =>
  z.string().trim().min(1, "Saisissez un nom.").max(max, `${max} caractères maximum.`);

export const accountInputSchema = z
  .object({
    name: name(60),
    type: z.enum(ACCOUNT_TYPE_VALUES),
    institution: z.string().trim().max(60, "60 caractères maximum."),
    /** Opening balance, may be negative ("-120,50") or empty (0). */
    openingBalance: z.string().trim().max(20),
  })
  .transform((v, ctx) => {
    let openingBalanceCents = 0;
    if (v.openingBalance) {
      // Signe moins typographique (U+2212) ramené au tiret ; le parseur gère un seul signe.
      const cents = parseAmountToCents(v.openingBalance.replace(/−/g, "-"));
      if (cents === null) {
        ctx.addIssue({ code: "custom", path: ["openingBalance"], message: "Montant invalide." });
        return z.NEVER;
      }
      openingBalanceCents = cents;
    }
    return {
      name: v.name,
      type: v.type,
      institution: v.institution || null,
      openingBalanceCents,
    };
  });
export type AccountFormValues = z.input<typeof accountInputSchema>;
export type AccountInput = z.output<typeof accountInputSchema>;

export const CATEGORY_KIND_LABELS = {
  expense: "Dépenses",
  income: "Entrées",
  transfer: "Virements",
} as const;
type CategoryKindValue = keyof typeof CATEGORY_KIND_LABELS;
const CATEGORY_KIND_VALUES = Object.keys(CATEGORY_KIND_LABELS) as [
  CategoryKindValue,
  ...CategoryKindValue[],
];

export const categoryInputSchema = z.object({
  name: name(40),
  kind: z.enum(CATEGORY_KIND_VALUES),
  parentId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => v || null),
});
export type CategoryFormValues = z.input<typeof categoryInputSchema>;
export type CategoryInput = z.output<typeof categoryInputSchema>;

export const categoryDeletionSchema = z.object({
  id: z.uuid(),
  replacementId: z.uuid("Choisissez une catégorie de remplacement."),
});

export const idSchema = z.uuid();
