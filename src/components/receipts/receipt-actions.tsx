"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { deleteReceiptAction, reopenReceiptAction } from "@/lib/actions/imports";
import { formatDateFr } from "@/lib/domain/dates";
import type { ReceiptDetail } from "@/lib/server/receipts";

/** Validated or rejected receipt: summary, link to the movement, reopen or delete. */
export function ReceiptActions({ receipt }: { receipt: ReceiptDetail }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    to?: string,
  ) {
    setBusy(true);
    setError(null);
    const r = await action();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Action impossible.");
      return;
    }
    toast(done);
    if (to) router.push(to);
  }

  return (
    <div className="flex flex-col gap-4">
      {receipt.status === "validated" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          <dt className="text-muted">Enregistré</dt>
          <dd>
            <Link
              href={`/transactions?q=${encodeURIComponent(receipt.extraction?.merchantName ?? "")}`}
              className="text-accent underline-offset-4 hover:underline"
            >
              Voir dans les transactions
            </Link>
          </dd>
          {receipt.returnDeadline && (
            <>
              <dt className="text-muted">Retour</dt>
              <dd>jusqu&apos;au {formatDateFr(receipt.returnDeadline)}</dd>
            </>
          )}
          {receipt.warrantyUntil && (
            <>
              <dt className="text-muted">Garantie</dt>
              <dd>jusqu&apos;au {formatDateFr(receipt.warrantyUntil)}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-base text-muted">
          Ce ticket a été rejeté : il n&apos;a aucun effet sur vos comptes.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {receipt.status === "rejected" && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(() => reopenReceiptAction(receipt.id), "Ticket remis à vérifier.")}
          >
            Remettre à vérifier
          </Button>
        )}
        <Button
          variant={confirmDelete ? "danger" : "ghost"}
          disabled={busy}
          onClick={() =>
            confirmDelete
              ? run(() => deleteReceiptAction(receipt.id), "Ticket supprimé.", "/tickets")
              : setConfirmDelete(true)
          }
        >
          {confirmDelete
            ? receipt.status === "validated"
              ? "Confirmer : la dépense est conservée"
              : "Confirmer la suppression"
            : "Supprimer le ticket"}
        </Button>
      </div>
    </div>
  );
}
