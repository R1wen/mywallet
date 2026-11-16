/**
 * Benchmark OCR des tickets (spike Sprint 3, ADR-008). Ne tourne PAS dans `pnpm test`.
 *
 * Usage :
 *   pnpm ocr:bench                                   # fixtures publiques, écrit ocr.*.txt
 *   pnpm ocr:bench --dir fixtures/receipts-private   # tickets réels : agrégats seulement
 *   pnpm ocr:bench --engines tesseract,paddle-v6-tiny --no-write --json <fichier>
 *   pnpm ocr:bench --no-deskew --no-write            # sans redressement (comparaison)
 *   pnpm ocr:bench --only <id>,<id> --print          # texte brut à l'écran (public seulement)
 *
 * Chaîne identique pour chaque moteur : normalisation (scripts/ocr/normalise.ts : orientation
 * EXIF, niveaux de gris, grand côté <= 2000 px comme ADR-027, redressement par profil de
 * projection) -> OCR -> parseur déterministe s'il existe
 * (`src/lib/domain/receipts/parse.ts`, importé dynamiquement).
 * Les PDF à couche texte sont lus avec pdfjs-dist et rapportés à part (moteur `pdf-text`).
 *
 * Confidentialité : avec un dossier privé (tout dossier autre que fixtures/receipts), rien
 * n'est affiché ni écrit hors de ce dossier, à part des agrégats (pas d'identifiant, pas de
 * texte, pas de valeur). Les sorties brutes ocr.*.txt restent dans le dossier privé.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PaddleOcrService } from "ppu-paddle-ocr";
import type { Worker as TesseractWorker } from "tesseract.js";
import { normalise } from "./ocr/normalise";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "fixtures", "receipts");
const PARSER = path.join(ROOT, "src", "lib", "domain", "receipts", "parse.ts");
const TESS_CACHE = path.join(os.homedir(), ".cache", "tesseract.js");
const PADDLE_CACHE = path.join(os.homedir(), ".cache", "ppu-paddle-ocr");

/** Variante Paddle dont la sortie est enregistrée sous `ocr.paddle.txt`. */
const PRIMARY_PADDLE = "paddle-v6-small";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

type Args = {
  dir: string;
  engines: string[];
  write: boolean;
  json: string | null;
  only: string[];
  deskew: boolean;
  print: boolean;
};

const ALL_ENGINES = ["tesseract", "paddle-v6-tiny", "paddle-v5-latin", "paddle-v6-small"];

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dir: PUBLIC_DIR,
    engines: ALL_ENGINES,
    write: true,
    json: null,
    only: [],
    deskew: true,
    print: false,
  };
  const rest = [...argv];
  while (rest.length) {
    const k = rest.shift();
    if (k === "--") continue;
    if (k === "--no-write") {
      a.write = false;
      continue;
    }
    if (k === "--no-deskew") {
      a.deskew = false;
      continue;
    }
    if (k === "--print") {
      a.print = true;
      continue;
    }
    const v = rest.shift();
    if (!v) throw new Error(`Valeur manquante pour ${k}`);
    if (k === "--dir") a.dir = path.resolve(ROOT, v);
    else if (k === "--engines") a.engines = v.split(",");
    else if (k === "--json") a.json = path.resolve(ROOT, v);
    else if (k === "--only") a.only = v.split(",");
    else throw new Error(`Argument inconnu : ${k}`);
  }
  const unknown = a.engines.filter((e) => !ALL_ENGINES.includes(e));
  if (unknown.length) throw new Error(`Moteurs inconnus : ${unknown.join(", ")}`);
  return a;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ExpectedItem = { label: string; quantity: number; unitPriceCents: number; totalCents: number };
type Expected = {
  merchant: string;
  merchantRaw: string;
  date: string;
  time: string | null;
  currency: string;
  totalCents: number;
  paymentMethod: string | null;
  vat: { rateBp: number; baseCents: number; vatCents: number }[];
  items: ExpectedItem[];
  discountsCents: number;
  returnDeadline: string | null;
  warrantyUntil: string | null;
  difficulty?: string[];
};

type Fixture = {
  id: string;
  dir: string;
  source: string;
  kind: "image" | "pdf";
  expected: Expected;
  truth: string | null;
};

const SOURCE_RE = /^source\.(png|jpe?g|webp|pdf)$/i;

async function loadFixtures(dir: string, only: string[]): Promise<Fixture[]> {
  const out: Fixture[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || (only.length && !only.includes(d.name))) continue;
    const fdir = path.join(dir, d.name);
    const files = await readdir(fdir);
    const source = files.find((f) => SOURCE_RE.test(f));
    if (!source || !files.includes("expected.json")) continue;
    const expected = JSON.parse(await readFile(path.join(fdir, "expected.json"), "utf8"));
    const truth = files.includes("truth.txt")
      ? await readFile(path.join(fdir, "truth.txt"), "utf8")
      : null;
    out.push({
      id: d.name,
      dir: fdir,
      source: path.join(fdir, source),
      kind: source.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
      expected,
      truth,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Normalisation et moteurs
// ---------------------------------------------------------------------------

type Engine = {
  id: string;
  init: () => Promise<void>;
  run: (img: Buffer) => Promise<string>;
  close: () => Promise<void>;
  /** Fichiers de modèle (octets sur disque après téléchargement). */
  modelFiles: () => Promise<{ name: string; bytes: number }[]>;
};

async function fileSize(p: string): Promise<number> {
  return existsSync(p) ? (await stat(p)).size : 0;
}

async function findInCache(dir: string, name: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  for (const sub of await readdir(dir, { withFileTypes: true })) {
    const p = sub.isDirectory() ? path.join(dir, sub.name, name) : path.join(dir, sub.name);
    if ((sub.isDirectory() || sub.name === name) && existsSync(p)) return p;
  }
  return null;
}

function tesseractEngine(): Engine {
  let worker: TesseractWorker | null = null;
  return {
    id: "tesseract",
    async init() {
      const { createWorker } = await import("tesseract.js");
      await mkdir(TESS_CACHE, { recursive: true });
      worker = await createWorker(["fra", "eng"], 1, { cachePath: TESS_CACHE });
    },
    async run(img) {
      const r = await worker!.recognize(img);
      return r.data.text;
    },
    async close() {
      await worker?.terminate();
    },
    async modelFiles() {
      return Promise.all(
        ["fra", "eng"].map(async (l) => ({
          name: `${l}.traineddata`,
          bytes: await fileSize(path.join(TESS_CACHE, `${l}.traineddata`)),
        })),
      );
    },
  };
}

function paddleEngine(id: string, preset: string): Engine {
  let service: PaddleOcrService | null = null;
  let urls: { detection: string; recognition: string; charactersDictionary: string } | null = null;
  return {
    id,
    async init() {
      const mod = await import("ppu-paddle-ocr");
      urls = mod.MODEL_PRESETS[preset as keyof typeof mod.MODEL_PRESETS];
      service = new mod.PaddleOcrService({
        model: urls,
        debugging: { debug: false, verbose: false },
      });
      await service.initialize();
    },
    async run(img) {
      const ab = img.buffer.slice(img.byteOffset, img.byteOffset + img.byteLength) as ArrayBuffer;
      const r = await service!.recognize(ab, { noCache: true });
      return r.text;
    },
    async close() {
      await service?.destroy();
    },
    async modelFiles() {
      if (!urls) return [];
      const names = [urls.detection, urls.recognition, urls.charactersDictionary].map((u) =>
        u.split("/").pop()!,
      );
      return Promise.all(
        names.map(async (name) => {
          const p = await findInCache(PADDLE_CACHE, name);
          return { name, bytes: p ? await fileSize(p) : 0 };
        }),
      );
    },
  };
}

function makeEngine(id: string): Engine {
  if (id === "tesseract") return tesseractEngine();
  if (id === "paddle-v6-tiny") return paddleEngine(id, "v6-tiny");
  if (id === "paddle-v6-small") return paddleEngine(id, "v6-small");
  return paddleEngine(id, "v5-latin-mobile");
}

/** Texte d'un PDF reconstitué par lignes (regroupement sur l'ordonnée). */
async function pdfText(file: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(file));
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      const row = rows.get(y) ?? [];
      row.push({ x: it.transform[4], s: it.str });
      rows.set(y, row);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      lines.push(
        rows
          .get(y)!
          .sort((a, b) => a.x - b.x)
          .map((r) => r.s.trim())
          .join(" "),
      );
    }
  }
  await task.destroy();
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Métriques texte
// ---------------------------------------------------------------------------

/** Lignes décoratives (-----, =====) : mise en page, ignorées des deux côtés pour le CER. */
const SEPARATOR = /^[-=_*~.·\s]{5,}$/;

/** Espaces multiples réduits, lignes vides et séparateurs retirés (colonnes non comparées). */
function normText(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !SEPARATOR.test(l))
    .join("\n");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function baseChar(c: string): string {
  const m: Record<string, string> = { œ: "oe", Œ: "OE", æ: "ae", Æ: "AE" };
  return (m[c] ?? stripAccents(c)).toLowerCase();
}

const ACCENTED = /[À-ÖØ-öø-ÿŒœ]/;

type Align = { distance: number; accentErrors: number; pairs: Map<string, number> };

/** Levenshtein (caractères) avec reconstitution des substitutions pour compter les accents. */
function align(truth: string, ocr: string): Align {
  const a = [...truth];
  const b = [...ocr];
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 0; i <= n; i++) dp[i * w] = i;
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * w + j] = Math.min(
        dp[(i - 1) * w + j]! + 1,
        dp[i * w + j - 1]! + 1,
        dp[(i - 1) * w + j - 1]! + cost,
      );
    }
  }
  let i = n;
  let j = m;
  let accentErrors = 0;
  const pairs = new Map<string, number>();
  while (i > 0 && j > 0) {
    const cur = dp[i * w + j]!;
    const diag = dp[(i - 1) * w + j - 1]!;
    const ca = a[i - 1]!;
    const cb = b[j - 1]!;
    if (cur === diag + (ca === cb ? 0 : 1)) {
      if (ca !== cb && (ACCENTED.test(ca) || ACCENTED.test(cb))) {
        if (baseChar(ca) === baseChar(cb) || baseChar(ca)[0] === baseChar(cb)[0]) {
          accentErrors++;
          const k = `${ca}->${cb}`;
          pairs.set(k, (pairs.get(k) ?? 0) + 1);
        }
      }
      i--;
      j--;
    } else if (cur === dp[(i - 1) * w + j]! + 1) {
      if (ACCENTED.test(a[i - 1]!)) {
        accentErrors++;
        const k = `${a[i - 1]}->(supprimé)`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
      i--;
    } else {
      j--;
    }
  }
  while (i > 0) {
    if (ACCENTED.test(a[i - 1]!)) accentErrors++;
    i--;
  }
  return { distance: dp[n * w + m]!, accentErrors, pairs };
}

function money(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** `needle` présent sans chiffre collé avant/après (20,33 ne valide pas 20,333). */
function hasToken(hay: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?<![\\d,.])${esc}(?!\\d)`).test(hay);
}

const DATE_RE = /\b\d{2}[/.]\d{2}[/.]\d{2,4}\b/;

/** Sans truth.txt (tickets réels) : formats d'impression courants de la date attendue. */
function dateVariants(isoDate: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return [];
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  return [`${d}/${mo}/${y}`, `${d}/${mo}/${y.slice(2)}`, `${d}.${mo}.${y}`, `${d}-${mo}-${y}`];
}

function merchantKey(s: string): string {
  return stripAccents(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Parseur (optionnel)
// ---------------------------------------------------------------------------

type Parsed = Partial<{
  merchantRaw: string | null;
  date: string | null;
  time: string | null;
  totalCents: number | null;
  currency: string | null;
  paymentMethod: string | null;
  vat: { rateBp: number; baseCents: number; vatCents: number }[] | null;
  items: { label: string; totalCents: number }[] | null;
  discountsCents: number | null;
  returnDeadline: string | null;
  warrantyUntil: string | null;
}>;
type ParseFn = (text: string) => Parsed;

async function loadParser(): Promise<ParseFn | null> {
  if (!existsSync(PARSER)) return null;
  try {
    const mod = (await import(pathToFileURL(PARSER).href)) as { parseReceiptText?: ParseFn };
    return typeof mod.parseReceiptText === "function" ? mod.parseReceiptText : null;
  } catch (e) {
    console.warn(`Parseur présent mais non chargeable : ${(e as Error).message}`);
    return null;
  }
}

const FIELDS = [
  "merchantRaw",
  "date",
  "time",
  "totalCents",
  "currency",
  "paymentMethod",
  "vat",
  "discountsCents",
  "returnDeadline",
  "warrantyUntil",
] as const;

type ParseScore = {
  fields: Record<string, boolean>;
  allExact: boolean;
  itemCountMatch: boolean;
  itemTp: number;
  itemParsed: number;
  itemExpected: number;
};

function sameVat(a: Parsed["vat"], b: Expected["vat"]): boolean {
  if (!a) return b.length === 0;
  const key = (v: { rateBp: number; baseCents: number; vatCents: number }) =>
    `${v.rateBp}:${v.baseCents}:${v.vatCents}`;
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
}

function scoreParse(p: Parsed, e: Expected): ParseScore {
  const fields: Record<string, boolean> = {};
  for (const f of FIELDS) {
    if (f === "vat") fields[f] = sameVat(p.vat ?? null, e.vat);
    else if (f === "merchantRaw")
      fields[f] = merchantKey(p.merchantRaw ?? "") === merchantKey(e.merchantRaw);
    else fields[f] = (p[f] ?? null) === e[f];
  }
  const items = p.items ?? [];
  const pool = new Map<string, number>();
  for (const it of e.items) {
    const k = `${merchantKey(it.label)}|${it.totalCents}`;
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  let tp = 0;
  for (const it of items) {
    const k = `${merchantKey(it.label ?? "")}|${it.totalCents}`;
    const left = pool.get(k) ?? 0;
    if (left > 0) {
      tp++;
      pool.set(k, left - 1);
    }
  }
  const itemCountMatch = items.length === e.items.length;
  return {
    fields,
    allExact: Object.values(fields).every(Boolean) && itemCountMatch && tp === e.items.length,
    itemCountMatch,
    itemTp: tp,
    itemParsed: items.length,
    itemExpected: e.items.length,
  };
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  tags: string[];
  engine: string;
  ms: number;
  cer: number | null;
  cerNoAccent: number | null;
  accentErrors: number;
  accentPairs: Map<string, number>;
  totalFound: boolean;
  dateFound: boolean | null;
  merchantFound: boolean;
  merchantNormFound: boolean;
  parse: ParseScore | null;
};

function evaluate(
  f: Fixture,
  engine: string,
  ms: number,
  text: string,
  parser: ParseFn | null,
): Row {
  const ocr = normText(text);
  const flat = ocr.replace(/\n/g, " ");
  const truth = f.truth ? normText(f.truth) : null;
  let cer: number | null = null;
  let cerNoAccent: number | null = null;
  let accentErrors = 0;
  let accentPairs = new Map<string, number>();
  if (truth) {
    const al = align(truth, ocr);
    cer = al.distance / Math.max(1, [...truth].length);
    accentErrors = al.accentErrors;
    accentPairs = al.pairs;
    const t2 = stripAccents(truth);
    cerNoAccent = align(t2, stripAccents(ocr)).distance / Math.max(1, [...t2].length);
  }
  const printedDate = f.truth?.match(DATE_RE)?.[0] ?? null;
  const dateCandidates = printedDate ? [printedDate] : dateVariants(f.expected.date);
  let parse: ParseScore | null = null;
  if (parser) {
    try {
      parse = scoreParse(parser(text), f.expected);
    } catch {
      parse = scoreParse({}, f.expected);
    }
  }
  return {
    id: f.id,
    tags: f.expected.difficulty ?? [],
    engine,
    ms,
    cer,
    cerNoAccent,
    accentErrors,
    accentPairs,
    totalFound: hasToken(flat, money(f.expected.totalCents)),
    dateFound: dateCandidates.length ? dateCandidates.some((d) => hasToken(flat, d)) : null,
    merchantFound: flat.includes(f.expected.merchantRaw),
    merchantNormFound: merchantKey(flat).includes(merchantKey(f.expected.merchantRaw)),
    parse,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function p95(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)} %` : "n/a");
const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : NaN);

type Summary = Record<string, string | number>;

function summarise(engine: string, rows: Row[], sizes: number | null): Summary {
  const r = rows.filter((x) => x.engine === engine);
  const cers = r.map((x) => x.cer).filter((x): x is number => x !== null);
  const s: Summary = {
    engine,
    n: r.length,
    meanMs: Math.round(mean(r.map((x) => x.ms))),
    p95Ms: Math.round(p95(r.map((x) => x.ms))),
    cer: pct(mean(cers)),
    cerNoAccent: pct(mean(r.map((x) => x.cerNoAccent).filter((x): x is number => x !== null))),
    totalFound: pct(rate(r.map((x) => x.totalFound))),
    dateFound: pct(rate(r.map((x) => x.dateFound).filter((x): x is boolean => x !== null))),
    merchantExact: pct(rate(r.map((x) => x.merchantFound))),
    merchantNorm: pct(rate(r.map((x) => x.merchantNormFound))),
    accentErrors: r.reduce((t, x) => t + x.accentErrors, 0),
  };
  if (sizes !== null) s.modelMB = Number((sizes / 1e6).toFixed(1));
  const parsed = r.map((x) => x.parse).filter((x): x is ParseScore => x !== null);
  if (parsed.length) {
    s.parseAllExact = pct(rate(parsed.map((p) => p.allExact)));
    for (const f of FIELDS) s[`parse.${f}`] = pct(rate(parsed.map((p) => p.fields[f]!)));
    s["parse.itemCount"] = pct(rate(parsed.map((p) => p.itemCountMatch)));
    const tp = parsed.reduce((t, p) => t + p.itemTp, 0);
    const np = parsed.reduce((t, p) => t + p.itemParsed, 0);
    const ne = parsed.reduce((t, p) => t + p.itemExpected, 0);
    const prec = np ? tp / np : 0;
    const rec = ne ? tp / ne : 0;
    s["parse.itemF1"] = pct(prec + rec ? (2 * prec * rec) / (prec + rec) : 0);
  }
  return s;
}

function table(rows: Summary[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const line = (cells: (string | number | undefined)[]) =>
    `| ${cells.map((c) => String(c ?? "")).join(" | ")} |`;
  return [
    line(cols),
    line(cols.map(() => "---")),
    ...rows.map((r) => line(cols.map((c) => r[c]))),
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const isPublic = path.resolve(args.dir) === PUBLIC_DIR;
  if (args.json && !isPublic && !args.json.startsWith(path.resolve(args.dir) + path.sep)) {
    throw new Error("Avec un dossier privé, --json doit pointer à l'intérieur de ce dossier.");
  }
  if (!existsSync(args.dir)) {
    console.log(`Dossier absent : ${path.relative(ROOT, args.dir)}. Rien à mesurer.`);
    return;
  }
  const fixtures = await loadFixtures(args.dir, args.only);
  if (fixtures.length === 0) {
    console.log("Aucune fixture (source.* + expected.json) trouvée. Rien à mesurer.");
    return;
  }
  const images = fixtures.filter((f) => f.kind === "image");
  const pdfs = fixtures.filter((f) => f.kind === "pdf");
  const parser = await loadParser();
  console.log(
    `${images.length} image(s), ${pdfs.length} PDF ; parseur : ${parser ? "oui" : "absent (ignoré)"}`,
  );
  console.log(
    `Node ${process.version}, ${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads), ${os.platform()}`,
  );

  const normalised = new Map<string, Buffer>();
  const normMs: number[] = [];
  const angles: string[] = [];
  for (const f of images) {
    const t = performance.now();
    const n = await normalise(f.source, args.deskew);
    normMs.push(performance.now() - t);
    normalised.set(f.id, n.png);
    if (n.angle !== 0) angles.push(isPublic ? `${f.id} ${n.angle}°` : `${n.angle}°`);
  }
  console.log(
    `Normalisation : niveaux de gris, <= 2000 px${args.deskew ? ", redressement" : ""} ; ` +
      `moyenne ${Math.round(mean(normMs))} ms, p95 ${Math.round(p95(normMs))} ms`,
  );
  if (args.deskew) console.log(`Angles corrigés : ${angles.join(", ") || "aucun"}`);

  const rows: Row[] = [];
  const summaries: Summary[] = [];
  const inits: Record<string, number> = {};
  for (const id of args.engines) {
    const engine = makeEngine(id);
    const t0 = performance.now();
    try {
      await engine.init();
    } catch (e) {
      console.error(`[${id}] initialisation impossible : ${(e as Error).message}`);
      continue;
    }
    inits[id] = Math.round(performance.now() - t0);
    // Échauffement (non compté) : premier passage JIT / allocation des sessions.
    if (images[0]) await engine.run(normalised.get(images[0].id)!);
    for (const f of images) {
      const img = normalised.get(f.id)!;
      const t = performance.now();
      let text = "";
      try {
        text = await engine.run(img);
      } catch (e) {
        console.error(`[${id}] échec OCR${isPublic ? ` ${f.id} : ${(e as Error).message}` : ""}`);
      }
      const ms = performance.now() - t;
      rows.push(evaluate(f, id, ms, text, parser));
      // Texte brut à l'écran : fixtures publiques seulement (jamais pour un dossier privé).
      if (args.print && isPublic) console.log(`--- ${id} ${f.id}\n${text.trimEnd()}\n---`);
      if (args.write) {
        const name =
          id === "tesseract"
            ? "ocr.tesseract.txt"
            : id === PRIMARY_PADDLE
              ? "ocr.paddle.txt"
              : null;
        if (name) await writeFile(path.join(f.dir, name), `${text.trimEnd()}\n`);
      }
    }
    const files = await engine.modelFiles();
    await engine.close();
    summaries.push(
      summarise(
        id,
        rows,
        files.reduce((t, x) => t + x.bytes, 0),
      ),
    );
    console.log(
      `[${id}] init ${inits[id]} ms ; modèles : ${files.map((x) => `${x.name} ${(x.bytes / 1e6).toFixed(2)} Mo`).join(", ")}`,
    );
  }

  for (const f of pdfs) {
    const t = performance.now();
    const text = await pdfText(f.source);
    rows.push(evaluate(f, "pdf-text", performance.now() - t, text, parser));
    if (args.write) await writeFile(path.join(f.dir, "ocr.pdf-text.txt"), `${text}\n`);
  }
  if (pdfs.length) summaries.push(summarise("pdf-text", rows, null));

  if (parser) {
    // Borne haute : le parseur appliqué au texte exact (truth.txt).
    const truthRows = fixtures
      .filter((f) => f.truth)
      .map((f) => evaluate(f, "truth (parseur seul)", 0, f.truth!, parser));
    rows.push(...truthRows);
    if (truthRows.length) summaries.push(summarise("truth (parseur seul)", rows, null));
  }

  console.log("\n## Agrégats\n");
  console.log(table(summaries));

  if (isPublic) {
    console.log("\n## Par fixture (CER | total | date | enseigne)\n");
    const engines = [...new Set(rows.map((r) => r.engine))].filter((e) => !e.startsWith("truth"));
    const perId = [...new Set(rows.map((r) => r.id))].map((id) => {
      const line: Summary = { fixture: id };
      for (const e of engines) {
        const r = rows.find((x) => x.id === id && x.engine === e);
        if (!r) continue;
        line[e] =
          `${r.cer === null ? "n/a" : pct(r.cer)} ${r.totalFound ? "T" : "-"}${r.dateFound ? "D" : "-"}${r.merchantNormFound ? "M" : "-"}`;
      }
      return line;
    });
    console.log(table(perId));

    console.log("\n## Par catégorie (CER moyen)\n");
    const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
    const byTag = tags.map((tag) => {
      const line: Summary = { tag };
      for (const e of engines) {
        const r = rows.filter((x) => x.engine === e && x.tags.includes(tag) && x.cer !== null);
        if (r.length) line[e] = `${pct(mean(r.map((x) => x.cer!)))} (${r.length})`;
      }
      return line;
    });
    console.log(table(byTag));

    console.log("\n## Confusions d'accents\n");
    for (const e of engines) {
      const all = new Map<string, number>();
      for (const r of rows.filter((x) => x.engine === e)) {
        for (const [k, v] of r.accentPairs) all.set(k, (all.get(k) ?? 0) + v);
      }
      const top = [...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      console.log(`- ${e} : ${top.map(([k, v]) => `${k} x${v}`).join(", ") || "aucune"}`);
    }
  }

  const report = { generatedAt: new Date().toISOString(), inits, summaries };
  if (args.json) {
    await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`);
  } else if (!isPublic) {
    await writeFile(
      path.join(args.dir, "benchmark-summary.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
