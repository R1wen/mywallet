import { getCurrentUser } from "@/lib/auth/session";
import { toCsv } from "@/lib/domain/export";
import { centsToInput } from "@/lib/domain/money";
import { buildXlsx } from "@/lib/export/xlsx";
import { exportTransactions } from "@/lib/server/export";
import { parseTransactionFilters } from "@/lib/validation/transaction";

/** Movements matching the list filters, as CSV or Excel (ADR-042). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = parseTransactionFilters(Object.fromEntries(url.searchParams));
  const rows = await exportTransactions(user.id, filters);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };

  if (format === "xlsx") {
    const file = buildXlsx(
      "Transactions",
      [
        { label: "Date", type: "date", width: 12 },
        { label: "Type", width: 14 },
        { label: "Libellé", width: 32 },
        { label: "Magasin", width: 20 },
        { label: "Catégorie", width: 20 },
        { label: "Compte", width: 18 },
        { label: "Montant", type: "money", width: 14 },
        { label: "Ma part", type: "money", width: 14 },
        { label: "Note", width: 30 },
      ],
      rows.map((r) => [
        r.date,
        r.type,
        r.label,
        r.merchant,
        r.category,
        r.account,
        r.amountCents / 100,
        r.myShareCents / 100,
        r.notes,
      ]),
    );
    return new Response(new Uint8Array(file), {
      headers: {
        ...headers,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="mywallet-transactions-${stamp}.xlsx"`,
      },
    });
  }

  const csv = toCsv(
    [
      { key: "date", label: "Date" },
      { key: "type", label: "Type" },
      { key: "label", label: "Libellé" },
      { key: "merchant", label: "Magasin" },
      { key: "category", label: "Catégorie" },
      { key: "account", label: "Compte" },
      { key: "amount", label: "Montant", amount: true },
      { key: "myShare", label: "Ma part", amount: true },
      { key: "notes", label: "Note" },
    ],
    rows.map((r) => ({
      date: r.date,
      type: r.type,
      label: r.label,
      merchant: r.merchant,
      category: r.category,
      account: r.account,
      amount: centsToInput(r.amountCents),
      myShare: centsToInput(r.myShareCents),
      notes: r.notes,
    })),
  );
  return new Response(csv, {
    headers: {
      ...headers,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="mywallet-transactions-${stamp}.csv"`,
    },
  });
}
