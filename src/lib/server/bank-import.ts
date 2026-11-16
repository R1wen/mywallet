import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { type Conn, db as defaultDb, type Db } from "@/lib/db/client";
import { accounts, bankImportPresets, merchants, transactions } from "@/lib/db/schema";
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
import { findMerchantByLabel } from "@/lib/domain/merchant";
import { matchByAmountAndDate, reconcileWindow } from "@/lib/domain/reconcile";
import { MAX_CSV_LINES, type ImportAction } from "@/lib/validation/imports";
import { fail, ok, type Result } from "./result";

export type PreviewLine = BankLine & {
  status: "new" | "match" | "duplicate";
  match: { id: string; label: string; occurredOn: string } | null;
};

export type BankPreview = {
  header: string[];
  headerRow: number;
  mapping: ColumnMapping | null;
  /** Mapping came from a saved preset for this CSV layout. */
  fromPreset: boolean;
  lines: PreviewLine[];
  errors: BankLineError[];
  truncated: boolean;
};

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * Parses the CSV and classifies each line against the account (ADR-028): already
 * imported (same line key), matching an unreconciled movement (amount, ±3 days), or new.
 * Recomputed from the raw file on commit: the client never sends lines or matches.
 */
export async function previewBankImport(
  userId: string,
  input: { accountId: string; csv: string; mapping: ColumnMapping | null },
  db: Conn = defaultDb,
): Promise<Result<BankPreview & { keys: string[] }>> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, input.accountId)));
  if (!account) return fail("Compte introuvable.");

  const { rows } = parseCsv(input.csv);
  const detected = findHeaderRow(rows);
  const headerRow = detected >= 0 ? detected : 0;
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
          eq(bankImportPresets.signature, headerSignature(header)),
        ),
      );
    mapping = preset?.mapping ?? guessMapping(header);
    fromPreset = Boolean(preset);
  }
  const empty = { header, headerRow, mapping, fromPreset, errors: [], truncated: false };
  if (!mapping) return ok({ ...empty, lines: [], keys: [] });
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
  if (!lines.length) return ok({ ...empty, errors: extracted.errors, lines: [], keys: [] });

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

  const preview: PreviewLine[] = lines.map((l, i) => {
    if (already.has(keys[i]!)) return { ...l, status: "duplicate", match: null };
    const id = byIndex.get(i);
    const c = id ? candById.get(id) : undefined;
    return c
      ? { ...l, status: "match", match: { id: c.id, label: c.label, occurredOn: c.date } }
      : { ...l, status: "new", match: null };
  });
  return ok({ ...empty, errors: extracted.errors, lines: preview, keys, truncated });
}

export type ImportSummary = { created: number; linked: number; skipped: number };

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
    decisions: { row: number; action: ImportAction }[];
  },
  db: Db = defaultDb,
): Promise<Result<ImportSummary>> {
  return db.transaction(async (tx) => {
    const preview = await previewBankImport(userId, input, tx);
    if (!preview.ok) return preview;
    const { lines, keys, header } = preview.data;
    if (!lines.length) return fail("Aucune ligne à importer.");
    const decided = new Map(input.decisions.map((d) => [d.row, d.action]));

    const known = await tx
      .select({
        id: merchants.id,
        normalizedName: merchants.normalizedName,
        aliases: merchants.aliases,
        defaultCategoryId: merchants.defaultCategoryId,
      })
      .from(merchants)
      .where(eq(merchants.userId, userId));

    const summary: ImportSummary = { created: 0, linked: 0, skipped: 0 };
    const toCreate: (typeof transactions.$inferInsert)[] = [];
    for (const [i, line] of lines.entries()) {
      const key = keys[i]!;
      const fallback: ImportAction =
        line.status === "duplicate" ? "skip" : line.status === "match" ? "link" : "create";
      let action = decided.get(line.row) ?? fallback;
      if (line.status === "duplicate") action = "skip";
      if (action === "link" && !line.match) action = "create";

      if (action === "skip") {
        summary.skipped++;
        continue;
      }
      if (action === "link" && line.match) {
        const rows = await tx
          .update(transactions)
          .set({ bankLineKey: key, bankLabel: line.label })
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.id, line.match.id),
              isNull(transactions.bankLineKey),
            ),
          )
          .returning({ id: transactions.id });
        if (rows.length) summary.linked++;
        else summary.skipped++;
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
        signature: headerSignature(header),
        mapping: input.mapping,
        accountId: input.accountId,
      })
      .onConflictDoUpdate({
        target: [bankImportPresets.userId, bankImportPresets.signature],
        set: { mapping: input.mapping, accountId: input.accountId },
      });
    return ok(summary);
  });
}
