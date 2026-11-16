import { z } from "zod";
import { isValidIsoDay } from "@/lib/domain/dates";
import {
  PAYMENT_METHODS,
  parseFrenchAmount,
  type ParsedReceipt,
} from "@/lib/domain/receipts/parse";

/**
 * JSON a vision model must return (ADR-029). Amounts are strings ("12,50") so no float
 * ever stands for money; they are parsed to cents here and checked again by
 * `validateReceipt`, then by the user.
 */
export const MODEL_RECEIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string", nullable: true },
    date: { type: "string", description: "AAAA-MM-JJ", nullable: true },
    time: { type: "string", description: "HH:MM", nullable: true },
    total: { type: "string", description: "Total TTC payé, ex. 12,50", nullable: true },
    paymentMethod: { type: "string", enum: [...PAYMENT_METHODS], nullable: true },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          quantity: { type: "number" },
          total: { type: "string", description: "Total de la ligne, ex. 2,50" },
        },
        required: ["label", "quantity", "total"],
      },
    },
    discounts: { type: "string", description: "Somme des remises, ex. -1,20", nullable: true },
    vat: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rate: { type: "string", description: "Taux en %, ex. 5,5" },
          base: { type: "string" },
          amount: { type: "string" },
        },
        required: ["rate", "base", "amount"],
      },
    },
    returnDeadline: { type: "string", description: "AAAA-MM-JJ", nullable: true },
    warrantyUntil: { type: "string", description: "AAAA-MM-JJ", nullable: true },
  },
  required: ["merchant", "date", "total", "items"],
} as const;

export const MODEL_PROMPT = `Tu lis un ticket de caisse ou une facture française.
Réponds uniquement avec le JSON demandé. N'invente rien : mets null si une valeur est absente ou illisible.
Montants en texte avec une virgule décimale (ex. "12,50"). Dates au format AAAA-MM-JJ.`;

const day = z
  .string()
  .nullish()
  .transform((v) => (v && isValidIsoDay(v) ? v : null));
const money = (v: string | null | undefined) => (v ? parseFrenchAmount(v) : null);

const modelSchema = z.object({
  merchant: z.string().max(120).nullish(),
  date: day,
  time: z
    .string()
    .nullish()
    .transform((v) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null)),
  total: z.string().max(30).nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullish().catch(null),
  items: z
    .array(
      z.object({
        label: z.string().max(140),
        quantity: z.number().positive().max(10_000).catch(1),
        total: z.string().max(30),
      }),
    )
    .max(200)
    .catch([]),
  discounts: z.string().max(30).nullish(),
  vat: z
    .array(
      z.object({ rate: z.string().max(10), base: z.string().max(30), amount: z.string().max(30) }),
    )
    .max(10)
    .catch([]),
  returnDeadline: day,
  warrantyUntil: day,
});

/** Parses a model answer into a ParsedReceipt; null when it is not usable JSON. */
export function parseModelReceipt(raw: unknown): ParsedReceipt | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const r = modelSchema.safeParse(value);
  if (!r.success) return null;
  const m = r.data;
  const items = m.items.flatMap((i) => {
    const totalCents = money(i.total);
    if (totalCents === null || !i.label.trim()) return [];
    return [
      {
        label: i.label.trim(),
        quantity: i.quantity,
        unitPriceCents: Math.round(totalCents / i.quantity),
        totalCents,
      },
    ];
  });
  const vat = m.vat.flatMap((v) => {
    const rate = Number(v.rate.replace(",", ".").replace("%", ""));
    const baseCents = money(v.base);
    const vatCents = money(v.amount);
    if (!Number.isFinite(rate) || baseCents === null || vatCents === null) return [];
    return [{ rateBp: Math.round(rate * 100), baseCents, vatCents }];
  });
  const totalCents = money(m.total);
  return {
    merchantRaw: m.merchant?.trim() || null,
    date: m.date,
    time: m.time,
    currency: "EUR",
    totalCents: totalCents !== null && totalCents > 0 ? totalCents : null,
    paymentMethod: m.paymentMethod ?? null,
    vat,
    items,
    discountsCents: -Math.abs(money(m.discounts) ?? 0),
    returnDeadline: m.returnDeadline,
    warrantyUntil: m.warrantyUntil,
  };
}
