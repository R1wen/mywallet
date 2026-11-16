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
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Bare lowercase hostname from user input ("https://www.Amazon.fr/x" -> "amazon.fr"),
 * or null. Rejects IPs, localhost, ports, credentials and single labels: the result is
 * only ever sent as a parameter to a fixed favicon provider (ADR-022).
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/, 1)[0] ?? "";
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  if (s.length > 253 || /[@:[\]]/.test(s)) return null;
  const labels = s.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1]!)) return null;
  return s;
}

type MerchantKeys = { normalizedName: string; aliases: readonly string[] };

/** Aliases of `target` after absorbing `sources` (their names and aliases), sorted, deduped. */
export function mergeAliases(target: MerchantKeys, sources: readonly MerchantKeys[]): string[] {
  const all = new Set(target.aliases);
  for (const s of sources) {
    all.add(s.normalizedName);
    for (const a of s.aliases) all.add(a);
  }
  all.delete(target.normalizedName);
  return [...all].filter(Boolean).sort();
}

/** Merchant whose normalized name or alias equals the normalized label, if any. */
export function findMerchantByLabel<T extends MerchantKeys>(
  label: string,
  merchants: readonly T[],
): T | null {
  const key = normalizeMerchantName(label);
  if (!key) return null;
  return (
    merchants.find((m) => m.normalizedName === key) ??
    merchants.find((m) => m.aliases.includes(key)) ??
    null
  );
}

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
