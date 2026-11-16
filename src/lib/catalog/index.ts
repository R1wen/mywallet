/**
 * French default catalogue (ADR-015, ADR-023): category tree and common merchants with
 * their domain, default category and raw label aliases. Used by sign-up provisioning and
 * the demo seed. Relative imports: also loaded by scripts run with tsx.
 */
import {
  siAirbnb,
  siAldinord,
  siApple,
  siAuchan,
  siBookingdotcom,
  siBoulanger,
  siBurgerking,
  siCarrefour,
  siCastorama,
  siDarty,
  siDeezer,
  siDeliveroo,
  siEdotleclerc,
  siFnac,
  siFranprix,
  siIkea,
  siIledefrancemobilites,
  siIntermarche,
  siKfc,
  siLeroymerlin,
  siLidl,
  siMcdonalds,
  siMonoprix,
  siNetflix,
  siOrange,
  siPicardsurgeles,
  siShell,
  siSncf,
  siSpotify,
  siStarbucks,
  siUber,
  siUbereats,
  siUniqlo,
  siVinted,
  siZalando,
  type SimpleIcon,
} from "simple-icons";
import type { categories, CategoryKind, merchants } from "../db/schema/finance";
import { normalizeMerchantName } from "../domain/merchant";

export const CATEGORY_TREE: {
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
export const MERCHANTS: [string, string | null, string, string[]][] = [
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

/**
 * simple-icons (CC0) brand marks for catalogue merchants, imported one by one so only
 * these few paths are bundled. Rendered monochrome on --surface-2 (charter: one accent).
 */
const BRAND_ICONS: Record<string, SimpleIcon> = {
  Carrefour: siCarrefour,
  "E.Leclerc": siEdotleclerc,
  Auchan: siAuchan,
  Intermarché: siIntermarche,
  Lidl: siLidl,
  Aldi: siAldinord,
  Monoprix: siMonoprix,
  Franprix: siFranprix,
  Picard: siPicardsurgeles,
  Fnac: siFnac,
  Darty: siDarty,
  Boulanger: siBoulanger,
  Apple: siApple,
  IKEA: siIkea,
  "Leroy Merlin": siLeroymerlin,
  Castorama: siCastorama,
  Zalando: siZalando,
  Vinted: siVinted,
  Uniqlo: siUniqlo,
  "McDonald's": siMcdonalds,
  "Burger King": siBurgerking,
  KFC: siKfc,
  Starbucks: siStarbucks,
  Deliveroo: siDeliveroo,
  "Uber Eats": siUbereats,
  "SNCF Connect": siSncf,
  "Île-de-France Mobilités": siIledefrancemobilites,
  Uber: siUber,
  Shell: siShell,
  Orange: siOrange,
  Netflix: siNetflix,
  Spotify: siSpotify,
  Deezer: siDeezer,
  Airbnb: siAirbnb,
  "Booking.com": siBookingdotcom,
};

export type BrandIcon = { slug: string; title: string; path: string };

const toBrand = (icon: SimpleIcon): BrandIcon => ({
  slug: icon.slug,
  title: icon.title,
  path: icon.path,
});

const brandByName = new Map<string, BrandIcon>();
const brandByDomain = new Map<string, BrandIcon>();
for (const [name, domain] of MERCHANTS) {
  const icon = BRAND_ICONS[name];
  if (!icon) continue;
  brandByName.set(normalizeMerchantName(name), toBrand(icon));
  if (domain) brandByDomain.set(domain, toBrand(icon));
}

/** Brand icon for a merchant, matched on its domain first, then its normalized name. */
export function brandIconFor(m: {
  normalizedName: string;
  domain: string | null;
}): BrandIcon | null {
  return (
    (m.domain ? brandByDomain.get(m.domain) : undefined) ??
    brandByName.get(m.normalizedName) ??
    null
  );
}

/* -------------------------------------------------------------------------- */
/* Rows for a user (sign-up provisioning and demo seed)                      */
/* -------------------------------------------------------------------------- */

export type CatalogRows = {
  categories: (typeof categories.$inferInsert)[];
  merchants: (typeof merchants.$inferInsert)[];
  /** Category key -> id. */
  categoryIds: Map<string, string>;
  /** Merchant display name -> id. */
  merchantIds: Map<string, string>;
  /** Merchant display name -> default category key. */
  merchantCategory: Map<string, string>;
};

/** Default categories and the French merchant catalogue for one user. */
export function buildCatalogRows(userId: string, newId: () => string): CatalogRows {
  const categoryIds = new Map<string, string>();
  const merchantIds = new Map<string, string>();
  const merchantCategory = new Map<string, string>();
  const categoryRows: (typeof categories.$inferInsert)[] = [];

  CATEGORY_TREE.forEach((root, i) => {
    const rootId = newId();
    categoryIds.set(root.key, rootId);
    categoryRows.push({
      id: rootId,
      userId,
      name: root.name,
      kind: root.kind,
      icon: root.icon,
      position: i,
    });
    root.children.forEach(([key, name], j) => {
      const childId = newId();
      categoryIds.set(key, childId);
      categoryRows.push({
        id: childId,
        userId,
        parentId: rootId,
        name,
        kind: root.kind,
        position: j,
      });
    });
  });

  const merchantRows = MERCHANTS.map(([name, domain, categoryKey, aliases]) => {
    const id = newId();
    const defaultCategoryId = categoryIds.get(categoryKey);
    if (!defaultCategoryId) throw new Error(`unknown category ${categoryKey}`);
    merchantIds.set(name, id);
    merchantCategory.set(name, categoryKey);
    const normalizedName = normalizeMerchantName(name);
    return {
      id,
      userId,
      name,
      normalizedName,
      aliases: [...new Set(aliases.map(normalizeMerchantName))].filter(
        (a) => a && a !== normalizedName,
      ),
      domain,
      defaultCategoryId,
    };
  });

  const keys = merchantRows.map((m) => m.normalizedName);
  const dupes = keys.filter((k, i) => !k || keys.indexOf(k) !== i);
  if (dupes.length) throw new Error(`normalized merchant names collide: ${dupes.join(", ")}`);

  return {
    categories: categoryRows,
    merchants: merchantRows,
    categoryIds,
    merchantIds,
    merchantCategory,
  };
}
