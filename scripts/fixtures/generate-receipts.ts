/**
 * Génère les fixtures publiques de tickets synthétiques (ADR-030).
 * Usage : pnpm fixtures:receipts            (réécrit fixtures/receipts/<id>/)
 *         pnpm fixtures:receipts <id> ...   (seulement ces fixtures)
 *
 * Chaque ticket est décrit en données ; la même source produit le rendu (HTML -> Playwright
 * -> PNG -> dégradations sharp, ou PDF avec couche texte), `expected.json` et `truth.txt`.
 * Aucune donnée réelle : enseignes réelles, mais adresses, SIRET, cartes et numéros fictifs.
 * Les images dépendent des polices du système (Courier New sous Windows) : deux machines
 * peuvent produire des pixels différents, les valeurs attendues restent identiques.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "fixtures", "receipts");

// ---------------------------------------------------------------------------
// Modèle
// ---------------------------------------------------------------------------

type RateBp = 210 | 550 | 1000 | 2000;

type ItemDef = {
  label: string;
  unitPriceCents: number;
  rate: RateBp;
  /** Quantité (entière, ou décimale pour kg / L). Défaut 1. */
  qty?: number;
  unit?: "kg" | "L";
  /** Remise rattachée à l'article (centimes, négatif). */
  discount?: { label: string; cents: number };
};

type Degrade = {
  format: "png" | "jpg";
  quality?: number;
  /** Fond « table » autour du ticket (photo). */
  background?: boolean;
  rotate?: number;
  blur?: number;
  /** Amplitude du bruit (0-255). */
  noise?: number;
  /** Contraste : sortie = a * entrée + b. */
  linear?: [number, number];
  /** Rognage en fraction de la largeur/hauteur. */
  crop?: { left?: number; right?: number; top?: number; bottom?: number };
  /** Facteur d'échelle de rendu (défaut 2). */
  scale?: number;
};

type DateFormat = "dmy4" | "dmy2" | "dot";
type TimeFormat = "colon" | "h";

type ReceiptDef = {
  id: string;
  kind: "thermal" | "pdf";
  merchant: string;
  merchantRaw: string;
  headerExtra: string[];
  address: string[];
  siret: string;
  date: [number, number, number];
  dateFormat: DateFormat;
  time: [number, number] | null;
  timeFormat: TimeFormat;
  register?: string;
  items: ItemDef[];
  qtyStyle: "below" | "prefix";
  /** Lettre de TVA imprimée après le prix (supermarchés). */
  vatLetters?: Partial<Record<RateBp, string>>;
  totalLabel: "TOTAL TTC" | "A PAYER" | "NET A PAYER" | "TOTAL" | "MONTANT TTC";
  payment: "card" | "cash";
  cashGivenCents?: number;
  cardLast4?: string;
  returnDays?: number;
  warrantyYears?: number;
  footer: string[];
  difficulty: string[];
  degrade: Degrade;
  width?: number;
};

type ExpectedItem = {
  label: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};
type ExpectedVat = { rateBp: number; baseCents: number; vatCents: number };
type Expected = {
  merchant: string;
  merchantRaw: string;
  date: string;
  time: string | null;
  currency: "EUR";
  totalCents: number;
  paymentMethod: "card" | "cash";
  vat: ExpectedVat[];
  items: ExpectedItem[];
  discountsCents: number;
  returnDeadline: string | null;
  warrantyUntil: string | null;
  difficulty: string[];
};

// ---------------------------------------------------------------------------
// Calculs (entiers uniquement)
// ---------------------------------------------------------------------------

function itemTotal(it: ItemDef): number {
  const milli = Math.round((it.qty ?? 1) * 1000);
  return Math.round((milli * it.unitPriceCents) / 1000);
}

function computeVat(items: ItemDef[]): ExpectedVat[] {
  const byRate = new Map<number, number>();
  for (const it of items) {
    const ttc = itemTotal(it) + (it.discount?.cents ?? 0);
    byRate.set(it.rate, (byRate.get(it.rate) ?? 0) + ttc);
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rateBp, ttc]) => {
      const baseCents = Math.round((ttc * 10000) / (10000 + rateBp));
      return { rateBp, baseCents, vatCents: ttc - baseCents };
    });
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays([y, m, d]: [number, number, number], days: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function addYears([y, m, d]: [number, number, number], years: number): string {
  return iso(y + years, m, d);
}

function buildExpected(r: ReceiptDef): Expected {
  const items = r.items.map((it) => ({
    label: it.label,
    quantity: it.qty ?? 1,
    unitPriceCents: it.unitPriceCents,
    totalCents: itemTotal(it),
  }));
  const discountsCents = r.items.reduce((s, it) => s + (it.discount?.cents ?? 0), 0);
  const totalCents = items.reduce((s, it) => s + it.totalCents, 0) + discountsCents;
  return {
    merchant: r.merchant,
    merchantRaw: r.merchantRaw,
    date: iso(...r.date),
    time: r.time ? `${pad2(r.time[0])}:${pad2(r.time[1])}` : null,
    currency: "EUR",
    totalCents,
    paymentMethod: r.payment,
    vat: computeVat(r.items),
    items,
    discountsCents,
    returnDeadline: r.returnDays ? addDays(r.date, r.returnDays) : null,
    warrantyUntil: r.warrantyYears ? addYears(r.date, r.warrantyYears) : null,
    difficulty: r.difficulty,
  };
}

// ---------------------------------------------------------------------------
// Mise en forme texte
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 1234 -> "12,34" ; -60 -> "-0,60". Pas de séparateur de milliers (usage des caisses). */
function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${pad2(abs % 100)}`;
}

function qtyText(q: number, unit?: "kg" | "L"): string {
  if (unit === "kg") return q.toFixed(3).replace(".", ",");
  if (unit === "L") return q.toFixed(2).replace(".", ",");
  return String(q);
}

function rateText(bp: number): string {
  return `${Math.floor(bp / 100)},${pad2(bp % 100)}%`;
}

function dateText([y, m, d]: [number, number, number], f: DateFormat): string {
  if (f === "dmy2") return `${pad2(d)}/${pad2(m)}/${String(y).slice(2)}`;
  if (f === "dot") return `${pad2(d)}.${pad2(m)}.${y}`;
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

function timeText([h, mi]: [number, number], f: TimeFormat): string {
  return f === "h" ? `${pad2(h)}h${pad2(mi)}` : `${pad2(h)}:${pad2(mi)}`;
}

type Line = { text: string; big?: boolean };

function lr(left: string, right: string, width: number): string {
  return left + " ".repeat(Math.max(1, width - left.length - right.length)) + right;
}

function center(s: string, width: number): string {
  return " ".repeat(Math.max(0, Math.floor((width - s.length) / 2))) + s;
}

const BIG_RATIO = 1.5;

function thermalLines(r: ReceiptDef, e: Expected): Line[] {
  const W = r.width ?? 40;
  const WB = Math.floor(W / BIG_RATIO);
  const L: Line[] = [];
  const sep = "-".repeat(W);
  const add = (text: string) => L.push({ text });
  const big = (text: string) => L.push({ text, big: true });

  big(center(r.merchantRaw, WB));
  for (const h of r.headerExtra) add(center(h, W));
  for (const a of r.address) add(center(a, W));
  add(center(`SIRET ${r.siret}`, W));
  add("");
  const when = [dateText(r.date, r.dateFormat), r.time ? timeText(r.time, r.timeFormat) : ""]
    .filter(Boolean)
    .join(" ");
  add(lr(when, r.register ?? "", W));
  add(sep);

  const letter = (rate: RateBp) => (r.vatLetters?.[rate] ? ` ${r.vatLetters[rate]}` : "");
  r.items.forEach((it, i) => {
    const total = money(e.items[i]!.totalCents) + letter(it.rate);
    const q = it.qty ?? 1;
    if (it.unit) {
      add(lr(it.label, total, W));
      add(`  ${qtyText(q, it.unit)} ${it.unit} x ${priceText(it)} EUR/${it.unit}`);
    } else if (q !== 1 && r.qtyStyle === "prefix") {
      add(lr(`${q} ${it.label}`, total, W));
    } else {
      add(lr(it.label, total, W));
      if (q !== 1) add(`  ${q} x ${money(it.unitPriceCents)}`);
    }
    if (it.discount) add(lr(`  ${it.discount.label}`, money(it.discount.cents), W));
  });
  add(sep);
  const articles = r.items.reduce((s, it) => s + (it.unit ? 1 : (it.qty ?? 1)), 0);
  add(`NB ARTICLES : ${articles}`);
  if (e.discountsCents !== 0) add(lr("TOTAL REMISES", money(e.discountsCents), W));
  big(lr(r.totalLabel, `${money(e.totalCents)} EUR`, WB));
  add("");
  if (r.payment === "card") {
    add(lr("CB", money(e.totalCents), W));
    add("CARTE BANCAIRE SANS CONTACT");
    add(`XXXX XXXX XXXX ${r.cardLast4 ?? "0000"}`);
    add("A0000000421010  CB");
  } else {
    const given = r.cashGivenCents ?? e.totalCents;
    add(lr("ESPECES", money(given), W));
    add(lr("RENDU", money(given - e.totalCents), W));
  }
  add("");
  add(lr("TAUX", "HT       TVA       TTC", W));
  for (const v of e.vat) {
    const ttc = v.baseCents + v.vatCents;
    const right = `${money(v.baseCents).padStart(6)} ${money(v.vatCents).padStart(9)} ${money(ttc).padStart(9)}`;
    const rate = Object.entries(r.vatLetters ?? {}).find(([bp]) => Number(bp) === v.rateBp);
    add(lr(`${rate ? `${rate[1]} ` : ""}${rateText(v.rateBp)}`, right, W));
  }
  add("");
  if (r.returnDays) add(center(`Retour sous ${r.returnDays} jours`, W));
  if (r.warrantyYears) add(center(`Garantie ${r.warrantyYears} ans`, W));
  for (const f of r.footer) add(center(f, W));
  return L;
}

function priceText(it: ItemDef): string {
  // Carburant : prix au litre affiché à 3 décimales (le 3e chiffre vaut 0 ici).
  return it.unit === "L" ? `${money(it.unitPriceCents)}0` : money(it.unitPriceCents);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function thermalHtml(lines: Line[], width: number): string {
  const rows = lines
    .map((l) => `<div class="${l.big ? "l big" : "l"}">${escapeHtml(l.text) || "&nbsp;"}</div>`)
    .join("\n");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#fff}
    #r{display:inline-block;padding:18px 16px 28px;background:#fbfbf8;color:#1a1a1a;
       font-family:"Courier New","Liberation Mono",monospace;font-weight:700;font-size:15px;line-height:1.3;
       width:${width}ch}
    .l{white-space:pre}
    .big{font-size:${BIG_RATIO}em;line-height:1.25}
  </style></head><body><div id="r">${rows}</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Facture PDF (e-commerce)
// ---------------------------------------------------------------------------

function pdfLines(r: ReceiptDef, e: Expected): { html: string; truth: string[] } {
  const truth: string[] = [];
  const blocks: string[] = [];
  const row = (cells: string[], cls = "") => {
    truth.push(cells.join(" "));
    blocks.push(
      `<div class="row ${cls}">${cells.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`,
    );
  };
  const para = (text: string, cls = "") => {
    truth.push(text);
    blocks.push(`<p class="${cls}">${escapeHtml(text)}</p>`);
  };
  para(r.merchantRaw, "brand");
  for (const h of r.headerExtra) para(h);
  for (const a of r.address) para(a);
  para(`SIRET ${r.siret}`);
  para(`Date de facture : ${dateText(r.date, r.dateFormat)}`);
  row(["Désignation", "Qté", "Prix unitaire TTC", "Total TTC"], "head");
  r.items.forEach((it, i) => {
    row([it.label, String(it.qty ?? 1), money(it.unitPriceCents), money(e.items[i]!.totalCents)]);
    if (it.discount) row([it.discount.label, "", "", money(it.discount.cents)], "disc");
  });
  for (const v of e.vat) {
    row([
      `TVA ${rateText(v.rateBp)}`,
      `Base HT ${money(v.baseCents)}`,
      `TVA ${money(v.vatCents)}`,
      `TTC ${money(v.baseCents + v.vatCents)}`,
    ]);
  }
  row([r.totalLabel, `${money(e.totalCents)} EUR`], "total");
  para(`Payé par carte bancaire XXXX XXXX XXXX ${r.cardLast4 ?? "0000"}`);
  if (r.returnDays) para(`Retour sous ${r.returnDays} jours`);
  if (r.warrantyYears) para(`Garantie ${r.warrantyYears} ans`);
  for (const f of r.footer) para(f);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:40px}
    p{margin:0 0 6px}
    .brand{font-size:22px;font-weight:700;margin-bottom:12px}
    .row{display:grid;grid-template-columns:3fr 1fr 2fr 2fr;gap:8px;padding:5px 0;border-bottom:1px solid #ccc}
    .row span:not(:first-child){text-align:right}
    .head{font-weight:700;margin-top:18px}
    .total{font-weight:700;font-size:15px;margin:10px 0 16px}
  </style></head><body>${blocks.join("\n")}</body></html>`;
  return { html, truth };
}

// ---------------------------------------------------------------------------
// Dégradations (sharp)
// ---------------------------------------------------------------------------

/** PRNG déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const TABLE = { r: 104, g: 92, b: 80, alpha: 1 };

async function degrade(png: Buffer, d: Degrade, id: string): Promise<Buffer> {
  let buf = png;
  if (d.linear) buf = await sharp(buf).linear(d.linear[0], d.linear[1]).png().toBuffer();
  if (d.background) {
    buf = await sharp(buf)
      .extend({ top: 60, bottom: 60, left: 50, right: 50, background: TABLE })
      .png()
      .toBuffer();
  }
  if (d.rotate) {
    buf = await sharp(buf)
      .rotate(d.rotate, { background: d.background ? TABLE : "#ffffff" })
      .png()
      .toBuffer();
  }
  if (d.blur) buf = await sharp(buf).blur(d.blur).png().toBuffer();
  if (d.noise) {
    const { data, info } = await sharp(buf)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rand = rng(seedOf(id));
    for (let p = 0; p < info.width * info.height; p++) {
      const n = (rand() + rand() - 1) * d.noise;
      for (let c = 0; c < info.channels; c++) {
        const i = p * info.channels + c;
        data[i] = Math.max(0, Math.min(255, data[i]! + n));
      }
    }
    buf = await sharp(data, { raw: info }).png().toBuffer();
  }
  if (d.crop) {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const left = Math.round(w * (d.crop.left ?? 0));
    const top = Math.round(h * (d.crop.top ?? 0));
    const width = w - left - Math.round(w * (d.crop.right ?? 0));
    const height = h - top - Math.round(h * (d.crop.bottom ?? 0));
    buf = await sharp(buf).extract({ left, top, width, height }).png().toBuffer();
  }
  // Ré-encodage sans métadonnées (pas d'EXIF).
  return d.format === "jpg"
    ? sharp(buf)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: d.quality ?? 82, mozjpeg: true })
        .toBuffer()
    : sharp(buf).png({ compressionLevel: 9, palette: true }).toBuffer();
}

// ---------------------------------------------------------------------------
// Données : 18 tickets synthétiques
// ---------------------------------------------------------------------------

const SUPER_LETTERS = { 550: "A", 1000: "B", 2000: "C" } as const;

const RECEIPTS: ReceiptDef[] = [
  {
    id: "carrefour-2026-11-01",
    kind: "thermal",
    merchant: "Carrefour",
    merchantRaw: "CARREFOUR MARKET 0123",
    headerExtra: ["Bienvenue dans votre magasin"],
    address: ["12 RUE DES TILLEULS", "69007 LYON", "TEL 04 00 00 01 23"],
    siret: "000 000 012 00011",
    date: [2026, 11, 14],
    dateFormat: "dmy4",
    time: [18, 42],
    timeFormat: "colon",
    register: "CAISSE 03",
    qtyStyle: "below",
    vatLetters: SUPER_LETTERS,
    items: [
      { label: "LAIT DEMI ECR 1L", unitPriceCents: 125, qty: 2, rate: 550 },
      { label: "PAIN DE MIE COMPLET", unitPriceCents: 189, rate: 550 },
      { label: "YAOURT NATURE X8", unitPriceCents: 235, rate: 550 },
      {
        label: "CAFE MOULU 250G",
        unitPriceCents: 399,
        rate: 550,
        discount: { label: "REMISE FIDELITE", cents: -60 },
      },
      { label: "LESSIVE LIQUIDE 2L", unitPriceCents: 849, rate: 2000 },
      { label: "BANANES", unitPriceCents: 199, qty: 1.204, unit: "kg", rate: 550 },
      { label: "EAU MINERALE 6X1,5L", unitPriceCents: 330, rate: 550 },
      { label: "ESSUIE TOUT X4", unitPriceCents: 455, rate: 2000 },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "4821",
    footer: ["MERCI DE VOTRE VISITE", "A BIENTOT"],
    difficulty: ["clean", "supermarket", "weighted-item", "discount"],
    degrade: { format: "png" },
  },
  {
    id: "leclerc-2026-10-01",
    kind: "thermal",
    merchant: "E.Leclerc",
    merchantRaw: "E.LECLERC HYPER 0457",
    headerExtra: ["SAS DISTRI OUEST"],
    address: ["ZAC DU MOULIN", "44000 NANTES"],
    siret: "000 000 457 00027",
    date: [2026, 10, 3],
    dateFormat: "dmy4",
    time: [11, 7],
    timeFormat: "colon",
    register: "CAISSE 12",
    qtyStyle: "below",
    vatLetters: SUPER_LETTERS,
    items: [
      { label: "LAIT ENTIER BIO 1L", unitPriceCents: 139, qty: 6, rate: 550 },
      { label: "OEUFS PLEIN AIR X12", unitPriceCents: 429, rate: 550 },
      { label: "BEURRE DOUX 250G", unitPriceCents: 259, rate: 550 },
      { label: "EMMENTAL RAPE 200G", unitPriceCents: 215, rate: 550 },
      { label: "JAMBON BLANC X4", unitPriceCents: 349, rate: 550 },
      { label: "POULET FERMIER", unitPriceCents: 1290, qty: 1.535, unit: "kg", rate: 550 },
      { label: "POMMES GOLDEN", unitPriceCents: 249, qty: 1.12, unit: "kg", rate: 550 },
      { label: "CAROTTES VRAC", unitPriceCents: 149, qty: 0.876, unit: "kg", rate: 550 },
      { label: "TOMATES GRAPPE", unitPriceCents: 349, qty: 0.754, unit: "kg", rate: 550 },
      { label: "SALADE BATAVIA", unitPriceCents: 99, rate: 550 },
      { label: "PATES PENNE 500G", unitPriceCents: 109, qty: 3, rate: 550 },
      { label: "RIZ BASMATI 1KG", unitPriceCents: 289, rate: 550 },
      { label: "HUILE OLIVE 1L", unitPriceCents: 899, rate: 550 },
      { label: "SUCRE EN POUDRE 1KG", unitPriceCents: 119, rate: 550 },
      { label: "FARINE T55 1KG", unitPriceCents: 95, rate: 550 },
      {
        label: "CHOCOLAT NOIR 70%",
        unitPriceCents: 219,
        qty: 2,
        rate: 550,
        discount: { label: "REMISE 2EME -50%", cents: -110 },
      },
      { label: "JUS ORANGE 1L", unitPriceCents: 235, qty: 2, rate: 550 },
      { label: "BIERE BLONDE 6X25CL", unitPriceCents: 549, rate: 2000 },
      { label: "VIN ROUGE AOC 75CL", unitPriceCents: 695, rate: 2000 },
      { label: "CHIPS NATURE 200G", unitPriceCents: 179, rate: 550 },
      { label: "BISCUITS PETIT BEURRE", unitPriceCents: 145, rate: 550 },
      { label: "SHAMPOOING 250ML", unitPriceCents: 325, rate: 2000 },
      { label: "DENTIFRICE 75ML", unitPriceCents: 219, rate: 2000 },
      { label: "PAPIER TOILETTE X12", unitPriceCents: 589, rate: 2000 },
      {
        label: "LIQUIDE VAISSELLE",
        unitPriceCents: 199,
        rate: 2000,
        discount: { label: "BON DE REDUCTION", cents: -50 },
      },
      { label: "SACS POUBELLE 30L", unitPriceCents: 249, rate: 2000 },
      { label: "CROQUETTES CHAT 2KG", unitPriceCents: 1149, rate: 2000 },
      { label: "PILES AA X4", unitPriceCents: 599, rate: 2000 },
      { label: "SAC CABAS", unitPriceCents: 15, rate: 2000 },
    ],
    totalLabel: "A PAYER",
    payment: "card",
    cardLast4: "7310",
    footer: ["Ticket a conserver", "MERCI ET A BIENTOT"],
    difficulty: ["long", "supermarket", "weighted-item", "discount", "a-payer"],
    degrade: { format: "jpg", quality: 80, noise: 10 },
  },
  {
    id: "lidl-2026-09-01",
    kind: "thermal",
    merchant: "Lidl",
    merchantRaw: "LIDL 1842",
    headerExtra: [],
    address: ["8 AVENUE DE LA GARE", "59000 LILLE"],
    siret: "000 001 842 00035",
    date: [2026, 9, 22],
    dateFormat: "dot",
    time: [17, 5],
    timeFormat: "colon",
    register: "KASSE 2",
    qtyStyle: "below",
    vatLetters: SUPER_LETTERS,
    items: [
      { label: "BAGUETTE TRADITION", unitPriceCents: 99, qty: 2, rate: 550 },
      { label: "FROMAGE BLANC 1KG", unitPriceCents: 199, rate: 550 },
      { label: "COMPOTE POMME X4", unitPriceCents: 139, rate: 550 },
      { label: "STEAK HACHE 5% X2", unitPriceCents: 359, rate: 550 },
      { label: "BROSSE A DENTS X2", unitPriceCents: 249, rate: 2000 },
      { label: "CAPSULES CAFE X10", unitPriceCents: 229, qty: 2, rate: 550 },
    ],
    totalLabel: "TOTAL",
    payment: "card",
    cardLast4: "0954",
    footer: ["Merci de votre visite"],
    difficulty: ["photo", "rotated", "noise", "supermarket", "date-dot"],
    degrade: { format: "jpg", quality: 78, background: true, rotate: 2.5, noise: 18 },
  },
  {
    id: "intermarche-2026-08-01",
    kind: "thermal",
    merchant: "Intermarché",
    merchantRaw: "INTERMARCHE SUPER 2290",
    headerExtra: ["Les Mousquetaires"],
    address: ["ROUTE DE PARIS", "45000 ORLEANS"],
    siret: "000 002 290 00041",
    date: [2026, 8, 9],
    dateFormat: "dmy2",
    time: [9, 31],
    timeFormat: "colon",
    register: "CAISSE 05",
    qtyStyle: "below",
    vatLetters: SUPER_LETTERS,
    items: [
      { label: "CROISSANTS X6", unitPriceCents: 289, rate: 550 },
      { label: "CONFITURE FRAISE", unitPriceCents: 249, rate: 550 },
      { label: "THE VERT X25", unitPriceCents: 199, rate: 550 },
      { label: "PECHES JAUNES", unitPriceCents: 399, qty: 0.982, unit: "kg", rate: 550 },
      { label: "CREME SOLAIRE SPF50", unitPriceCents: 1290, rate: 2000 },
    ],
    totalLabel: "TOTAL TTC",
    payment: "cash",
    cashGivenCents: 3000,
    footer: ["MERCI DE VOTRE FIDELITE"],
    difficulty: ["faded", "low-contrast", "supermarket", "date-short-year", "cash"],
    degrade: { format: "jpg", quality: 82, linear: [0.32, 168] },
  },
  {
    id: "boulangerie-2026-11-01",
    kind: "thermal",
    merchant: "Boulangerie du Marché",
    merchantRaw: "BOULANGERIE DU MARCHE",
    headerExtra: ["Artisan boulanger"],
    address: ["3 PLACE DU MARCHE", "33000 BORDEAUX"],
    siret: "000 000 333 00019",
    date: [2026, 11, 2],
    dateFormat: "dmy2",
    time: [7, 48],
    timeFormat: "colon",
    qtyStyle: "prefix",
    width: 34,
    items: [
      { label: "BAGUETTE TRADITION", unitPriceCents: 125, qty: 2, rate: 550 },
      { label: "CROISSANT", unitPriceCents: 115, qty: 3, rate: 550 },
      { label: "TARTE AUX POMMES", unitPriceCents: 1450, rate: 550 },
    ],
    totalLabel: "TOTAL",
    payment: "cash",
    cashGivenCents: 2000,
    footer: ["Merci et bonne journee"],
    difficulty: ["clean", "small", "bakery", "cash", "date-short-year"],
    degrade: { format: "png" },
  },
  {
    id: "bistrot-2026-10-01",
    kind: "thermal",
    merchant: "Le Bistrot des Halles",
    merchantRaw: "LE BISTROT DES HALLES",
    headerExtra: ["Restaurant - Bar"],
    address: ["21 RUE DES HALLES", "75001 PARIS"],
    siret: "000 000 754 00028",
    date: [2026, 10, 17],
    dateFormat: "dmy4",
    time: [21, 15],
    timeFormat: "h",
    register: "TABLE 12",
    qtyStyle: "prefix",
    items: [
      { label: "MENU DU JOUR", unitPriceCents: 1650, qty: 2, rate: 1000 },
      { label: "ENTRECOTE FRITES", unitPriceCents: 2200, rate: 1000 },
      { label: "CAFE GOURMAND", unitPriceCents: 790, qty: 2, rate: 1000 },
      { label: "CARAFE VIN ROUGE 50CL", unitPriceCents: 1600, rate: 2000 },
      { label: "EAU PETILLANTE 1L", unitPriceCents: 550, rate: 1000 },
    ],
    totalLabel: "NET A PAYER",
    payment: "card",
    cardLast4: "6627",
    footer: ["Service compris", "Merci de votre visite"],
    difficulty: ["restaurant", "vat-10", "net-a-payer", "time-h"],
    degrade: { format: "jpg", quality: 84, rotate: 1.2 },
  },
  {
    id: "totalenergies-2026-09-01",
    kind: "thermal",
    merchant: "TotalEnergies",
    merchantRaw: "TOTALENERGIES RELAIS",
    headerExtra: ["RELAIS DES ALPES"],
    address: ["RN 85", "38000 GRENOBLE"],
    siret: "000 000 385 00052",
    date: [2026, 9, 5],
    dateFormat: "dmy4",
    time: [8, 12],
    timeFormat: "colon",
    register: "POMPE 05",
    qtyStyle: "below",
    items: [
      { label: "GAZOLE", unitPriceCents: 179, qty: 38.52, unit: "L", rate: 2000 },
      { label: "LAVAGE PROGRAMME 2", unitPriceCents: 900, rate: 2000 },
    ],
    totalLabel: "MONTANT TTC",
    payment: "card",
    cardLast4: "1188",
    footer: ["Bonne route"],
    difficulty: ["fuel", "litres", "blur"],
    degrade: { format: "jpg", quality: 82, blur: 0.8 },
  },
  {
    id: "pharmacie-2026-11-01",
    kind: "thermal",
    merchant: "Pharmacie Centrale",
    merchantRaw: "PHARMACIE CENTRALE",
    headerExtra: ["Pharmacien titulaire"],
    address: ["5 BD VICTOR HUGO", "06000 NICE"],
    siret: "000 000 606 00014",
    date: [2026, 11, 6],
    dateFormat: "dmy4",
    time: [16, 3],
    timeFormat: "colon",
    qtyStyle: "below",
    vatLetters: { 210: "1", 1000: "2", 2000: "3" },
    items: [
      { label: "PARACETAMOL 1G CPR", unitPriceCents: 218, qty: 2, rate: 210 },
      { label: "SIROP TOUX SECHE", unitPriceCents: 695, rate: 1000 },
      { label: "SERUM PHYSIO X40", unitPriceCents: 449, rate: 2000 },
      { label: "CREME MAINS 50ML", unitPriceCents: 790, rate: 2000 },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "3047",
    footer: ["Prenez soin de vous"],
    difficulty: ["pharmacy", "vat-2.1", "clean"],
    degrade: { format: "png" },
  },
  {
    id: "leroymerlin-2026-07-01",
    kind: "thermal",
    merchant: "Leroy Merlin",
    merchantRaw: "LEROY MERLIN 0071",
    headerExtra: ["Bricolage Jardin Maison"],
    address: ["CENTRE CIAL LES PORTES", "31000 TOULOUSE"],
    siret: "000 000 071 00066",
    date: [2026, 7, 11],
    dateFormat: "dmy4",
    time: [15, 26],
    timeFormat: "colon",
    register: "CAISSE 21",
    qtyStyle: "below",
    items: [
      { label: "PERCEUSE VISSEUSE 18V", unitPriceCents: 8990, rate: 2000 },
      { label: "CHEVILLES X100", unitPriceCents: 495, rate: 2000 },
      { label: "VIS BOIS 4X40 X200", unitPriceCents: 790, qty: 2, rate: 2000 },
      {
        label: "PEINTURE BLANC MAT 2L",
        unitPriceCents: 2490,
        rate: 2000,
        discount: { label: "REMISE CARTE MAISON", cents: -249 },
      },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "9902",
    warrantyYears: 2,
    footer: ["Conservez ce ticket"],
    difficulty: ["diy", "warranty", "discount", "rotated"],
    degrade: { format: "jpg", quality: 84, rotate: -1.5 },
  },
  {
    id: "kiabi-2026-10-01",
    kind: "thermal",
    merchant: "Kiabi",
    merchantRaw: "KIABI 0388",
    headerExtra: [],
    address: ["PARC DES MOUETTES", "76600 LE HAVRE"],
    siret: "000 000 388 00073",
    date: [2026, 10, 25],
    dateFormat: "dmy4",
    time: [14, 52],
    timeFormat: "colon",
    register: "CAISSE 2",
    qtyStyle: "below",
    items: [
      { label: "JEAN SLIM BRUT T40", unitPriceCents: 2500, rate: 2000 },
      { label: "T-SHIRT COTON BIO", unitPriceCents: 600, qty: 3, rate: 2000 },
      {
        label: "PULL COL ROND",
        unitPriceCents: 2200,
        rate: 2000,
        discount: { label: "SOLDES -30%", cents: -660 },
      },
      { label: "CHAUSSETTES X5", unitPriceCents: 800, rate: 2000 },
    ],
    totalLabel: "A PAYER",
    payment: "card",
    cardLast4: "5576",
    returnDays: 30,
    footer: ["Echange sur presentation du ticket"],
    difficulty: ["clothing", "return", "discount", "a-payer", "crop"],
    degrade: { format: "jpg", quality: 84, crop: { left: 0.02, right: 0.02, top: 0.01 } },
  },
  {
    id: "tabac-2026-11-01",
    kind: "thermal",
    merchant: "Tabac Presse Le Balto",
    merchantRaw: "TABAC PRESSE LE BALTO",
    headerExtra: ["Bar - Tabac - Presse - Loto"],
    address: ["2 RUE DE LA REPUBLIQUE", "13001 MARSEILLE"],
    siret: "000 000 130 00085",
    date: [2026, 11, 12],
    dateFormat: "dmy4",
    time: [18, 42],
    timeFormat: "h",
    qtyStyle: "below",
    width: 34,
    items: [
      { label: "LE QUOTIDIEN DU JOUR", unitPriceCents: 230, rate: 210 },
      { label: "MAGAZINE TELE", unitPriceCents: 150, rate: 210 },
      { label: "BRIQUET", unitPriceCents: 200, rate: 2000 },
      { label: "CHEWING GUM MENTHE", unitPriceCents: 160, qty: 2, rate: 2000 },
    ],
    totalLabel: "TOTAL",
    payment: "cash",
    cashGivenCents: 1000,
    footer: ["Merci, a demain"],
    difficulty: ["press", "vat-2.1", "cash", "time-h", "small"],
    degrade: { format: "jpg", quality: 80, noise: 12 },
  },
  {
    id: "cafe-2026-11-01",
    kind: "thermal",
    merchant: "Café de la Gare",
    merchantRaw: "CAFE DE LA GARE",
    headerExtra: [],
    address: ["1 PLACE DE LA GARE", "67000 STRASBOURG"],
    siret: "000 000 670 00090",
    date: [2026, 11, 9],
    dateFormat: "dmy4",
    time: [8, 5],
    timeFormat: "colon",
    register: "TABLE 4",
    qtyStyle: "prefix",
    width: 34,
    items: [
      { label: "EXPRESSO", unitPriceCents: 180, qty: 2, rate: 1000 },
      { label: "CROISSANT", unitPriceCents: 130, rate: 1000 },
      { label: "JUS ORANGE PRESSE", unitPriceCents: 450, rate: 1000 },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "2209",
    footer: ["A bientot"],
    difficulty: ["cafe", "vat-10", "blur", "small"],
    degrade: { format: "jpg", quality: 80, blur: 1.3 },
  },
  {
    id: "epicerie-2026-12-01",
    kind: "thermal",
    merchant: "Épicerie Fine des Prés",
    merchantRaw: "ÉPICERIE FINE DES PRÉS",
    headerExtra: ["Produits régionaux à la française"],
    address: ["9 rue de l'Église", "84000 AVIGNON"],
    siret: "000 000 840 00012",
    date: [2026, 12, 19],
    dateFormat: "dmy4",
    time: [17, 34],
    timeFormat: "colon",
    qtyStyle: "below",
    vatLetters: { 550: "A", 2000: "C" },
    items: [
      { label: "Crème brûlée x2", unitPriceCents: 590, rate: 550 },
      { label: "Pâté de campagne", unitPriceCents: 645, rate: 550 },
      { label: "Bûche pâtissière", unitPriceCents: 2490, rate: 550 },
      { label: "Fromage affiné 250g", unitPriceCents: 780, rate: 550 },
      { label: "Pain d'épices maïs", unitPriceCents: 520, rate: 550 },
      { label: "Côtes-du-Rhône 75cl", unitPriceCents: 1290, qty: 2, rate: 2000 },
      { label: "Thé glacé pêche", unitPriceCents: 390, rate: 550 },
      { label: "Sel de Guérande", unitPriceCents: 450, rate: 550 },
      { label: "Œufs frais façon grand-mère", unitPriceCents: 420, rate: 550 },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "8410",
    footer: ["Joyeuses fêtes, où que vous soyez", "Merci, à très bientôt"],
    difficulty: ["accents", "clean"],
    degrade: { format: "png" },
  },
  {
    id: "monoprix-2026-06-01",
    kind: "thermal",
    merchant: "Monoprix",
    merchantRaw: "MONOPRIX 0614",
    headerExtra: [],
    address: ["40 AVENUE JEAN JAURES", "92100 BOULOGNE"],
    siret: "000 000 614 00038",
    date: [2026, 6, 27],
    dateFormat: "dmy4",
    time: [19, 58],
    timeFormat: "colon",
    register: "CAISSE 08",
    qtyStyle: "below",
    vatLetters: SUPER_LETTERS,
    items: [
      { label: "SALADE CESAR", unitPriceCents: 450, rate: 550 },
      { label: "EAU GAZEUSE 50CL", unitPriceCents: 85, qty: 2, rate: 550 },
      { label: "FRAISES 250G", unitPriceCents: 349, rate: 550 },
      { label: "GEL DOUCHE", unitPriceCents: 299, rate: 2000 },
      { label: "BOUGIE PARFUMEE", unitPriceCents: 999, rate: 2000 },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "3351",
    footer: ["Merci de votre visite"],
    difficulty: ["photo", "skewed", "noise", "supermarket"],
    degrade: {
      format: "jpg",
      quality: 76,
      background: true,
      rotate: -4,
      noise: 14,
      blur: 0.6,
    },
  },
  {
    id: "auchan-2026-05-01",
    kind: "thermal",
    merchant: "Auchan",
    merchantRaw: "AUCHAN SUPERMARCHE 0915",
    headerExtra: [],
    address: ["1 RUE DU COMMERCE", "51100 REIMS"],
    siret: "000 000 915 00047",
    date: [2026, 5, 16],
    dateFormat: "dmy2",
    time: [12, 20],
    timeFormat: "colon",
    register: "CAISSE 1",
    qtyStyle: "below",
    vatLetters: SUPER_LETTERS,
    items: [
      { label: "MOZZARELLA 125G", unitPriceCents: 89, qty: 3, rate: 550 },
      { label: "PIZZA JAMBON", unitPriceCents: 329, rate: 550 },
      { label: "SODA COLA 1,5L", unitPriceCents: 189, rate: 550 },
      {
        label: "ARROSOIR 10L",
        unitPriceCents: 599,
        rate: 2000,
        discount: { label: "REMISE IMMEDIATE", cents: -100 },
      },
      { label: "TERREAU 40L", unitPriceCents: 749, rate: 1000 },
    ],
    totalLabel: "A PAYER",
    payment: "card",
    cardLast4: "6408",
    footer: ["Merci et a bientot"],
    difficulty: ["photo", "blur", "rotated", "supermarket", "a-payer", "date-short-year"],
    degrade: { format: "jpg", quality: 78, rotate: 3.2, blur: 1, noise: 8 },
  },
  {
    id: "picard-2026-04-01",
    kind: "thermal",
    merchant: "Picard",
    merchantRaw: "PICARD SURGELES 0702",
    headerExtra: [],
    address: ["17 COURS GAMBETTA", "34000 MONTPELLIER"],
    siret: "000 000 702 00059",
    date: [2026, 4, 3],
    dateFormat: "dot",
    time: [18, 9],
    timeFormat: "h",
    qtyStyle: "below",
    vatLetters: { 550: "A" },
    items: [
      { label: "LEGUMES GRILLES 600G", unitPriceCents: 499, rate: 550 },
      { label: "GLACE VANILLE 1L", unitPriceCents: 549, rate: 550 },
      { label: "CREVETTES CUITES", unitPriceCents: 1095, rate: 550 },
      { label: "FRITES ALLUMETTES", unitPriceCents: 319, qty: 2, rate: 550 },
    ],
    totalLabel: "TOTAL",
    payment: "card",
    cardLast4: "7765",
    footer: ["A bientot chez Picard"],
    difficulty: ["low-contrast", "noise", "date-dot", "time-h"],
    degrade: { format: "jpg", quality: 80, linear: [0.6, 90], noise: 10 },
  },
  {
    id: "fnac-2026-10-01",
    kind: "pdf",
    merchant: "Fnac",
    merchantRaw: "FNAC.COM",
    headerExtra: ["Facture n° FAC-2026-000184"],
    address: ["Fnac Direct - 9 rue des Bateaux-Lavoirs", "94200 Ivry-sur-Seine"],
    siret: "000 000 942 00010",
    date: [2026, 10, 8],
    dateFormat: "dmy4",
    time: null,
    timeFormat: "colon",
    qtyStyle: "below",
    items: [
      { label: "Casque audio sans fil", unitPriceCents: 12999, rate: 2000 },
      { label: "Roman poche - Le Grand Meaulnes", unitPriceCents: 790, rate: 550 },
      { label: "Câble USB-C 1 m", unitPriceCents: 1499, qty: 2, rate: 2000 },
      {
        label: "Frais de livraison",
        unitPriceCents: 399,
        rate: 2000,
        discount: { label: "Livraison offerte adhérent", cents: -399 },
      },
    ],
    totalLabel: "TOTAL TTC",
    payment: "card",
    cardLast4: "4821",
    warrantyYears: 2,
    footer: ["Merci pour votre commande."],
    difficulty: ["pdf", "e-commerce", "warranty"],
    degrade: { format: "png" },
  },
  {
    id: "cdiscount-2026-09-01",
    kind: "pdf",
    merchant: "Cdiscount",
    merchantRaw: "CDISCOUNT",
    headerExtra: ["Facture n° CD-26-0912-55"],
    address: ["120-126 quai de Bacalan", "33000 Bordeaux"],
    siret: "000 000 331 00024",
    date: [2026, 9, 14],
    dateFormat: "dmy4",
    time: null,
    timeFormat: "colon",
    qtyStyle: "below",
    items: [
      { label: "Aspirateur balai", unitPriceCents: 14990, rate: 2000 },
      { label: "Lot 4 filtres", unitPriceCents: 1290, rate: 2000 },
      {
        label: "Cafetière filtre",
        unitPriceCents: 3499,
        rate: 2000,
        discount: { label: "Code promo BIENVENUE", cents: -500 },
      },
    ],
    totalLabel: "NET A PAYER",
    payment: "card",
    cardLast4: "2290",
    returnDays: 30,
    footer: ["Conditions générales de vente disponibles en ligne."],
    difficulty: ["pdf", "e-commerce", "return", "net-a-payer"],
    degrade: { format: "png" },
  },
];

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

async function renderThermal(browser: Browser, r: ReceiptDef, lines: Line[]): Promise<Buffer> {
  const page = await browser.newPage({ deviceScaleFactor: r.degrade.scale ?? 2 });
  await page.setContent(thermalHtml(lines, r.width ?? 40));
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator("#r").screenshot({ type: "png" });
  await page.close();
  return png;
}

async function renderPdf(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await page.close();
  return pdf;
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const selected = only.size ? RECEIPTS.filter((r) => only.has(r.id)) : RECEIPTS;
  if (selected.length === 0) throw new Error(`Aucune fixture ne correspond : ${[...only]}`);
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const r of selected) {
      const dir = path.join(OUT_DIR, r.id);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const expected = buildExpected(r);
      let truth: string[];
      let file: string;
      let bytes: Buffer;
      if (r.kind === "pdf") {
        const out = pdfLines(r, expected);
        truth = out.truth;
        file = "source.pdf";
        bytes = await renderPdf(browser, out.html);
      } else {
        const lines = thermalLines(r, expected);
        truth = lines.map((l) => l.text);
        file = `source.${r.degrade.format}`;
        bytes = await degrade(await renderThermal(browser, r, lines), r.degrade, r.id);
      }
      await writeFile(path.join(dir, file), bytes);
      await writeFile(path.join(dir, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
      await writeFile(path.join(dir, "truth.txt"), `${truth.map((l) => l.trimEnd()).join("\n")}\n`);
      console.log(`${r.id.padEnd(28)} ${file.padEnd(11)} ${(bytes.length / 1024).toFixed(0)} Ko`);
    }
  } finally {
    await browser.close();
  }
  const known = new Set(RECEIPTS.map((r) => r.id));
  const stale = (await readdir(OUT_DIR)).filter((d) => !known.has(d));
  if (stale.length) console.warn(`Dossiers non générés par ce script : ${stale.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
