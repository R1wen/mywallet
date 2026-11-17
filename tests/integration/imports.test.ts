/**
 * Sprint 3 on a real PostgreSQL: receipt upload (real type, duplicates), server-side
 * parsing of OCR text, human validation (expense + lines, or attach to a bank movement),
 * bank CSV import (dedup by line key, reconciliation without duplicates, presets) and
 * isolation: user B can neither see, read, process nor import into user A's data.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import {
  bankImportPresets,
  importSettings,
  receiptFiles,
  receipts,
  transactionItems,
  transactions,
} from "@/lib/db/schema";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import { commitBankImport, previewBankImport } from "@/lib/server/bank-import";
import { getImportSettings, saveImportSettings } from "@/lib/server/import-settings";
import { provisionUser } from "@/lib/server/provisioning";
import {
  confirmReceipt,
  createReceipt,
  deleteReceipt,
  getReceipt,
  getReceiptFile,
  listReceipts,
  markProcessing,
  MAX_UPLOADS_PER_HOUR,
  rejectReceipt,
  reopenReceipt,
  saveExtraction,
} from "@/lib/server/receipts";
import { createTransaction, deleteTransaction } from "@/lib/server/transactions";
import { receiptReviewSchema, type ReceiptReviewValues } from "@/lib/validation/imports";
import { createUsers, deleteUsers } from "./helpers";

const TODAY = "2026-11-16";

let A = "";
let B = "";
let checking = "";
let checkingOfB = "";

const jpeg = (seed: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    seed,
    seed + 1,
    0xff,
    0xd9,
  ]);

const TICKET = `CARREFOUR MARKET 0123
LAIT DEMI ECR 1L
   2 x 1,25                 2,50
PAIN DE MIE               1,89
TOTAL TTC                 4,39 €
CB SANS CONTACT           4,39
14/11/2026  18:42
Retour sous 30 jours`;

async function upload(user: string, seed: number) {
  const r = await createReceipt(user, {
    data: jpeg(seed),
    filename: `ticket-${seed}.jpg`,
    thumbnail: null,
  });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function review(patch: Partial<ReceiptReviewValues> = {}) {
  return receiptReviewSchema.parse({
    merchantName: "Carrefour",
    occurredOn: "2026-11-14",
    amount: "4,39",
    accountId: checking,
    categoryId: "",
    notes: "",
    items: [
      { label: "LAIT DEMI ECR 1L", quantity: "2", amount: "2,50" },
      { label: "PAIN DE MIE", quantity: "1", amount: "1,89" },
    ],
    returnDeadline: "2026-12-14",
    warrantyUntil: "",
    attachToTransactionId: "",
    ...patch,
  } satisfies ReceiptReviewValues);
}

const balance = async () =>
  (await listAccountsWithBalance(A)).find((a) => a.id === checking)!.balanceCents;

beforeAll(async () => {
  [A = "", B = ""] = await createUsers(2);
  await provisionUser(A);
  await provisionUser(B);
  checking = (await listAccountsWithBalance(A))[0]!.id;
  checkingOfB = (await listAccountsWithBalance(B))[0]!.id;
});

afterAll(() => deleteUsers([A, B]));

describe("upload", () => {
  it("stores the file by its real type and returns the first receipt for the same file", async () => {
    const first = await upload(A, 1);
    expect(first.duplicate).toBe(false);
    const again = await upload(A, 1);
    expect(again).toEqual({ id: first.id, duplicate: true });
    const file = await getReceiptFile(A, first.id, "original");
    expect(file?.mimeType).toBe("image/jpeg");
    expect([...file!.data]).toEqual([...jpeg(1)]);
  });

  it("refuses a renamed HTML file and a bad thumbnail", async () => {
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    expect(await createReceipt(A, { data: html, filename: "x.jpg", thumbnail: null })).toEqual({
      ok: false,
      error: "Format non pris en charge (JPG, PNG, WebP, HEIC ou PDF).",
    });
    expect(
      await createReceipt(A, {
        data: jpeg(9),
        filename: "x.jpg",
        thumbnail: new Uint8Array([1, 2, 3]),
      }),
    ).toEqual({ ok: false, error: "Miniature invalide." });
  });

  it("does not deduplicate across users", async () => {
    const ofB = await upload(B, 1);
    expect(ofB.duplicate).toBe(false);
  });
});

describe("extraction and review", () => {
  let id = "";
  let txId = "";

  beforeAll(async () => {
    id = (await upload(A, 20)).id;
  });

  it("parses the OCR text on the server and proposes a known merchant", async () => {
    expect(await markProcessing(A, id)).toEqual({ ok: true, data: undefined });
    const r = await saveExtraction(
      A,
      { receiptId: id, ocrText: TICKET, ocrEngine: "tesseract", failure: null },
      TODAY,
    );
    expect(r).toEqual({ ok: true, data: { status: "to_review" } });
    const detail = await getReceipt(A, id);
    expect(detail?.status).toBe("to_review");
    expect(detail?.extraction).toMatchObject({
      merchantName: "Carrefour",
      level: "medium", // no VAT table on this ticket
      duplicateOfId: null,
      parsed: { totalCents: 439, date: "2026-11-14", returnDeadline: "2026-12-14" },
    });
    expect(detail?.confidence?.total).toBe(1);
  });

  it("flags another photo of the same ticket", async () => {
    const other = (await upload(A, 21)).id;
    await saveExtraction(
      A,
      { receiptId: other, ocrText: TICKET, ocrEngine: "paddle", failure: null },
      TODAY,
    );
    expect((await getReceipt(A, other))?.extraction?.duplicateOfId).toBe(id);
    expect((await listReceipts(A)).find((r) => r.id === other)?.duplicate).toBe(true);
    await rejectReceipt(A, other);
  });

  it("falls back to manual entry when OCR finds nothing", async () => {
    const blank = (await upload(A, 22)).id;
    await saveExtraction(
      A,
      { receiptId: blank, ocrText: "  ", ocrEngine: "tesseract", failure: null },
      TODAY,
    );
    const detail = await getReceipt(A, blank);
    expect(detail?.status).toBe("manual");
    expect(detail?.failureReason).toBe("Aucun texte n'a été trouvé sur le ticket.");
  });

  it("validates into an expense with its lines and deadlines", async () => {
    const before = await balance();
    const r = await confirmReceipt(A, id, review());
    if (!r.ok) throw new Error(r.error);
    txId = r.data.transactionId;
    expect(await balance()).toBe(before - 439);
    const items = await db
      .select({ label: transactionItems.label, totalCents: transactionItems.totalCents })
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, txId))
      .orderBy(transactionItems.position);
    expect(items).toEqual([
      { label: "LAIT DEMI ECR 1L", totalCents: 250 },
      { label: "PAIN DE MIE", totalCents: 189 },
    ]);
    const detail = await getReceipt(A, id);
    expect(detail).toMatchObject({
      status: "validated",
      transactionId: txId,
      returnDeadline: "2026-12-14",
    });
    expect(await confirmReceipt(A, id, review())).toEqual({
      ok: false,
      error: "Ce ticket est déjà traité.",
    });
  });

  it("rejects items that do not add up (form and server share the schema)", () => {
    const r = receiptReviewSchema.safeParse({
      ...review(),
      amount: "5,00",
      items: [{ label: "X", quantity: "1", amount: "4,39" }],
      notes: "",
      categoryId: "",
      accountId: checking,
      returnDeadline: "",
      warrantyUntil: "",
      attachToTransactionId: "",
      occurredOn: "2026-11-14",
      merchantName: "Carrefour",
    });
    expect(r.success).toBe(false);
  });

  it("puts the receipt back to review when its movement is deleted", async () => {
    expect((await deleteTransaction(A, txId)).ok).toBe(true);
    expect(await getReceipt(A, id)).toMatchObject({ status: "to_review", transactionId: null });
  });

  it("puts a receipt entered by hand back to manual entry, and a stale OCR result is refused", async () => {
    const blank = (await upload(A, 23)).id;
    await saveExtraction(
      A,
      { receiptId: blank, ocrText: "", ocrEngine: null, failure: "empty" },
      TODAY,
    );
    const r = await confirmReceipt(A, blank, review({ items: [], returnDeadline: "" }));
    if (!r.ok) throw new Error(r.error);
    // OCR finishing after the validation must not reopen the receipt.
    expect(
      await saveExtraction(
        A,
        { receiptId: blank, ocrText: TICKET, ocrEngine: "tesseract", failure: null },
        TODAY,
      ),
    ).toEqual({ ok: false, error: "Ce ticket est déjà traité." });
    expect((await deleteTransaction(A, r.data.transactionId)).ok).toBe(true);
    expect((await getReceipt(A, blank))?.status).toBe("manual");
  });

  it("rejects, reopens and deletes with its files", async () => {
    expect((await rejectReceipt(A, id)).ok).toBe(true);
    expect((await getReceipt(A, id))?.status).toBe("rejected");
    expect((await reopenReceipt(A, id)).ok).toBe(true);
    expect((await getReceipt(A, id))?.status).toBe("to_review");
    expect((await deleteReceipt(A, id)).ok).toBe(true);
    const files = await db.select().from(receiptFiles).where(eq(receiptFiles.receiptId, id));
    expect(files).toEqual([]);
  });
});

const CSV = (rows: string[]) =>
  ["Compte;FR76 **** 1234", "", "Date opération;Libellé;Débit;Crédit", ...rows].join("\r\n");

describe("bank CSV import", () => {
  let manual = "";

  beforeAll(async () => {
    const r = await createTransaction(A, {
      kind: "expense",
      amountCents: 7840,
      occurredOn: "2026-11-02",
      label: "EDF",
      merchantName: "EDF",
      accountId: checking,
      toAccountId: null,
      categoryId: null,
      notes: null,
    });
    if (!r.ok) throw new Error(r.error);
    manual = r.data.id;
  });

  const file = CSV([
    "03/11/2026;PRLV SEPA EDF CLIENTS;78,40;",
    "05/11/2026;VIR SALAIRE ACME;;2 100,00",
    "06/11/2026;CB CARREFOUR 05/11;12,30;",
    "06/11/2026;CB CARREFOUR 05/11;12,30;",
  ]);

  it("previews: guessed mapping, match with the manual movement, new lines", async () => {
    const r = await previewBankImport(A, { accountId: checking, csv: file, mapping: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.mapping).toEqual({ date: 0, label: 1, amount: null, debit: 2, credit: 3 });
    expect(r.data.lines.map((l) => [l.row, l.status, l.match?.id ?? null])).toEqual([
      [4, "match", manual],
      [5, "new", null],
      [6, "new", null],
      [7, "new", null],
    ]);
  });

  it("commits: links, creates two identical card payments, saves the preset", async () => {
    const before = await balance();
    const preview = await previewBankImport(A, { accountId: checking, csv: file, mapping: null });
    if (!preview.ok || !preview.data.mapping) throw new Error("preview");
    const r = await commitBankImport(A, {
      accountId: checking,
      csv: file,
      mapping: preview.data.mapping,
      decisions: [],
    });
    expect(r).toEqual({ ok: true, data: { created: 3, linked: 1, skipped: 0, reimbursed: 0 } });
    // The linked movement already counted: only the 3 new lines change the balance.
    expect(await balance()).toBe(before + 210_000 - 2 * 1230);
    const [linked] = await db.select().from(transactions).where(eq(transactions.id, manual));
    expect(linked?.bankLabel).toBe("PRLV SEPA EDF CLIENTS");
    const created = await db
      .select({
        label: transactions.label,
        kind: transactions.kind,
        merchantId: transactions.merchantId,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, A), eq(transactions.bankLabel, "CB CARREFOUR 05/11")));
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ label: "CARREFOUR", kind: "expense" });
    expect(created[0]?.merchantId).not.toBeNull();
    const presets = await db
      .select()
      .from(bankImportPresets)
      .where(eq(bankImportPresets.userId, A));
    expect(presets).toHaveLength(1);
  });

  it("re-importing the same statement imports nothing", async () => {
    const r = await previewBankImport(A, { accountId: checking, csv: file, mapping: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.fromPreset).toBe(true);
    expect(r.data.lines.every((l) => l.status === "duplicate")).toBe(true);
    const commit = await commitBankImport(A, {
      accountId: checking,
      csv: file,
      mapping: r.data.mapping!,
      decisions: r.data.lines.map((l) => ({ row: l.row, action: "create" as const })),
    });
    expect(commit).toEqual({
      ok: true,
      data: { created: 0, linked: 0, skipped: 4, reimbursed: 0 },
    });
  });

  it("attaches a later receipt to the imported card payment instead of a new expense", async () => {
    const id = (await upload(A, 40)).id;
    await saveExtraction(
      A,
      {
        receiptId: id,
        ocrText: "CARREFOUR CITY\nEAU 12,30\nTOTAL 12,30\nCB 12,30\n05/11/2026 12:00",
        ocrEngine: "tesseract",
        failure: null,
      },
      TODAY,
    );
    const detail = await getReceipt(A, id);
    expect(detail?.bankMatches).toHaveLength(2);
    const target = detail!.bankMatches[0]!.id;
    const count = async () =>
      (await db.select().from(transactions).where(eq(transactions.userId, A))).length;
    const before = await count();
    const before$ = await balance();
    const r = await confirmReceipt(
      A,
      id,
      review({
        amount: "12,30",
        occurredOn: "2026-11-05",
        items: [{ label: "EAU", quantity: "1", amount: "12,30" }],
        returnDeadline: "",
        attachToTransactionId: target,
      }),
    );
    expect(r).toEqual({ ok: true, data: { transactionId: target } });
    expect(await count()).toBe(before);
    expect(await balance()).toBe(before$);
    // The other identical payment is still free; the attached one is not offered anymore.
    const other = (await upload(A, 41)).id;
    await saveExtraction(
      A,
      {
        receiptId: other,
        ocrText: "CARREFOUR CITY\nEAU 12,30\nTOTAL 12,30\nCB 12,30\n06/11/2026 09:00",
        ocrEngine: "tesseract",
        failure: null,
      },
      TODAY,
    );
    const offered = (await getReceipt(A, other))!.bankMatches.map((m) => m.id);
    expect(offered).toHaveLength(1);
    expect(offered).not.toContain(target);
  });
});

describe("isolation", () => {
  let receiptOfA = "";

  beforeAll(async () => {
    receiptOfA = (await upload(A, 60)).id;
  });

  it("B cannot list, read, download or process A's receipts", async () => {
    expect((await listReceipts(B)).map((r) => r.id)).not.toContain(receiptOfA);
    expect(await getReceipt(B, receiptOfA)).toBeNull();
    expect(await getReceiptFile(B, receiptOfA, "original")).toBeNull();
    expect(await getReceiptFile(B, receiptOfA, "thumbnail")).toBeNull();
    expect((await reopenReceipt(B, receiptOfA)).ok).toBe(false);
    expect((await markProcessing(B, receiptOfA)).ok).toBe(false);
    expect(
      (
        await saveExtraction(
          B,
          { receiptId: receiptOfA, ocrText: TICKET, ocrEngine: null, failure: null },
          TODAY,
        )
      ).ok,
    ).toBe(false);
    expect((await confirmReceipt(B, receiptOfA, review({ accountId: checkingOfB }))).ok).toBe(
      false,
    );
    expect((await rejectReceipt(B, receiptOfA)).ok).toBe(false);
    expect((await deleteReceipt(B, receiptOfA)).ok).toBe(false);
    expect((await getReceipt(A, receiptOfA))?.status).toBe("uploaded");
  });

  it("B cannot validate into A's account nor attach to A's movement", async () => {
    const own = (await upload(B, 61)).id;
    expect((await confirmReceipt(B, own, review({ accountId: checking }))).ok).toBe(false);
    const [movementOfA] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, A))
      .limit(1);
    const r = await confirmReceipt(
      B,
      own,
      review({ accountId: checkingOfB, attachToTransactionId: movementOfA!.id }),
    );
    expect(r).toEqual({ ok: false, error: "Mouvement bancaire introuvable." });
    expect((await db.select().from(receipts).where(eq(receipts.id, own)))[0]?.status).toBe(
      "uploaded",
    );
  });

  it("B cannot import into A's account, and A's presets are not B's", async () => {
    const file = CSV(["03/11/2026;TEST;1,00;"]);
    expect(await previewBankImport(B, { accountId: checking, csv: file, mapping: null })).toEqual({
      ok: false,
      error: "Compte introuvable.",
    });
    const own = await previewBankImport(B, { accountId: checkingOfB, csv: file, mapping: null });
    expect(own.ok && own.data.fromPreset).toBe(false);
  });
});

describe("import settings", () => {
  it("defaults to rules and refuses an unconfigured model", async () => {
    expect((await getImportSettings(A)).structurer).toBe("rules");
    expect(await saveImportSettings(A, { structurer: "gemini", geminiConsent: true })).toEqual({
      ok: false,
      error: "Cette option n'est pas configurée sur ce serveur.",
    });
    expect((await saveImportSettings(A, { structurer: "rules", geminiConsent: false })).ok).toBe(
      true,
    );
  });

  it("B's settings never change A's", async () => {
    await saveImportSettings(B, { structurer: "rules", geminiConsent: false });
    const rows = await db.select().from(importSettings).where(eq(importSettings.userId, A));
    expect(rows.map((r) => r.structurer)).toEqual(["rules"]);
    expect(
      (await db.select().from(importSettings).where(eq(importSettings.userId, B))).length,
    ).toBe(1);
  });
});

describe("guards (security review)", () => {
  it("never attaches a receipt to a movement entered by hand", async () => {
    const manual = await createTransaction(A, {
      kind: "expense",
      amountCents: 1999,
      occurredOn: "2026-11-12",
      label: "Saisie",
      merchantName: "Monoprix",
      accountId: checking,
      toAccountId: null,
      categoryId: null,
      notes: null,
    });
    if (!manual.ok) throw new Error(manual.error);
    const id = (await upload(A, 80)).id;
    await saveExtraction(
      A,
      {
        receiptId: id,
        ocrText: "MONOPRIX\nX 19,99\nTOTAL 19,99\n12/11/2026",
        ocrEngine: "tesseract",
        failure: null,
      },
      TODAY,
    );
    expect((await getReceipt(A, id))?.bankMatches.map((m) => m.id)).not.toContain(manual.data.id);
    const r = await confirmReceipt(
      A,
      id,
      review({
        amount: "19,99",
        occurredOn: "2026-11-12",
        items: [],
        returnDeadline: "",
        attachToTransactionId: manual.data.id,
      }),
    );
    expect(r).toEqual({ ok: false, error: "Mouvement bancaire introuvable." });
  });

  it("flags receipts that have a thumbnail", async () => {
    const thumb = jpeg(91);
    const r = await createReceipt(A, { data: jpeg(92), filename: "t.jpg", thumbnail: thumb });
    if (!r.ok) throw new Error(r.error);
    expect((await listReceipts(A)).find((x) => x.id === r.data.id)?.hasThumbnail).toBe(true);
    expect((await getReceipt(A, r.data.id))?.hasThumbnail).toBe(true);
    const plain = await upload(A, 93);
    expect((await listReceipts(A)).find((x) => x.id === plain.id)?.hasThumbnail).toBe(false);
  });

  it("never attaches to an imported movement that already has lines", async () => {
    const file = CSV(["13/11/2026;CB PICARD 13/11;31,40;"]);
    const preview = await previewBankImport(A, { accountId: checking, csv: file, mapping: null });
    if (!preview.ok || !preview.data.mapping) throw new Error("preview");
    await commitBankImport(A, {
      accountId: checking,
      csv: file,
      mapping: preview.data.mapping,
      decisions: [],
    });
    const [line] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, A), eq(transactions.bankLabel, "CB PICARD 13/11")));
    await db.insert(transactionItems).values({
      userId: A,
      transactionId: line!.id,
      label: "Glaces",
      totalCents: 3140,
    });
    const id = (await upload(A, 94)).id;
    await saveExtraction(
      A,
      {
        receiptId: id,
        ocrText: "PICARD\nGLACES 31,40\nTOTAL 31,40\n13/11/2026",
        ocrEngine: "tesseract",
        failure: null,
      },
      TODAY,
    );
    expect((await getReceipt(A, id))?.bankMatches.map((m) => m.id)).not.toContain(line!.id);
    const r = await confirmReceipt(
      A,
      id,
      review({
        amount: "31,40",
        occurredOn: "2026-11-13",
        items: [],
        returnDeadline: "",
        attachToTransactionId: line!.id,
      }),
    );
    expect(r).toEqual({ ok: false, error: "Mouvement bancaire introuvable." });
  });

  it("limits uploads per hour", async () => {
    const [C = ""] = await createUsers(1);
    try {
      await db.insert(receipts).values(
        Array.from({ length: MAX_UPLOADS_PER_HOUR }, (_, i) => ({
          userId: C,
          fileKey: `x/${i}`,
          mimeType: "image/jpeg",
          sizeBytes: 1,
          sha256: i.toString(16).padStart(64, "0"),
        })),
      );
      expect(
        await createReceipt(C, { data: jpeg(90), filename: "x.jpg", thumbnail: null }),
      ).toEqual({
        ok: false,
        error: "Trop de tickets envoyés en une heure : réessayez plus tard.",
      });
    } finally {
      await deleteUsers([C]);
    }
  });

  it("a read receipt cannot go back to processing (one model call per receipt)", async () => {
    const id = (await upload(A, 81)).id;
    await saveExtraction(
      A,
      { receiptId: id, ocrText: TICKET, ocrEngine: "tesseract", failure: null },
      TODAY,
    );
    expect((await markProcessing(A, id)).ok).toBe(false);
  });
});
