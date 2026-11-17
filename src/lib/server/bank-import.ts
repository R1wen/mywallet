import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { type Conn, db as defaultDb, type Db } from "@/lib/db/client";
import { accounts, bankImportPresets, merchants, people, transactions } from "@/lib/db/schema";
import {
  bankLineKeys,
  extractBankLines,
  findHeaderRow,
  guessMapping,
  headerSignature,
  parseCsv,
  type BankLine,
  type BankLineError,
  type ColumnMapping,
} from "@/lib/domain/bank-csv";
import { allocatePayment, suggestReimbursements, type OpenClaim } from "@/lib/domain/claims";
import { findMerchantByLabel } from "@/lib/domain/merchant";
import { matchByAmountAndDate, reconcileWindow } from "@/lib/domain/reconcile";
import { MAX_CSV_LINES, type ImportAction } from "@/lib/validation/imports";
import { Abort, abortedResult, fail, isUniqueViolation, ok, type Result } from "./result";
import { listOpenClaims, writePayment } from "./sharing";

export type PreviewLine = BankLine & {
  status: "new" | "match" | "duplicate";
  match: { id: string; label: string; occurredOn: string } | null;
  /** Incoming transfer that probably pays back this person (ADR-035). */
  reimbursement: { personId: string; claimId: string | null } | null;
};

/** People who owe me money: an incoming line can be recorded as their reimbursement. */
export type DebtorOption = { id: string; name: string; pendingCents: number };

export type BankPreview = {
  header: string[];
  headerRow: number;
  mapping: ColumnMapping | null;
  /** Mapping came from a saved preset for this CSV layout. */
  fromPreset: boolean;
  lines: PreviewLine[];
  errors: BankLineError[];
  truncated: boolean;
  debtors: DebtorOption[];
};

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
/** Hashed header signature: bounded length for the unique index, whatever the CSV. */
const presetKey = (header: string[]) => hash(headerSignature(header));

/**
 * Parses the CSV and classifies each line against the account (ADR-028): already
 * imported (same line key), matching an unreconciled movement (amount, ±3 days), or new.
 * Recomputed from the raw file on commit: the client never sends lines or matches.
 */
export async function previewBankImport(
  userId: string,
  input: { accountId: string; csv: string; mapping: ColumnMapping | null },
  db: Conn = defaultDb,
  /** The commit needs the open claims, not the debtors' names. */
  forCommit = false,
): Promise<Result<BankPreview & { keys: string[]; openClaims: OpenClaim[] }>> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, input.accountId)));
  if (!account) return fail("Compte introuvable.");

  const { rows } = parseCsv(input.csv);
  const detected = findHeaderRow(rows);
  // Not recognised: the first row as wide as most rows (skips short preamble lines).
  const headerRow = detected >= 0 ? detected : widestCommonRow(rows);
  const header = rows[headerRow] ?? [];
  let mapping = input.mapping;
  let fromPreset = false;
  if (!mapping) {
    const [preset] = await db
      .select({ mapping: bankImportPresets.mapping })
      .from(bankImportPresets)
      .where(
        and(
          eq(bankImportPresets.userId, userId),
          eq(bankImportPresets.signature, presetKey(header)),
        ),
      );
    mapping = preset?.mapping ?? guessMapping(header);
    fromPreset = Boolean(preset);
  }
  const empty = {
    header,
    headerRow,
    mapping,
    fromPreset,
    errors: [],
    truncated: false,
    debtors: [] as DebtorOption[],
  };
  if (!mapping) return ok({ ...empty, lines: [], keys: [], openClaims: [] });
  if (
    Math.max(
      mapping.date,
      mapping.label,
      mapping.amount ?? 0,
      mapping.debit ?? 0,
      mapping.credit ?? 0,
    ) >= Math.max(header.length, 1)
  ) {
    return fail("Colonne inexistante dans ce fichier.");
  }

  const extracted = extractBankLines(rows, headerRow, mapping);
  const truncated = extracted.lines.length > MAX_CSV_LINES;
  const lines = extracted.lines.slice(0, MAX_CSV_LINES);
  const keys = bankLineKeys(input.accountId, lines).map(hash);
  if (!lines.length) {
    return ok({ ...empty, errors: extracted.errors, lines: [], keys: [], openClaims: [] });
  }

  const already = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const found = await db
      .select({ key: transactions.bankLineKey })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.bankLineKey, keys.slice(i, i + 1000)),
        ),
      );
    for (const f of found) if (f.key) already.add(f.key);
  }

  const dates = lines.map((l) => l.date).sort();
  const window = reconcileWindow(dates[0]!, dates[dates.length - 1]!);
  const candidates = await db
    .select({
      id: transactions.id,
      date: transactions.occurredOn,
      amountCents: transactions.amountCents,
      label: transactions.label,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, input.accountId),
        isNull(transactions.bankLineKey),
        gte(transactions.occurredOn, window.from),
        lte(transactions.occurredOn, window.to),
      ),
    );

  const open = lines.map((l, i) => ({ l, i })).filter(({ i }) => !already.has(keys[i]!));
  const matched = matchByAmountAndDate(
    open.map(({ l }) => l),
    candidates,
  );
  const byIndex = new Map(open.map(({ i }, k) => [i, matched[k] ?? null]));
  const candById = new Map(candidates.map((c) => [c.id, c]));

  const base: Omit<PreviewLine, "reimbursement">[] = lines.map((l, i) => {
    if (already.has(keys[i]!)) return { ...l, status: "duplicate", match: null };
    const id = byIndex.get(i);
    const c = id ? candById.get(id) : undefined;
    return c
      ? { ...l, status: "match", match: { id: c.id, label: c.label, occurredOn: c.date } }
      : { ...l, status: "new", match: null };
  });

  // New incoming lines: who probably paid me back (exact amount owed, ADR-035).
  const openClaims = await listOpenClaims(userId, db);
  const incoming = base
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.status === "new" && l.amountCents > 0);
  const suggested = suggestReimbursements(
    incoming.map(({ l }) => l),
    openClaims,
  );
  const suggestion = new Map(incoming.map(({ i }, k) => [i, suggested[k] ?? null]));
  const preview: PreviewLine[] = base.map((l, i) => ({
    ...l,
    reimbursement: suggestion.get(i) ?? null,
  }));

  const owed = new Map<string, number>();
  for (const c of openClaims) owed.set(c.personId, (owed.get(c.personId) ?? 0) + c.remainingCents);
  const debtors =
    owed.size && !forCommit
      ? (
          await db
            .select({ id: people.id, name: people.name })
            .from(people)
            .where(and(eq(people.userId, userId), inArray(people.id, [...owed.keys()])))
        )
          .map((p) => ({ ...p, pendingCents: owed.get(p.id) ?? 0 }))
          .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      : [];
  return ok({
    ...empty,
    errors: extracted.errors,
    lines: preview,
    keys,
    truncated,
    debtors,
    openClaims,
  });
}

/** Index of the first row whose width is the most common width (2+ columns). */
function widestCommonRow(rows: readonly (readonly string[])[]): number {
  const sample = rows.slice(0, 50);
  const counts = new Map<number, number>();
  for (const r of sample) if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  const width = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  const index = sample.findIndex((r) => r.length === width);
  return index >= 0 ? index : 0;
}

export type ImportSummary = {
  created: number;
  linked: number;
  skipped: number;
  /** Incoming transfers recorded as reimbursements. */
  reimbursed: number;
};

/** Strips bank prefixes ("CB ", "PRLV SEPA ", card dates) for a readable label. */
function readableLabel(bankLabel: string): string {
  const s = bankLabel
    .replace(
      /^(CB|CARTE|PAIEMENT PAR CARTE|PAIEMENT CB|PRLV( SEPA)?|PRELEVEMENT( SEPA)?|VIR( SEPA)?( INST)?|VIREMENT( SEPA)?( RECU| EMIS)?|RETRAIT( DAB)?)\b\s*/i,
      "",
    )
    .replace(/\s+\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (s || bankLabel).slice(0, 140);
}

/**
 * Applies the user's choices in one DB transaction: link matched movements (sets the
 * bank line key), create the new ones (expense or income by sign, merchant recognized
 * from the directory but never created), skip the rest. Saves the column preset.
 */
export async function commitBankImport(
  userId: string,
  input: {
    accountId: string;
    csv: string;
    mapping: ColumnMapping;
    decisions: { row: number; action: ImportAction; personId?: string }[];
  },
  db: Db = defaultDb,
): Promise<Result<ImportSummary>> {
  try {
    return await db.transaction((tx) => writeBankImport(userId, input, tx));
  } catch (e) {
    const aborted = abortedResult(e);
    if (aborted) return aborted;
    // The same statement imported at the same time (double click, two tabs).
    if (isUniqueViolation(e)) return fail("Ce relevé vient d'être importé : rechargez la page.");
    throw e;
  }
}

async function writeBankImport(
  userId: string,
  input: Parameters<typeof commitBankImport>[1],
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
): Promise<Result<ImportSummary>> {
  {
    const preview = await previewBankImport(userId, input, tx, true);
    if (!preview.ok) return preview;
    const { lines, keys, header } = preview.data;
    if (!lines.length) return fail("Aucune ligne à importer.");
    const decided = new Map(input.decisions.map((d) => [d.row, d]));
    // What each claim still lacks, updated as transfers of this file pay them.
    const open = preview.data.openClaims;
    const left = new Map(open.map((c) => [c.id, c.remainingCents]));

    const known = await tx
      .select({
        id: merchants.id,
        normalizedName: merchants.normalizedName,
        aliases: merchants.aliases,
        defaultCategoryId: merchants.defaultCategoryId,
      })
      .from(merchants)
      .where(eq(merchants.userId, userId));

    const summary: ImportSummary = { created: 0, linked: 0, skipped: 0, reimbursed: 0 };
    const toCreate: (typeof transactions.$inferInsert)[] = [];
    const toLink: { id: string; key: string; label: string }[] = [];
    for (const [i, line] of lines.entries()) {
      const key = keys[i]!;
      const fallback: ImportAction =
        line.status === "duplicate"
          ? "skip"
          : line.status === "match"
            ? "link"
            : line.reimbursement
              ? "reimburse"
              : "create";
      const decision = decided.get(line.row);
      let action = decision?.action ?? fallback;
      if (line.status === "duplicate") action = "skip";
      if (action === "link" && !line.match) action = "create";
      if (action === "reimburse" && (line.status !== "new" || line.amountCents <= 0)) {
        action = "create";
      }

      if (action === "reimburse") {
        const personId = decision?.personId ?? line.reimbursement?.personId;
        if (!personId) throw new Abort(fail(`Ligne ${line.row} : choisissez la personne.`));
        // The suggested claim while it is still exactly what is paid, else oldest first.
        const suggestedClaim =
          line.reimbursement?.personId === personId ? line.reimbursement.claimId : null;
        const exact =
          suggestedClaim && (left.get(suggestedClaim) ?? 0) === line.amountCents
            ? open.filter((c) => c.id === suggestedClaim)
            : [];
        const pool = (exact.length ? exact : open.filter((c) => c.personId === personId)).map(
          (c) => ({ id: c.id, remainingCents: left.get(c.id) ?? 0 }),
        );
        const allocation = allocatePayment(pool, line.amountCents);
        if (!allocation.ok) {
          throw new Abort(fail(`Ligne ${line.row} : ${allocation.error}`));
        }
        const paid = await writePayment(
          userId,
          {
            personId,
            occurredOn: line.date,
            accountId: input.accountId,
            allocations: allocation.data.map((a) => ({
              claimId: a.id,
              amountCents: a.amountCents,
            })),
            bankLineKey: key,
            bankLabel: line.label,
          },
          tx,
        );
        if (!paid.ok) throw new Abort(fail(`Ligne ${line.row} : ${paid.error}`));
        for (const a of allocation.data) left.set(a.id, (left.get(a.id) ?? 0) - a.amountCents);
        summary.reimbursed++;
        continue;
      }

      if (action === "skip") {
        summary.skipped++;
        continue;
      }
      if (action === "link" && line.match) {
        toLink.push({ id: line.match.id, key, label: line.label });
        continue;
      }
      const label = readableLabel(line.label);
      const merchant = findMerchantByLabel(label, known);
      const isExpense = line.amountCents < 0;
      toCreate.push({
        userId,
        accountId: input.accountId,
        kind: isExpense ? "expense" : "income",
        amountCents: line.amountCents,
        occurredOn: line.date,
        label,
        merchantId: merchant?.id ?? null,
        categoryId: isExpense ? (merchant?.defaultCategoryId ?? null) : null,
        bankLineKey: key,
        bankLabel: line.label,
      });
    }
    // Links in batches of 500: one UPDATE ... FROM (VALUES ...) instead of one per line.
    for (let i = 0; i < toLink.length; i += 500) {
      const chunk = toLink.slice(i, i + 500);
      const values = sql.join(
        chunk.map((l) => sql`(${l.id}::uuid, ${l.key}, ${l.label})`),
        sql`, `,
      );
      const linked = await tx.execute<{ id: string }>(sql`
        update transactions t set bank_line_key = v.k, bank_label = v.l
        from (values ${values}) as v(id, k, l)
        where t.user_id = ${userId} and t.id = v.id and t.bank_line_key is null
        returning t.id`);
      summary.linked += linked.rows.length;
      summary.skipped += chunk.length - linked.rows.length;
    }
    for (let i = 0; i < toCreate.length; i += 500) {
      const inserted = await tx
        .insert(transactions)
        .values(toCreate.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      summary.created += inserted.length;
      summary.skipped += toCreate.slice(i, i + 500).length - inserted.length;
    }

    await tx
      .insert(bankImportPresets)
      .values({
        userId,
        signature: presetKey(header),
        mapping: input.mapping,
        accountId: input.accountId,
      })
      .onConflictDoUpdate({
        target: [bankImportPresets.userId, bankImportPresets.signature],
        set: { mapping: input.mapping, accountId: input.accountId },
      });
    return ok(summary);
  }
}
