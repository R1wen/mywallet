/**
 * Deterministic parser for French till receipts (pure). Input is raw OCR or PDF text;
 * output is a proposal only: it is checked by `validateReceipt` and then by the user
 * before anything is saved (rule 6).
 */
import { daysInMonth, isValidIsoDay } from "../dates";
import { addDaysIso } from "../recurrence";

export const PAYMENT_METHODS = ["card", "cash", "check", "meal_voucher"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ReceiptItem = {
  label: string;
  /** Units, kilograms or litres. */
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

export type ReceiptVat = { rateBp: number; baseCents: number; vatCents: number };

export type ParsedReceipt = {
  merchantRaw: string | null;
  date: string | null;
  time: string | null;
  currency: "EUR";
  totalCents: number | null;
  paymentMethod: PaymentMethod | null;
  vat: ReceiptVat[];
  items: ReceiptItem[];
  /** Sum of discount lines, zero or negative. */
  discountsCents: number;
  returnDeadline: string | null;
  warrantyUntil: string | null;
};

// ---------------------------------------------------------------------------
// Amounts and dates

const AMOUNT_ALONE = /^(-)?(\d{1,3}(?:[ .  ]\d{3})+|\d+)[,.](\d{2})(-)?$/;

/** Parses one amount token ("1 234,56", "3,20-", "0,99 €") to cents, or null. */
export function parseFrenchAmount(input: string): number | null {
  const s = input
    .replace(/€|EUR/gi, "")
    .trim()
    .replace(/\s+(?=-$)/, "");
  const m = AMOUNT_ALONE.exec(s);
  if (!m) return null;
  const units = Number((m[2] ?? "").replace(/\D/g, ""));
  const cents = units * 100 + Number(m[3]);
  return m[1] || m[4] ? -cents : cents;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  janv: 1,
  janvier: 1,
  fev: 2,
  fevr: 2,
  fevrier: 2,
  mar: 3,
  mars: 3,
  avr: 4,
  avril: 4,
  mai: 5,
  juin: 6,
  juil: 7,
  juillet: 7,
  aou: 8,
  aout: 8,
  sep: 9,
  sept: 9,
  septembre: 9,
  oct: 10,
  octobre: 10,
  nov: 11,
  novembre: 11,
  dec: 12,
  decembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function isoDay(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidIsoDay(iso) ? iso : null;
}

const NUMERIC_DATE = /(?<!\d)(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/.-]\d)/;
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const TEXT_DATE = /(?<!\d)(\d{1,2})(?:er)?\s+([a-zé]{3,9})\.?\s+(\d{4})(?!\d)/i;
const ANY_DATE = new RegExp(
  `${ISO_DATE.source}|${NUMERIC_DATE.source.replace("\\2", "\\5")}|${TEXT_DATE.source}`,
  "gi",
);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Parses a single French date expression to ISO, or null. */
export function parseReceiptDate(input: string): string | null {
  const s = input.trim();
  let m = ISO_DATE.exec(s);
  if (m) return isoDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = NUMERIC_DATE.exec(s);
  if (m) return isoDay(Number(m[4]), Number(m[3]), Number(m[1]));
  m = TEXT_DATE.exec(s);
  if (m) {
    const month = MONTHS[stripAccents(m[2] ?? "").toLowerCase()];
    return month ? isoDay(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

function addMonthsIso(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

// ---------------------------------------------------------------------------
// Line helpers

type Amount = { cents: number; start: number; end: number };

const MAX_LINES = 600;
const MAX_LINE_LENGTH = 300;

/** Amounts on a line once dates, times, rates and unit prices are blanked out. */
function findAmounts(line: string): Amount[] {
  const blank = (s: string) => " ".repeat(s.length);
  const cleaned = line
    .replace(ANY_DATE, blank)
    .replace(/\b\d{1,2}[:h]\d{2}(?::\d{2})?\b/gi, blank)
    // Leading lookbehind + bounded digit runs: linear time on long digit strings (ReDoS).
    .replace(/(?<![\d,.])\d{1,7}(?:[,.]\d{1,4})?\s?%/g, blank)
    .replace(/(?<![\d,.])\d{1,7}[,.]\d{1,4}\s*(?:€|EUR)?\s*\/\s*(?:KG|L|U)\b/gi, blank)
    .replace(/(?<![\d,.])\d{1,7}[,.]\d{1,4}\s*(?:KG|L)\b/gi, blank);
  const out: Amount[] = [];
  const re = /(-\s?)?(?<![\d,.])(\d{1,3}(?:\.\d{3}){1,3}|\d{1,9})[,.](\d{2})(?![\d,.]?\d)(\s?-)?/g;
  for (const m of cleaned.matchAll(re)) {
    const units = Number((m[2] ?? "").replace(/\D/g, ""));
    const cents = units * 100 + Number(m[3]);
    out.push({
      cents: m[1] || m[4] ? -cents : cents,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** OCR often reads 0 as O and 1 as l/I inside amounts ("5,O9"). */
function fixAmountGlyphs(line: string): string {
  return line.replace(/(?<![A-Za-z])[\dOoIl]{1,4}[,.][\dOoIl]{2}(?![A-Za-z])/g, (tok) =>
    /\d/.test(tok) ? tok.replace(/[Oo]/g, "0").replace(/[Il]/g, "1") : tok,
  );
}

const key = (line: string) => stripAccents(line).toUpperCase().replace(/\s+/g, " ");

const TOTAL_EXCLUDED =
  /SOUS[ -]?TOTAL|TOTAL (HT|TVA|T\.V\.A|REMISES?|ECONOMIES?|ARTICLES?|POINTS?)|NB ?ART|ECONOMI/;
const TOTAL_STRONG = /NET A PAYER|\bA PAYER\b|TOTAL TTC|MONTANT (A PAYER|TTC|DU)\b|TOTAL A REGLER/;
const TOTAL_WEAK = /\bTOTAL\b/;

function totalPriority(k: string): number {
  if (TOTAL_EXCLUDED.test(k)) return 0;
  if (TOTAL_STRONG.test(k)) return 2;
  if (TOTAL_WEAK.test(k)) return 1;
  return 0;
}

function paymentOf(k: string): PaymentMethod | null {
  if (/TICKETS? RESTAURANT|TITRES? RESTAURANT|\bSWILE\b|\bCONECS\b|\bT\.?R\.? /.test(k)) {
    return "meal_voucher";
  }
  if (/\bCB\b|CARTE|VISA|MASTERCARD|MAESTRO|SANS CONTACT|CONTACTLESS|\bAMEX\b/.test(k)) {
    return "card";
  }
  if (/\bESPECES?\b|\bESP\b|\bCASH\b/.test(k)) return "cash";
  if (/\bCHEQUE\b/.test(k)) return "check";
  return null;
}

const DISCOUNT =
  /REMISE|REDUCTION|\bPROMO|BON (DE )?REDUC|COUPON|AVANTAGE|FIDELITE|\bRIST|\bSOLDES\b/;
const NON_ITEM =
  /TOTAL|\bTVA\b|T\.V\.A|\bHT\b|\bTTC\b|RENDU|MONNAIE|\bPAYER\b|MONTANT|\bCAISSE\b|TICKET|\bTABLE\b|COUVERT|\bTEL\b|SIRET|MERCI|ARTICLES?\b|TRANSACTION|AUTORISATION|\bDEBIT\b|\bCREDIT\b|\bSOLDE\b|\bACOMPTE\b/;
const HEADER_NOISE =
  /^(TICKET|FACTURE|BIENVENUE|BONJOUR|WELCOME|SIRET|TEL\b|N[°O] |TVA INTRA|DUPLICATA|COPIE)/;
const FUEL =
  /(?<![\d,.])(\d{1,4}[,.]\d{2,3})\s*L\s*[X*]\s*(\d{1,3}[,.]\d{2,3})\s*(?:€|EUR)?\s*\/\s*L/;
const FUEL_NAME = /\b(SP ?9[58](?:[- ]?E\d{1,2})?|E10|E85|GAZOLE|GASOIL|DIESEL|GPL|B7|SUPER)\b/;
const WEIGHT =
  /(?<![\d,.])(\d{1,4}[,.]\d{1,3})\s*KG\s*[X*]\s*(\d{1,5}[,.]\d{2})\s*(?:€|EUR)?\s*\/\s*KG/;
const QTY = /(?<![\d,.])(\d{1,3}(?:[,.]\d{1,3})?)\s*[X*]\s*(\d{1,6}[,.]\d{2})(?![\d])/;
const LEADING_QTY = /^(\d{1,2})\s*[X*]?\s+(\D.*)$/i;

const decimal = (s: string) => Number(s.replace(",", "."));
const roundCents = (n: number) => Math.round(n);

function cleanLabel(s: string): string {
  return s
    .replace(/[€*=_|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+[A-Z0-9]$/, (m) => (/\d/.test(m) ? m : ""))
    .trim();
}

function hasLetters(s: string, min = 2): boolean {
  return (s.match(/\p{L}/gu) ?? []).length >= min;
}

// ---------------------------------------------------------------------------
// VAT

function parseVatLine(line: string, k: string): { rateBp: number; amounts: number[] } | null {
  const rate = /(\d{1,2}(?:[,.]\d{1,2})?)\s?%/.exec(line);
  if (!rate) return null;
  const keyword = /TVA|T\.V\.A|\bHT\b/.test(k);
  // VAT table row without the word "TVA": optional code letter, then the rate first.
  const tableRow = /^([A-Z0-9]{1,2}\s+)?\d{1,2}(?:[,.]\d{1,2})?\s?%/.test(k.trim());
  if (!keyword && !tableRow) return null;
  const rateBp = Math.round(decimal(rate[1] ?? "") * 100);
  if (rateBp <= 0 || rateBp > 3000) return null;
  const amounts = findAmounts(line).map((a) => Math.abs(a.cents));
  if (!keyword && amounts.length < 2) return null;
  return { rateBp, amounts };
}

function vatFromAmounts(
  rateBp: number,
  amounts: number[],
): ReceiptVat | { rateBp: number; vatCents: number } | null {
  const fits = (base: number, vat: number) =>
    Math.abs(Math.round((base * rateBp) / 10_000) - vat) <= 2;
  for (let i = 0; i < amounts.length; i++) {
    for (let j = 0; j < amounts.length; j++) {
      const base = amounts[i] ?? 0;
      const vat = amounts[j] ?? 0;
      if (i === j || vat === 0 || vat >= base) continue;
      if (fits(base, vat)) return { rateBp, baseCents: base, vatCents: vat };
      if (fits(base - vat, vat)) return { rateBp, baseCents: base - vat, vatCents: vat };
    }
  }
  if (amounts.length === 1) return { rateBp, vatCents: amounts[0] ?? 0 };
  return null;
}

// ---------------------------------------------------------------------------
// Main

/** Parses OCR or PDF text of a French receipt. Never throws. */
export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .normalize("NFC")
    .split(/\r?\n/)
    // Real receipt lines are short: bounding them keeps every regex cheap on hostile input.
    .slice(0, MAX_LINES)
    .map((l) => l.slice(0, MAX_LINE_LENGTH))
    .map((l) =>
      fixAmountGlyphs(
        l
          .replace(/\t/g, "  ")
          // Some OCR engines glue the time to the date: "25/10/202614:52".
          .replace(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})(\d{1,2}[:h]\d{2})/g, "$1 $2")
          .trim(),
      ),
    )
    .filter((l) => l.length > 0);
  const keys = lines.map(key);

  // Merchant: the first meaningful header line.
  let merchantIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const l = lines[i] ?? "";
    const k = keys[i] ?? "";
    if (!hasLetters(l, 3) || HEADER_NOISE.test(k) || findAmounts(l).length) continue;
    if (parseReceiptDate(l)) continue;
    merchantIndex = i;
    break;
  }
  const merchantRaw = merchantIndex >= 0 ? (lines[merchantIndex] ?? "").replace(/\s+/g, " ") : null;

  // Date and time: first date outside deadline / card expiry lines.
  let date: string | null = null;
  let time: string | null = null;
  for (let i = 0; i < lines.length && !date; i++) {
    const k = keys[i] ?? "";
    if (/EXP|VALID|JUSQU|RETOUR|GARANTIE|ECHANGE|AVANT LE|NAISSANCE/.test(k)) continue;
    for (const m of (lines[i] ?? "").matchAll(ANY_DATE)) {
      const iso = parseReceiptDate(m[0]);
      if (iso) {
        date = iso;
        const t = /\b([01]?\d|2[0-3])[:hH]([0-5]\d)\b/.exec(lines[i] ?? "");
        if (t) time = `${pad(Number(t[1]))}:${t[2]}`;
        break;
      }
    }
  }
  if (!time) {
    for (const l of lines) {
      const t = /\b([01]?\d|2[0-3])[:hH]([0-5]\d)\b/.exec(l);
      if (t && !findAmounts(l).length) {
        time = `${pad(Number(t[1]))}:${t[2]}`;
        break;
      }
    }
  }

  // Total: strongest "total" line, last amount on it.
  let totalIndex = -1;
  let totalCents: number | null = null;
  let best = 0;
  keys.forEach((k, i) => {
    const p = totalPriority(k);
    const amounts = findAmounts(lines[i] ?? "");
    const last = amounts[amounts.length - 1];
    if (p > best && last && last.cents > 0) {
      best = p;
      totalIndex = i;
      totalCents = last.cents;
    }
  });

  // Payment method and fallback total.
  let paymentMethod: PaymentMethod | null = null;
  let paymentIndex = -1;
  let cardAmount: number | null = null;
  keys.forEach((k, i) => {
    if (/RENDU|MONNAIE/.test(k)) return;
    const method = paymentOf(k);
    if (!method) return;
    if (!paymentMethod) {
      paymentMethod = method;
      paymentIndex = i;
    }
    const amounts = findAmounts(lines[i] ?? "");
    const last = amounts[amounts.length - 1];
    if (method !== "cash" && cardAmount === null && last && last.cents > 0) cardAmount = last.cents;
  });
  if (totalCents === null && cardAmount !== null) totalCents = cardAmount;

  // VAT lines.
  const vatRaw: (ReceiptVat | { rateBp: number; vatCents: number })[] = [];
  const vatLines = new Set<number>();
  keys.forEach((k, i) => {
    const parsed = parseVatLine(lines[i] ?? "", k);
    if (!parsed) return;
    vatLines.add(i);
    const v = vatFromAmounts(parsed.rateBp, parsed.amounts);
    if (v && !vatRaw.some((x) => x.rateBp === v.rateBp && x.vatCents === v.vatCents))
      vatRaw.push(v);
  });
  const vat: ReceiptVat[] = [];
  for (const v of vatRaw) {
    if ("baseCents" in v) vat.push(v);
    else if (vatRaw.length === 1 && totalCents !== null && totalCents > v.vatCents) {
      vat.push({ rateBp: v.rateBp, baseCents: totalCents - v.vatCents, vatCents: v.vatCents });
    }
  }

  // Items and discounts, above the total (or above the payment line).
  const end = totalIndex >= 0 ? totalIndex : paymentIndex >= 0 ? paymentIndex : lines.length;
  const items: ReceiptItem[] = [];
  let discountsCents = 0;
  let pendingLabel: string | null = null;
  let pendingFuel: string | null = null;
  /** Quantity line printed before its label ("2 x 1,10  2,20" then "CROISSANT"). */
  let pendingItem: Omit<ReceiptItem, "label"> | null = null;

  for (let i = merchantIndex + 1; i < end; i++) {
    const line = lines[i] ?? "";
    const k = keys[i] ?? "";
    if (vatLines.has(i)) continue;
    const fuelName = FUEL_NAME.exec(k);
    if (fuelName) pendingFuel = fuelName[1] ?? null;

    const fuel = FUEL.exec(k);
    if (fuel) {
      const quantity = decimal(fuel[1] ?? "");
      const unit = decimal(fuel[2] ?? "") * 100;
      const amounts = findAmounts(line);
      const totalOnLine = amounts[amounts.length - 1]?.cents;
      const prev = items[items.length - 1];
      if (totalOnLine === undefined && prev && prev.totalCents === roundCents(quantity * unit)) {
        // Litres line under "GAZOLE 68,95": detail of that item.
        prev.quantity = quantity;
        prev.unitPriceCents = roundCents(unit);
        pendingLabel = null;
        continue;
      }
      const label = pendingFuel ?? "Carburant";
      const original = /[A-Z0-9-]+/i.exec(
        line.slice(line.toUpperCase().indexOf(label.replace(" ", ""))),
      )?.[0];
      items.push({
        label: original && key(original) === label ? original : label,
        quantity,
        unitPriceCents: roundCents(unit),
        totalCents: totalOnLine ?? roundCents(quantity * unit),
      });
      pendingLabel = null;
      continue;
    }

    const amounts = findAmounts(line);
    if (!amounts.length) {
      if (DISCOUNT.test(k) || NON_ITEM.test(k) || !hasLetters(line)) pendingLabel = null;
      else if (pendingItem) {
        items.push({ label: cleanLabel(line), ...pendingItem });
        pendingItem = null;
      } else if (!FUEL_NAME.test(k)) pendingLabel = cleanLabel(line);
      continue;
    }
    const last = amounts[amounts.length - 1] as Amount;

    if (DISCOUNT.test(k) && !/TOTAL|ECONOMI|VOUS AVEZ/.test(k)) {
      discountsCents -= Math.abs(last.cents);
      pendingLabel = null;
      continue;
    }
    if (NON_ITEM.test(k) || paymentOf(k)) {
      pendingLabel = null;
      continue;
    }
    if (last.cents < 0) {
      // Negative line without the word "remise" ("Livraison offerte -3,99"): a discount.
      discountsCents += last.cents;
      pendingLabel = null;
      continue;
    }

    const weight = WEIGHT.exec(k);
    const qty = weight ? null : QTY.exec(k);
    const before = line.slice(0, (weight ?? qty)?.index ?? amounts[0]?.start ?? 0);
    let label = cleanLabel(before);
    if (!hasLetters(label)) label = pendingLabel ?? "";
    pendingLabel = null;
    // "2 x 0,85" alone under an item: detail of that item (its total = quantity x price).
    if ((weight || qty) && amounts.length === 1 && !hasLetters(cleanLabel(before))) {
      const m = (weight ?? qty)!;
      const quantity = decimal(m[1] ?? "");
      const unitPriceCents = roundCents(decimal(m[2] ?? "") * 100);
      const totalCents = roundCents(quantity * unitPriceCents);
      const prev = items[items.length - 1];
      if (!label && prev && prev.totalCents === totalCents) {
        prev.quantity = quantity;
        prev.unitPriceCents = unitPriceCents;
      } else if (label) {
        items.push({ label, quantity, unitPriceCents, totalCents });
      } else {
        pendingItem = { quantity, unitPriceCents, totalCents };
      }
      continue;
    }
    if (!label) {
      if (weight || qty) {
        const m = (weight ?? qty)!;
        pendingItem = {
          quantity: decimal(m[1] ?? ""),
          unitPriceCents: roundCents(decimal(m[2] ?? "") * 100),
          totalCents: last.cents,
        };
      }
      continue;
    }

    if (weight) {
      items.push({
        label,
        quantity: decimal(weight[1] ?? ""),
        unitPriceCents: roundCents(decimal(weight[2] ?? "") * 100),
        totalCents: last.cents,
      });
      continue;
    }
    if (qty) {
      items.push({
        label,
        quantity: decimal(qty[1] ?? ""),
        unitPriceCents: roundCents(decimal(qty[2] ?? "") * 100),
        totalCents: last.cents,
      });
      continue;
    }
    const lead = LEADING_QTY.exec(label);
    if (lead && Number(lead[1]) > 0) {
      const quantity = Number(lead[1]);
      items.push({
        label: cleanLabel(lead[2] ?? ""),
        quantity,
        unitPriceCents: roundCents(last.cents / quantity),
        totalCents: last.cents,
      });
      continue;
    }
    items.push({ label, quantity: 1, unitPriceCents: last.cents, totalCents: last.cents });
  }

  // A quantity line whose label was never read still counts toward the sum.
  if (pendingItem) items.push({ label: "Article", ...pendingItem });

  // Return and warranty deadlines.
  let returnDeadline: string | null = null;
  let warrantyUntil: string | null = null;
  keys.forEach((k, i) => {
    const line = lines[i] ?? "";
    const explicit = [...line.matchAll(ANY_DATE)].map((m) => parseReceiptDate(m[0])).find(Boolean);
    const duration = /(\d{1,3})\s*(JOURS?|J\b|MOIS|ANS?)\b/.exec(k);
    const from = (n: number, unit: string) => {
      if (!date) return null;
      if (unit.startsWith("J")) return addDaysIso(date, n);
      return addMonthsIso(date, unit.startsWith("M") ? n : n * 12);
    };
    if (/RETOUR|ECHANGE|REMBOURS/.test(k) && !returnDeadline) {
      if (explicit && /JUSQU|AVANT|AU /.test(k)) returnDeadline = explicit;
      else if (duration) returnDeadline = from(Number(duration[1]), duration[2] ?? "");
    }
    if (/GARANTI/.test(k) && !warrantyUntil) {
      if (explicit && /JUSQU|AVANT|AU /.test(k)) warrantyUntil = explicit;
      else if (duration) warrantyUntil = from(Number(duration[1]), duration[2] ?? "");
    }
  });

  return {
    merchantRaw,
    date,
    time,
    currency: "EUR",
    totalCents,
    paymentMethod,
    vat,
    items,
    discountsCents,
    returnDeadline,
    warrantyUntil,
  };
}
