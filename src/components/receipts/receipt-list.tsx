import Link from "next/link";
import { Amount } from "@/components/ui/amount";
import { formatDateFr } from "@/lib/domain/dates";
import type { ReceiptListRow } from "@/lib/server/receipts";
import { ConfidenceHint, ReceiptStatusBadge, ReceiptThumb } from "./receipt-visuals";

/** One line per receipt: thumbnail, merchant or file name, date, total, status. */
export function ReceiptList({ rows }: { rows: ReceiptListRow[] }) {
  return (
    <ul className="divide-y divide-border" role="list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/tickets/${r.id}`}
            className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            <ReceiptThumb id={r.id} hasThumbnail={r.hasThumbnail} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className="truncate text-base text-text"
                title={r.merchantName ?? r.filename ?? undefined}
              >
                {r.merchantName ?? r.filename ?? "Ticket"}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span>
                  {r.date ? formatDateFr(r.date) : `Envoyé le ${formatDateFr(r.createdAt)}`}
                </span>
                {r.level && r.status === "to_review" && <ConfidenceHint level={r.level} />}
                {r.duplicate && r.status === "to_review" && (
                  <span className="text-warning">Doublon possible</span>
                )}
              </span>
            </span>
            {r.totalCents !== null && (
              <Amount cents={-r.totalCents} variant="flow" className="text-base" />
            )}
            <ReceiptStatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
