/** Merchant name helpers (pure). Full alias/fuzzy matching arrives in Sprint 1. */

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

const STOPWORDS = new Set([
  "de",
  "des",
  "du",
  "d",
  "la",
  "le",
  "les",
  "l",
  "et",
  "au",
  "aux",
  "the",
  "of",
]);

/** Two-letter monogram used when no logo is available. */
export function merchantInitials(name: string): string {
  const words = stripAccents(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const [first, ...rest] = words;
  const significant = [first!, ...rest.filter((w) => !STOPWORDS.has(w.toLowerCase()))];
  if (significant.length === 1) return significant[0]!.slice(0, 2).toUpperCase();
  return (significant[0]![0]! + significant[1]![0]!).toUpperCase();
}

const BANK_PREFIXES = /^(cb|carte|prlv|prelevement|vir|virement|paiement)\s+/;
/** Store number, date or reference token: optional letter then a digit ("123", "f42", "0412"). */
const NOISE_TOKEN = /^[a-z]?\d[a-z0-9]*$/;

/** Drops trailing noise tokens, never the first word. Token-based: linear time, no backtracking. */
function stripTrailingNoise(s: string): string {
  const words = s.split(" ");
  while (words.length > 1 && NOISE_TOKEN.test(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

/**
 * Canonical lowercase key for matching raw labels (tickets, bank lines) to a merchant:
 * no accents, no punctuation, no store numbers, dates or card prefixes.
 */
export function normalizeMerchantName(raw: string): string {
  let s = stripAccents(raw).toLowerCase();
  s = s.replace(/\*.*$/, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(BANK_PREFIXES, "");
  return stripTrailingNoise(s);
}
