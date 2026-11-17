import { z } from "zod";
import { ASK_GROUPS, ASK_MEASURES } from "@/lib/domain/ask";

/** A question typed by the user. */
export const questionSchema = z
  .string()
  .trim()
  .min(3, "Posez une question.")
  .max(300, "300 caractères maximum.");

/** JSON the model must return (ADR-040): a small query, never data. */
export const ASK_JSON_SCHEMA = {
  type: "object",
  properties: {
    measure: { type: "string", enum: [...ASK_MEASURES] },
    period: {
      type: "string",
      description: "this_month, last_month, this_year, YYYY-MM, YYYY ou last_N_months",
    },
    category: { type: "string", nullable: true },
    merchant: { type: "string", nullable: true },
    groupBy: { type: "string", enum: [...ASK_GROUPS], nullable: true },
  },
  required: ["measure", "period"],
} as const;

export const modelQuerySchema = z.object({
  measure: z.enum(ASK_MEASURES),
  period: z.string().trim().max(20),
  category: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => v || null),
  merchant: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => v || null),
  groupBy: z
    .enum(ASK_GROUPS)
    .nullish()
    .catch(null)
    .transform((v) => v ?? null),
});
export type ModelQuery = z.output<typeof modelQuerySchema>;

/** Parses the model's answer; null when it is not a usable query. */
export function parseModelQuery(raw: unknown): ModelQuery | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = modelQuerySchema.safeParse(value);
  return r.success ? r.data : null;
}

export function askPrompt(input: {
  today: string;
  categories: string[];
  merchants: string[];
  question: string;
}): string {
  return [
    "Tu traduis une question sur les finances personnelles d'un utilisateur en une requête JSON.",
    "Réponds uniquement avec le JSON demandé, sans calculer ni inventer de montant.",
    'measure : "spent" (dépenses), "income" (revenus) ou "count" (nombre d\'achats).',
    'period : "this_month", "last_month", "this_year", "AAAA-MM", "AAAA" ou "last_N_months" (N de 1 à 24).',
    "category et merchant : un nom exact des listes ci-dessous, ou null.",
    'groupBy : "category", "merchant", "month" ou null.',
    `Aujourd'hui : ${input.today}.`,
    `Catégories : ${input.categories.join(", ")}.`,
    `Magasins : ${input.merchants.join(", ")}.`,
    `Question : ${input.question}`,
  ].join("\n");
}
