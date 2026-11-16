/**
 * Demo data for local development: ONE demo user with 3 months of French transactions
 * ending today (Europe/Paris), cost sharing in every claim state, recurring rules,
 * budgets and goals.
 *
 * Usage: DATABASE_URL=postgres://... pnpm db:seed   (or `pnpm db:seed --dry-run`: no DB access)
 * Login: demo@mywallet.local / demo-mywallet-2026 (development only).
 *
 * Deterministic (seeded PRNG, ids included) relative to the current day, and idempotent:
 * the demo user is deleted (everything cascades) then recreated.
 */
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { normalizeMerchantName } from "../src/lib/domain/merchant";
import { toParisDateString, daysInMonth } from "../src/lib/domain/dates";
import { formatCents } from "../src/lib/domain/money";
import * as schema from "../src/lib/db/schema";

const DEMO_USER_ID = "demo-user-mywallet";
const DEMO_EMAIL = "demo@mywallet.local";
const DEMO_PASSWORD = "demo-mywallet-2026";
const SEED = 20261115;

type TxInsert = typeof schema.transactions.$inferInsert;
type ItemInsert = typeof schema.transactionItems.$inferInsert;
type ClaimInsert = typeof schema.claims.$inferInsert;
type PaymentInsert = typeof schema.claimPayments.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
const idRng = mulberry32(SEED ^ 0x9e3779b9);

const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const chance = (p: number) => rng() < p;
function pick<T>(values: readonly T[]): T {
  const v = values[Math.floor(rng() * values.length)];
  if (v === undefined) throw new Error("pick() on an empty list");
  return v;
}

/** RFC 4122 v4-shaped uuid from the seeded generator. */
function uuid(): string {
  const b = Array.from({ length: 16 }, () => Math.floor(idRng() * 256));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* -------------------------------------------------------------------------- */
/* Calendar days ("YYYY-MM-DD", Europe/Paris)                                  */
/* -------------------------------------------------------------------------- */

const TODAY = toParisDateString(new Date());

function parts(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

function fromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(day: string, n: number): string {
  const [y, m, d] = parts(day);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Next date strictly after `day` falling on `dayOfMonth` (clamped to the month length). */
function nextMonthly(day: string, dayOfMonth: number): string {
  const [y, m, d] = parts(day);
  const thisMonth = Math.min(dayOfMonth, daysInMonth(y, m));
  if (thisMonth > d) return fromParts(y, m, thisMonth);
  const next = addMonths(fromParts(y, m, 1), 1);
  const [ny, nm] = parts(next);
  return fromParts(ny, nm, Math.min(dayOfMonth, daysInMonth(ny, nm)));
}

const START = addDays(addMonths(TODAY, -3), 1);
const DAYS: string[] = [];
for (let d = START; d <= TODAY; d = addDays(d, 1)) DAYS.push(d);

/** Day `n` days before today, never before the window. */
const ago = (n: number) => (addDays(TODAY, -n) < START ? START : addDays(TODAY, -n));

/* -------------------------------------------------------------------------- */
/* Reference data                                                             */
/* -------------------------------------------------------------------------- */

type CategoryKind = schema.CategoryKind;
const CATEGORY_TREE: {
  key: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  children: [key: string, name: string][];
}[] = [
  {
    key: "alimentation",
    name: "Alimentation",
    kind: "expense",
    icon: "shopping-basket",
    children: [
      ["courses", "Courses"],
      ["restaurants", "Restaurants"],
      ["livraison", "Livraison de repas"],
    ],
  },
  {
    key: "logement",
    name: "Logement",
    kind: "expense",
    icon: "house",
    children: [
      ["loyer", "Loyer"],
      ["energie", "Énergie"],
      ["eau", "Eau"],
      ["assurance_habitation", "Assurance habitation"],
      ["maison", "Maison et bricolage"],
    ],
  },
  {
    key: "transports",
    name: "Transports",
    kind: "expense",
    icon: "car",
    children: [
      ["carburant", "Carburant"],
      ["transports_commun", "Transports en commun"],
      ["taxi", "Taxi et VTC"],
      ["train", "Train"],
      ["peages", "Péages"],
    ],
  },
  {
    key: "abonnements",
    name: "Abonnements",
    kind: "expense",
    icon: "repeat",
    children: [
      ["telecoms", "Télécoms"],
      ["streaming", "Streaming et musique"],
    ],
  },
  {
    key: "sante",
    name: "Santé",
    kind: "expense",
    icon: "heart-pulse",
    children: [
      ["pharmacie", "Pharmacie"],
      ["medecin", "Médecin"],
    ],
  },
  {
    key: "loisirs",
    name: "Loisirs",
    kind: "expense",
    icon: "ticket",
    children: [
      ["sorties", "Sorties et cinéma"],
      ["sport", "Sport"],
      ["voyages", "Voyages"],
      ["livres", "Livres et culture"],
    ],
  },
  {
    key: "shopping",
    name: "Shopping",
    kind: "expense",
    icon: "shopping-bag",
    children: [
      ["vetements", "Vêtements"],
      ["high_tech", "High-tech"],
      ["beaute", "Beauté"],
      ["achats_divers", "Achats divers"],
    ],
  },
  {
    key: "revenus",
    name: "Revenus",
    kind: "income",
    icon: "wallet",
    children: [
      ["salaire", "Salaire"],
      ["autres_revenus", "Autres revenus"],
    ],
  },
  { key: "epargne", name: "Épargne", kind: "transfer", icon: "piggy-bank", children: [] },
  { key: "retraits", name: "Retraits d'espèces", kind: "transfer", icon: "banknote", children: [] },
];

/** [display name, domain, default category key, extra raw aliases]. */
const MERCHANTS: [string, string | null, string, string[]][] = [
  // Grande distribution
  ["Carrefour", "carrefour.fr", "courses", ["Carrefour Market", "Carrefour City", "CRF Express"]],
  ["E.Leclerc", "e.leclerc", "courses", ["Leclerc", "E Leclerc Drive"]],
  ["Auchan", "auchan.fr", "courses", ["Auchan Supermarché"]],
  ["Intermarché", "intermarche.com", "courses", ["ITM", "Intermarche Super"]],
  ["Lidl", "lidl.fr", "courses", []],
  ["Aldi", "aldi.fr", "courses", []],
  ["Monoprix", "monoprix.fr", "courses", ["Monop'"]],
  ["Franprix", "franprix.fr", "courses", []],
  ["Picard", "picard.fr", "courses", ["Picard Surgelés"]],
  ["Casino", "casino.fr", "courses", ["Casino Shop"]],
  ["Super U", "magasins-u.com", "courses", ["Hyper U", "U Express"]],
  ["Biocoop", "biocoop.fr", "courses", []],
  ["Naturalia", "naturalia.fr", "courses", []],
  ["Grand Frais", "grandfrais.com", "courses", []],
  // E-commerce et enseignes
  ["Amazon", "amazon.fr", "achats_divers", ["Amazon Marketplace", "AMZN Mktp FR"]],
  ["Cdiscount", "cdiscount.com", "achats_divers", []],
  ["Fnac", "fnac.com", "high_tech", ["Fnac.com"]],
  ["Darty", "darty.com", "high_tech", []],
  ["Boulanger", "boulanger.com", "high_tech", []],
  ["Apple", "apple.com", "high_tech", ["Apple.com/bill", "Apple Store"]],
  ["Decathlon", "decathlon.fr", "sport", []],
  ["IKEA", "ikea.com", "maison", []],
  ["Leroy Merlin", "leroymerlin.fr", "maison", []],
  ["Castorama", "castorama.fr", "maison", []],
  ["Zalando", "zalando.fr", "vetements", []],
  ["Vinted", "vinted.fr", "vetements", []],
  ["Leboncoin", "leboncoin.fr", "achats_divers", []],
  ["Sephora", "sephora.fr", "beaute", []],
  ["Uniqlo", "uniqlo.com", "vetements", []],
  ["Kiabi", "kiabi.com", "vetements", []],
  // Restauration
  ["McDonald's", "mcdonalds.fr", "restaurants", ["McDo", "Mc Donalds"]],
  ["Burger King", "burgerking.fr", "restaurants", []],
  ["KFC", "kfc.fr", "restaurants", []],
  ["Starbucks", "starbucks.fr", "restaurants", []],
  ["Paul", "paul.fr", "restaurants", ["Boulangerie Paul"]],
  ["Big Mamma", "bigmammagroup.com", "restaurants", []],
  ["Deliveroo", "deliveroo.fr", "livraison", []],
  ["Uber Eats", "ubereats.com", "livraison", []],
  ["Domino's", "dominos.fr", "livraison", ["Dominos Pizza"]],
  // Transports
  ["SNCF Connect", "sncf-connect.com", "train", ["SNCF", "OUIGO"]],
  ["RATP", "ratp.fr", "transports_commun", []],
  ["Île-de-France Mobilités", "iledefrance-mobilites.fr", "transports_commun", ["Navigo"]],
  ["Uber", "uber.com", "taxi", ["Uber Trip"]],
  ["BlaBlaCar", "blablacar.fr", "train", []],
  ["TotalEnergies", "totalenergies.fr", "carburant", ["Total Access"]],
  ["Shell", "shell.fr", "carburant", []],
  ["Esso", "esso.fr", "carburant", []],
  ["Vinci Autoroutes", "vinci-autoroutes.com", "peages", []],
  // Énergie, eau, logement
  ["EDF", "edf.fr", "energie", ["EDF Clients Particuliers"]],
  ["Engie", "engie.fr", "energie", []],
  ["Veolia", "veolia.fr", "eau", ["Eau de Paris"]],
  ["Foncia", "foncia.com", "loyer", []],
  ["MAIF", "maif.fr", "assurance_habitation", []],
  // Télécoms
  ["Free", "free.fr", "telecoms", ["Free Telecom", "Freebox"]],
  ["Orange", "orange.fr", "telecoms", []],
  ["SFR", "sfr.fr", "telecoms", []],
  ["Bouygues Telecom", "bouyguestelecom.fr", "telecoms", []],
  // Streaming
  ["Netflix", "netflix.com", "streaming", ["Netflix.com"]],
  ["Spotify", "spotify.com", "streaming", ["Spotify P"]],
  ["Canal+", "canalplus.com", "streaming", []],
  ["Deezer", "deezer.com", "streaming", []],
  ["Disney+", "disneyplus.com", "streaming", []],
  // Voyages, loisirs, santé
  ["Airbnb", "airbnb.fr", "voyages", []],
  ["Booking.com", "booking.com", "voyages", []],
  ["UGC", "ugc.fr", "sorties", ["UGC Ciné Cité"]],
  ["Pathé", "pathe.fr", "sorties", []],
  ["Doctolib", "doctolib.fr", "medecin", []],
  ["Pharmacie du Marché", null, "pharmacie", []],
];

const GROCERY_MERCHANTS = [
  "Carrefour",
  "Carrefour",
  "Monoprix",
  "Franprix",
  "Lidl",
  "E.Leclerc",
  "Picard",
  "Biocoop",
  "Intermarché",
  "Auchan",
] as const;

/** [label, unit price in cents, sold by weight]. */
const GROCERY_ITEMS: [string, number, boolean][] = [
  ["Lait demi-écrémé 1 L", 119, false],
  ["Baguette tradition", 130, false],
  ["Œufs plein air x12", 389, false],
  ["Beurre doux 250 g", 279, false],
  ["Emmental râpé 200 g", 229, false],
  ["Yaourts nature x8", 245, false],
  ["Pâtes penne 500 g", 129, false],
  ["Riz basmati 1 kg", 299, false],
  ["Tomates grappe", 349, true],
  ["Pommes Gala", 279, true],
  ["Bananes", 199, true],
  ["Courgettes", 299, true],
  ["Jambon blanc x4", 349, false],
  ["Café moulu 250 g", 459, false],
  ["Eau minérale 6 x 1,5 L", 329, false],
  ["Camembert de Normandie", 249, false],
  ["Steaks hachés x4", 549, false],
  ["Salade iceberg", 99, false],
  ["Jus d'orange 1 L", 259, false],
  ["Chocolat noir 70 %", 239, false],
  ["Liquide vaisselle", 219, false],
  ["Pain de mie", 189, false],
];

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

const categoryIds = new Map<string, string>();
const merchantIds = new Map<string, string>();
const merchantCategory = new Map<string, string>();

const categoryRows: (typeof schema.categories.$inferInsert)[] = [];
CATEGORY_TREE.forEach((root, i) => {
  const rootId = uuid();
  categoryIds.set(root.key, rootId);
  categoryRows.push({
    id: rootId,
    userId: DEMO_USER_ID,
    name: root.name,
    kind: root.kind,
    icon: root.icon,
    position: i,
  });
  root.children.forEach(([key, name], j) => {
    const childId = uuid();
    categoryIds.set(key, childId);
    categoryRows.push({
      id: childId,
      userId: DEMO_USER_ID,
      parentId: rootId,
      name,
      kind: root.kind,
      position: j,
    });
  });
});

function cat(key: string): string {
  const id = categoryIds.get(key);
  if (!id) throw new Error(`unknown category ${key}`);
  return id;
}

const merchantRows: (typeof schema.merchants.$inferInsert)[] = MERCHANTS.map(
  ([name, domain, categoryKey, aliases]) => {
    const id = uuid();
    merchantIds.set(name, id);
    merchantCategory.set(name, categoryKey);
    const normalizedName = normalizeMerchantName(name);
    return {
      id,
      userId: DEMO_USER_ID,
      name,
      normalizedName,
      aliases: [...new Set(aliases.map(normalizeMerchantName))].filter(
        (a) => a && a !== normalizedName,
      ),
      domain,
      defaultCategoryId: cat(categoryKey),
    };
  },
);

{
  const keys = merchantRows.map((m) => m.normalizedName);
  const dupes = keys.filter((k, i) => !k || keys.indexOf(k) !== i);
  if (dupes.length) throw new Error(`normalized merchant names collide: ${dupes.join(", ")}`);
}

function merchant(name: string): string {
  const id = merchantIds.get(name);
  if (!id) throw new Error(`unknown merchant ${name}`);
  return id;
}

const ACCOUNT = {
  courant: uuid(),
  livret: uuid(),
  especes: uuid(),
};

const accountRows: (typeof schema.accounts.$inferInsert)[] = [
  {
    id: ACCOUNT.courant,
    userId: DEMO_USER_ID,
    name: "Compte courant",
    type: "checking",
    institution: "Banque démo",
    openingBalanceCents: 124_380,
    position: 0,
  },
  {
    id: ACCOUNT.livret,
    userId: DEMO_USER_ID,
    name: "Livret A",
    type: "savings",
    institution: "Banque démo",
    openingBalanceCents: 850_000,
    position: 1,
  },
  {
    id: ACCOUNT.especes,
    userId: DEMO_USER_ID,
    name: "Espèces",
    type: "cash",
    openingBalanceCents: 12_000,
    position: 2,
  },
];

const PEOPLE = { lea: uuid(), karim: uuid(), sophie: uuid() };
const peopleRows: (typeof schema.people.$inferInsert)[] = [
  { id: PEOPLE.lea, userId: DEMO_USER_ID, name: "Léa" },
  { id: PEOPLE.karim, userId: DEMO_USER_ID, name: "Karim" },
  { id: PEOPLE.sophie, userId: DEMO_USER_ID, name: "Sophie", notes: "Colocataire" },
];

/* Recurring rules ---------------------------------------------------------- */

type RuleSpec = {
  key: string;
  kind: "expense" | "income";
  label: string;
  amountCents: number;
  dayOfMonth: number;
  merchant?: string;
  category: string;
};

const RULES: RuleSpec[] = [
  {
    key: "salaire",
    kind: "income",
    label: "Salaire Acme Conseil",
    amountCents: 285_000,
    dayOfMonth: 1,
    category: "salaire",
  },
  {
    key: "loyer",
    kind: "expense",
    label: "Loyer",
    amountCents: -89_000,
    dayOfMonth: 5,
    merchant: "Foncia",
    category: "loyer",
  },
  {
    key: "edf",
    kind: "expense",
    label: "Mensualité EDF",
    amountCents: -7_840,
    dayOfMonth: 8,
    merchant: "EDF",
    category: "energie",
  },
  {
    key: "free",
    kind: "expense",
    label: "Freebox Pop",
    amountCents: -2_999,
    dayOfMonth: 12,
    merchant: "Free",
    category: "telecoms",
  },
  {
    key: "netflix",
    kind: "expense",
    label: "Netflix Standard",
    amountCents: -1_499,
    dayOfMonth: 15,
    merchant: "Netflix",
    category: "streaming",
  },
];

const ruleIds = new Map(RULES.map((r) => [r.key, uuid()]));
const ruleRows: (typeof schema.recurringRules.$inferInsert)[] = RULES.map((r) => ({
  id: ruleIds.get(r.key)!,
  userId: DEMO_USER_ID,
  accountId: ACCOUNT.courant,
  kind: r.kind,
  label: r.label,
  amountCents: r.amountCents,
  merchantId: r.merchant ? merchant(r.merchant) : null,
  categoryId: cat(r.category),
  frequency: "monthly",
  interval: 1,
  dayOfMonth: r.dayOfMonth,
  startOn: nextMonthly(addDays(START, -1), r.dayOfMonth),
  nextRunOn: nextMonthly(TODAY, r.dayOfMonth),
}));

/* Transactions ------------------------------------------------------------- */

const txRows: TxInsert[] = [];
const itemRows: ItemInsert[] = [];
const claimRows: ClaimInsert[] = [];
const paymentRows: PaymentInsert[] = [];

type ItemSpec = {
  label: string;
  quantity?: string;
  unitPriceCents?: number;
  totalCents: number;
  category: string;
};

function addTx(input: {
  day: string;
  kind: schema.TransactionKind;
  amountCents: number;
  label: string;
  account?: string;
  merchant?: string;
  category?: string | null;
  recurring?: string;
  transferGroupId?: string;
  notes?: string;
  items?: ItemSpec[];
}): { id: string; itemIds: string[] } {
  const id = uuid();
  const categoryKey =
    input.category === null
      ? null
      : (input.category ?? (input.merchant ? merchantCategory.get(input.merchant) : undefined));
  txRows.push({
    id,
    userId: DEMO_USER_ID,
    accountId: input.account ?? ACCOUNT.courant,
    kind: input.kind,
    amountCents: input.amountCents,
    occurredOn: input.day,
    label: input.label,
    notes: input.notes ?? null,
    merchantId: input.merchant ? merchant(input.merchant) : null,
    categoryId: categoryKey ? cat(categoryKey) : null,
    recurringRuleId: input.recurring ? ruleIds.get(input.recurring)! : null,
    transferGroupId: input.transferGroupId ?? null,
  });
  const itemIds: string[] = [];
  if (input.items) {
    const sum = input.items.reduce((a, it) => a + it.totalCents, 0);
    if (sum !== -input.amountCents) {
      throw new Error(`items of "${input.label}" sum to ${sum}, expected ${-input.amountCents}`);
    }
    input.items.forEach((it, position) => {
      const itemId = uuid();
      itemIds.push(itemId);
      itemRows.push({
        id: itemId,
        userId: DEMO_USER_ID,
        transactionId: id,
        position,
        label: it.label,
        quantity: it.quantity ?? "1",
        unitPriceCents: it.unitPriceCents ?? it.totalCents,
        totalCents: it.totalCents,
        categoryId: cat(it.category),
      });
    });
  }
  return { id, itemIds };
}

function expense(
  day: string,
  merchantName: string,
  amountCents: number,
  extra: Partial<Parameters<typeof addTx>[0]> = {},
) {
  return addTx({
    day,
    kind: "expense",
    amountCents: -amountCents,
    label: merchantName,
    merchant: merchantName,
    ...extra,
  });
}

function transfer(day: string, from: string, to: string, amountCents: number, label: string) {
  const group = uuid();
  const category = from === ACCOUNT.courant && to === ACCOUNT.livret ? "epargne" : "retraits";
  addTx({
    day,
    kind: "transfer",
    amountCents: -amountCents,
    label,
    account: from,
    category,
    transferGroupId: group,
  });
  addTx({
    day,
    kind: "transfer",
    amountCents,
    label,
    account: to,
    category,
    transferGroupId: group,
  });
}

function groceryItems(): ItemSpec[] {
  const count = randInt(3, 8);
  const used = new Set<number>();
  const items: ItemSpec[] = [];
  while (items.length < count) {
    const index = randInt(0, GROCERY_ITEMS.length - 1);
    if (used.has(index)) continue;
    used.add(index);
    const [label, unit, weighed] = GROCERY_ITEMS[index]!;
    if (weighed) {
      const grams = randInt(350, 1600);
      items.push({
        label,
        quantity: (grams / 1000).toFixed(3),
        unitPriceCents: unit,
        totalCents: Math.round((unit * grams) / 1000),
        category: "courses",
      });
    } else {
      const qty = chance(0.25) ? 2 : 1;
      items.push({
        label,
        quantity: String(qty),
        unitPriceCents: unit,
        totalCents: unit * qty,
        category: "courses",
      });
    }
  }
  return items;
}

const RESTAURANTS = ["McDonald's", "Burger King", "KFC", "Starbucks", "Big Mamma", "Paul"];
const DELIVERY = ["Deliveroo", "Uber Eats", "Domino's"];
const FUEL = ["TotalEnergies", "TotalEnergies", "Shell", "Esso"];
const SHOPPING = [
  "Amazon",
  "Amazon",
  "Cdiscount",
  "Decathlon",
  "IKEA",
  "Zalando",
  "Vinted",
  "Sephora",
  "Uniqlo",
  "Leroy Merlin",
  "Darty",
];
const OUTINGS = ["UGC", "Pathé"];

for (const day of DAYS) {
  const dom = Number(day.slice(8, 10));

  // Fixed monthly movements.
  if (dom === 1) {
    addTx({
      day,
      kind: "income",
      amountCents: 285_000,
      label: "Virement salaire Acme Conseil",
      category: "salaire",
      recurring: "salaire",
    });
    expense(day, "Île-de-France Mobilités", 8_880, { label: "Forfait Navigo mois" });
  }
  if (dom === 2) transfer(day, ACCOUNT.courant, ACCOUNT.livret, 20_000, "Virement vers Livret A");
  if (dom === 3) expense(day, "MAIF", 1_850, { label: "Assurance habitation MAIF" });
  if (dom === 5) expense(day, "Foncia", 89_000, { label: "Loyer Foncia", recurring: "loyer" });
  if (dom === 6) transfer(day, ACCOUNT.courant, ACCOUNT.especes, 6_000, "Retrait DAB");
  if (dom === 8) expense(day, "EDF", 7_840, { label: "Mensualité EDF", recurring: "edf" });
  if (dom === 12) expense(day, "Free", 2_999, { label: "Freebox Pop", recurring: "free" });
  if (dom === 15) expense(day, "Netflix", 1_499, { recurring: "netflix" });
  if (dom === 22) expense(day, "Spotify", 1_199, { label: "Spotify Premium" });
  if (dom === 25 && chance(0.5)) expense(day, "Veolia", 3_120, { label: "Facture d'eau" });

  // Everyday life.
  if (chance(0.42)) {
    const m = pick(GROCERY_MERCHANTS);
    if (chance(0.35)) {
      const items = groceryItems();
      const total = items.reduce((a, it) => a + it.totalCents, 0);
      expense(day, m, total, { items });
    } else {
      expense(day, m, randInt(1_200, 9_500));
    }
  }
  if (chance(0.2)) expense(day, pick(RESTAURANTS), randInt(850, 4_200));
  if (chance(0.06)) expense(day, pick(DELIVERY), randInt(1_800, 3_600));
  if (chance(0.15)) {
    expense(day, "Paul", randInt(240, 890), { account: ACCOUNT.especes, label: "Paul (espèces)" });
  }
  if (chance(0.07)) expense(day, pick(FUEL), randInt(5_200, 7_800));
  if (chance(0.04)) expense(day, "Uber", randInt(1_300, 3_200));
  if (chance(0.07)) expense(day, pick(SHOPPING), randInt(1_500, 12_000));
  if (chance(0.04)) expense(day, "Pharmacie du Marché", randInt(590, 2_800));
  if (chance(0.03)) expense(day, pick(OUTINGS), randInt(1_190, 2_380));
}

/* Cost sharing scenarios --------------------------------------------------- */

function claim(input: {
  person: string;
  transactionId: string;
  itemId?: string;
  amountCents: number;
  status: schema.ClaimStatus;
  note?: string;
  resolvedDay?: string;
}): string {
  const id = uuid();
  claimRows.push({
    id,
    userId: DEMO_USER_ID,
    personId: input.person,
    transactionId: input.transactionId,
    transactionItemId: input.itemId ?? null,
    amountCents: input.amountCents,
    status: input.status,
    note: input.note ?? null,
    resolvedAt: input.resolvedDay ? new Date(`${input.resolvedDay}T18:00:00Z`) : null,
  });
  return id;
}

/** Money back from a person: a `reimbursement` transaction + its claim payment. */
function reimburse(
  claimId: string,
  day: string,
  amountCents: number,
  label: string,
  account = ACCOUNT.courant,
) {
  const { id } = addTx({
    day,
    kind: "reimbursement",
    amountCents,
    label,
    account,
    category: null,
  });
  paymentRows.push({
    id: uuid(),
    userId: DEMO_USER_ID,
    claimId,
    transactionId: id,
    amountCents,
  });
}

// A. Dinner split three ways: Léa still owes, Karim paid back.
{
  const day = ago(40);
  const { id } = expense(day, "Big Mamma", 9_600, { label: "Dîner Big Mamma (3 pers.)" });
  claim({ person: PEOPLE.lea, transactionId: id, amountCents: 3_200, status: "pending" });
  const karim = claim({
    person: PEOPLE.karim,
    transactionId: id,
    amountCents: 3_200,
    status: "reimbursed",
    resolvedDay: ago(37),
  });
  reimburse(karim, ago(37), 3_200, "Remboursement Karim - dîner Big Mamma");
}

// B. The 80 EUR receipt: 30 EUR for Sophie, partially reimbursed twice (cash + transfer).
{
  const day = ago(20);
  const items: ItemSpec[] = [
    { label: "Huile d'olive vierge extra 75 cl", totalCents: 899, category: "courses" },
    {
      label: "Saumon fumé x4",
      quantity: "2",
      unitPriceCents: 699,
      totalCents: 1_398,
      category: "courses",
    },
    { label: "Comté AOP 18 mois 200 g", totalCents: 459, category: "courses" },
    {
      label: "Côtes du Rhône rouge 75 cl",
      quantity: "2",
      unitPriceCents: 649,
      totalCents: 1_298,
      category: "courses",
    },
    { label: "Café moulu 250 g", totalCents: 459, category: "courses" },
    { label: "Lessive liquide 2 L", totalCents: 1_149, category: "courses" },
    { label: "Papier toilette x12", totalCents: 599, category: "courses" },
    {
      label: "Poulet fermier Label Rouge",
      quantity: "1.461",
      unitPriceCents: 1_190,
      totalCents: 1_739,
      category: "courses",
    },
  ];
  const { id } = expense(day, "Carrefour", 8_000, { label: "Carrefour Market", items });
  const sophie = claim({
    person: PEOPLE.sophie,
    transactionId: id,
    amountCents: 3_000,
    status: "pending",
    note: "Courses communes de la colocation",
  });
  reimburse(sophie, ago(18), 1_000, "Remboursement Sophie (espèces)", ACCOUNT.especes);
  reimburse(sophie, ago(9), 1_000, "Remboursement Sophie - virement Lydia");
}

// C. Online order with lines: Karim's book is a gift.
{
  const day = ago(55);
  const items: ItemSpec[] = [
    { label: "Casque Bluetooth à réduction de bruit", totalCents: 7_999, category: "high_tech" },
    { label: "Livre - L'Anomalie, Hervé Le Tellier", totalCents: 990, category: "livres" },
  ];
  const { id, itemIds } = expense(day, "Fnac", 8_989, { label: "Commande Fnac.com", items });
  claim({
    person: PEOPLE.karim,
    transactionId: id,
    itemId: itemIds[1],
    amountCents: 990,
    status: "gifted",
    note: "Cadeau d'anniversaire",
    resolvedDay: ago(50),
  });
}

// D. Weekend rental split three ways, both friends fully reimbursed (Léa in two parts).
{
  const day = ago(70);
  const { id } = expense(day, "Airbnb", 36_000, { label: "Airbnb week-end à Étretat" });
  const lea = claim({
    person: PEOPLE.lea,
    transactionId: id,
    amountCents: 12_000,
    status: "reimbursed",
    resolvedDay: ago(45),
  });
  reimburse(lea, ago(66), 6_000, "Remboursement Léa - Airbnb (1/2)");
  reimburse(lea, ago(45), 6_000, "Remboursement Léa - Airbnb (2/2)");
  const sophie = claim({
    person: PEOPLE.sophie,
    transactionId: id,
    amountCents: 12_000,
    status: "reimbursed",
    resolvedDay: ago(64),
  });
  reimburse(sophie, ago(64), 12_000, "Remboursement Sophie - Airbnb");
}

// E. Train tickets: Karim paid 20 EUR back, the rest was gifted (it becomes my expense).
{
  const day = ago(30);
  const { id } = expense(day, "SNCF Connect", 9_100, { label: "SNCF Paris - Lyon x2" });
  const karim = claim({
    person: PEOPLE.karim,
    transactionId: id,
    amountCents: 4_550,
    status: "gifted",
    note: "Le reste lui est offert",
    resolvedDay: ago(12),
  });
  reimburse(karim, ago(26), 2_000, "Remboursement Karim - billet de train");
}

/* Planning ----------------------------------------------------------------- */

const firstOfWindowMonth = fromParts(...(parts(START).slice(0, 2) as [number, number]), 1);

const budgetRows: (typeof schema.budgets.$inferInsert)[] = [
  {
    id: uuid(),
    userId: DEMO_USER_ID,
    categoryId: cat("courses"),
    period: "monthly",
    amountCents: 45_000,
    startsOn: firstOfWindowMonth,
  },
  {
    id: uuid(),
    userId: DEMO_USER_ID,
    categoryId: cat("restaurants"),
    period: "monthly",
    amountCents: 18_000,
    startsOn: firstOfWindowMonth,
  },
];

const goalRows: (typeof schema.goals.$inferInsert)[] = [
  {
    id: uuid(),
    userId: DEMO_USER_ID,
    name: "Épargne de précaution",
    targetCents: 1_000_000,
    accountId: ACCOUNT.livret,
  },
  {
    id: uuid(),
    userId: DEMO_USER_ID,
    name: "Voyage au Japon",
    targetCents: 350_000,
    savedCents: 85_000,
    targetDate: `${parts(TODAY)[0] + 1}-09-01`,
  },
];

const ruleRowsCategorization: (typeof schema.categorizationRules.$inferInsert)[] = [
  {
    id: uuid(),
    userId: DEMO_USER_ID,
    matchType: "contains",
    pattern: "navigo",
    categoryId: cat("transports_commun"),
    priority: 10,
  },
  {
    id: uuid(),
    userId: DEMO_USER_ID,
    matchType: "merchant",
    merchantId: merchant("Picard"),
    categoryId: cat("courses"),
    priority: 20,
  },
];

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  if (process.argv.includes("--dry-run")) {
    printSummary();
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL manquante.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Refusé : le seed de démonstration ne s'exécute pas en production.");
    process.exit(1);
  }
  // Le compte de démo a un mot de passe public : jamais sur une base distante (Neon…)
  // sauf consentement explicite.
  const host = new URL(url).hostname;
  const isLocal = ["localhost", "127.0.0.1", "::1", "db"].includes(host);
  if (!isLocal && process.env.ALLOW_REMOTE_SEED !== "1") {
    console.error(
      `Refusé : base distante (${host}). Le seed crée un compte au mot de passe public. ` +
        "Définir ALLOW_REMOTE_SEED=1 pour forcer (base de démonstration uniquement).",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.user)
        .where(sql`${schema.user.email} = ${DEMO_EMAIL} or ${schema.user.id} = ${DEMO_USER_ID}`);

      await tx.insert(schema.user).values({
        id: DEMO_USER_ID,
        name: "Camille Martin",
        email: DEMO_EMAIL,
        emailVerified: true,
      });
      await tx.insert(schema.authAccount).values({
        id: `${DEMO_USER_ID}-credential`,
        accountId: DEMO_USER_ID,
        providerId: "credential",
        userId: DEMO_USER_ID,
        password: passwordHash,
      });

      await tx.insert(schema.accounts).values(accountRows);
      // Roots first: the parent FK is checked per row.
      await tx.insert(schema.categories).values(categoryRows.filter((c) => !c.parentId));
      await tx.insert(schema.categories).values(categoryRows.filter((c) => c.parentId));
      await tx.insert(schema.merchants).values(merchantRows);
      await tx.insert(schema.people).values(peopleRows);
      await tx.insert(schema.recurringRules).values(ruleRows);
      for (let i = 0; i < txRows.length; i += 500) {
        await tx.insert(schema.transactions).values(txRows.slice(i, i + 500));
      }
      await tx.insert(schema.transactionItems).values(itemRows);
      await tx.insert(schema.claims).values(claimRows);
      await tx.insert(schema.claimPayments).values(paymentRows);
      await tx.insert(schema.budgets).values(budgetRows);
      await tx.insert(schema.goals).values(goalRows);
      await tx.insert(schema.categorizationRules).values(ruleRowsCategorization);
    });

    printSummary();
    console.log(`Connexion : ${DEMO_EMAIL} (mot de passe de démo, voir scripts/seed.ts).`);
  } finally {
    await pool.end();
  }
}

/** Counts plus a sanity check of the financial rules on the generated data. */
function printSummary(): void {
  console.log(`Seed de démonstration (${START} -> ${TODAY}, Europe/Paris) :`);
  console.table({
    comptes: accountRows.length,
    categories: categoryRows.length,
    marchands: merchantRows.length,
    transactions: txRows.length,
    lignes: itemRows.length,
    personnes: peopleRows.length,
    creances: claimRows.length,
    remboursements: paymentRows.length,
    recurrences: ruleRows.length,
    budgets: budgetRows.length,
    objectifs: goalRows.length,
    regles: ruleRowsCategorization.length,
  });

  const balances = accountRows.map((a) => {
    const moves = txRows.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amountCents, 0);
    return { compte: a.name, solde: formatCents((a.openingBalanceCents ?? 0) + moves) };
  });
  console.table(balances);

  const paid = new Map<string, number>();
  for (const p of paymentRows) paid.set(p.claimId, (paid.get(p.claimId) ?? 0) + p.amountCents);
  const othersShare = (c: ClaimInsert) =>
    c.status === "pending" || c.status === "reimbursed"
      ? c.amountCents
      : c.status === "gifted"
        ? (paid.get(c.id!) ?? 0)
        : 0;
  const spent = -txRows.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amountCents, 0);
  const shares = claimRows.reduce((s, c) => s + othersShare(c), 0);
  const outstanding = claimRows
    .filter((c) => c.status === "pending")
    .reduce((s, c) => s + c.amountCents - (paid.get(c.id!) ?? 0), 0);
  console.log(
    `Dépenses débitées ${formatCents(spent)} ; ma dépense réelle ${formatCents(spent - shares)} ; à récupérer ${formatCents(outstanding)}.`,
  );
}

main().catch((error: unknown) => {
  let current: unknown = error;
  const messages: string[] = [];
  for (let depth = 0; current && depth < 4; depth++) {
    const err = current as { message?: string; code?: string; cause?: unknown };
    messages.push(
      `${(err.message ?? String(current)).split("\n")[0]}${err.code ? ` (${err.code})` : ""}`,
    );
    current = err.cause;
  }
  console.error(`Échec du seed : ${messages.join(" <- ")}`);
  process.exit(1);
});
