"use client";

import { ArrowLeftRight } from "lucide-react";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import { merchantLogoProps } from "@/components/ui/merchant-logo-props";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateFr } from "@/lib/domain/dates";
import type { TransactionListRow } from "@/lib/server/transactions";
import { cn } from "@/lib/utils";
import { useTransactionDialog } from "./transaction-dialog";

function RowLogo({ row }: { row: TransactionListRow }) {
  if (row.kind === "transfer") {
    return (
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-muted">
        <ArrowLeftRight className="size-4" aria-hidden />
      </span>
    );
  }
  if (row.merchantId && row.merchantLogo && row.merchantName) {
    return (
      <MerchantLogo
        {...merchantLogoProps({ id: row.merchantId, name: row.merchantName, ...row.merchantLogo })}
      />
    );
  }
  return <MerchantLogo name={row.label} />;
}

function KindBadge({ kind, sharedCents }: Pick<TransactionListRow, "kind" | "sharedCents">) {
  if (sharedCents > 0) {
    return (
      <Badge tone="muted" title="Une partie est due par d'autres personnes">
        Partagé
      </Badge>
    );
  }
  if (kind === "refund") return <Badge tone="muted">Avoir</Badge>;
  if (kind === "transfer") return <Badge tone="muted">Virement</Badge>;
  if (kind === "reimbursement") return <Badge tone="muted">Remboursement</Badge>;
  return null;
}

function RowAmount({ row }: { row: TransactionListRow }) {
  return (
    <Amount
      cents={row.amountCents}
      currency={row.currency}
      variant={row.kind === "transfer" ? "plain" : "flow"}
    />
  );
}

/** Opens the edit dialog; reimbursements are managed from their claim (Sprint 4). */
function useOpen(row: TransactionListRow) {
  const { openEdit } = useTransactionDialog();
  return row.kind === "reimbursement" ? undefined : () => openEdit(row.id);
}

function LabelButton({ row, compact }: { row: TransactionListRow; compact?: boolean }) {
  const open = useOpen(row);
  const meta = [row.categoryName ?? (row.kind === "transfer" ? "Virement" : "Non catégorisé")];
  return (
    <button
      type="button"
      onClick={open}
      disabled={!open}
      className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-1 focus-visible:after:-outline-offset-1 focus-visible:after:outline-accent disabled:cursor-default"
    >
      <RowLogo row={row} />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-base">{row.label}</span>
          <KindBadge kind={row.kind} sharedCents={row.sharedCents} />
        </span>
        <span className={cn("truncate text-xs text-muted", !compact && "md:hidden")}>
          {meta[0]}
          <span className="max-sm:hidden"> · {row.accountName}</span>
        </span>
      </span>
    </button>
  );
}

/** Compact list (dashboard, mobile). */
function RowList({ rows }: { rows: TransactionListRow[] }) {
  return (
    <ul className="px-2 pb-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="relative flex min-h-14 items-center gap-3 rounded-sm px-2 hover:bg-surface-2"
        >
          <LabelButton row={row} compact />
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <RowAmount row={row} />
            <span className="text-xs text-muted">{formatDateFr(row.occurredOn)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TransactionRows({
  rows,
  compact = false,
}: {
  rows: TransactionListRow[];
  compact?: boolean;
}) {
  if (compact) return <RowList rows={rows} />;
  return (
    <>
      <div className="md:hidden">
        <RowList rows={rows} />
      </div>
      <Table className="max-md:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Libellé</TableHead>
            <TableHead className="w-48">Catégorie</TableHead>
            <TableHead className="w-40">Compte</TableHead>
            <TableHead className="w-36 text-right">Montant</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="relative">
              <TableCell className="text-muted tabular-nums">
                {formatDateFr(row.occurredOn)}
              </TableCell>
              <TableCell className="max-w-0">
                <LabelButton row={row} />
              </TableCell>
              <TableCell className={cn("truncate", !row.categoryName && "text-muted")}>
                {row.categoryName ?? (row.kind === "transfer" ? "Virement" : "Non catégorisé")}
              </TableCell>
              <TableCell className="truncate text-muted">{row.accountName}</TableCell>
              <TableCell className="text-right">
                <RowAmount row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
