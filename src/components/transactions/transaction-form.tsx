"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Users } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  removeTransaction,
  saveTransaction,
  type TransactionFormData,
} from "@/lib/actions/transactions";
import { buildCategoryTree } from "@/lib/domain/categories";
import { toParisDateString } from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import type { TransactionDetail } from "@/lib/server/transactions";
import { cn } from "@/lib/utils";
import {
  EDITABLE_TX_KINDS,
  TX_KIND_LABELS,
  transactionInputSchema,
  type EditableTxKind,
  type TransactionFormValues,
  type TransactionInput,
} from "@/lib/validation/transaction";

const LAST_ACCOUNT_KEY = "mw.lastAccountId";

function readLastAccount(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function rememberAccount(id: string) {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Stockage indisponible (navigation privée) : simple confort perdu.
  }
}

const CATEGORY_KIND_FOR = {
  expense: "expense",
  refund: "expense",
  income: "income",
  transfer: "transfer",
} as const;

function defaultValues(
  data: TransactionFormData,
  tx: TransactionDetail | null,
): TransactionFormValues {
  if (tx) {
    return {
      kind: tx.kind === "reimbursement" ? "income" : tx.kind,
      amount: formatCents(tx.amountCents, { sign: "never" }).replace(/\s?€$/, ""),
      occurredOn: tx.occurredOn,
      label: tx.label === tx.merchantName ? "" : tx.label,
      merchantName: tx.merchantName,
      accountId: tx.accountId,
      toAccountId: tx.toAccountId ?? "",
      categoryId: tx.categoryId ?? "",
      notes: tx.notes ?? "",
    };
  }
  const last = readLastAccount();
  const accountId = data.accounts.find((a) => a.id === last)?.id ?? data.accounts[0]?.id ?? "";
  return {
    kind: "expense",
    amount: "",
    occurredOn: toParisDateString(new Date()),
    label: "",
    merchantName: "",
    accountId,
    toAccountId: "",
    categoryId: "",
    notes: "",
  };
}

export function TransactionForm({
  data,
  transaction,
  onDone,
  onShare,
}: {
  data: TransactionFormData;
  transaction: TransactionDetail | null;
  onDone: () => void;
  /** Opens the share dialog of the edited expense. */
  onShare?: (transactionId: string) => void;
}) {
  const isEdit = transaction !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<TransactionFormValues, unknown, TransactionInput>({
    resolver: zodResolver(transactionInputSchema),
    defaultValues: defaultValues(data, transaction),
  });
  const { errors, isSubmitting } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" }) as EditableTxKind;
  const isTransfer = kind === "transfer";
  // Un virement ne change pas de type (et inversement) une fois enregistré.
  const lockedKinds = isEdit
    ? EDITABLE_TX_KINDS.filter((k) => (k === "transfer") !== (transaction.kind === "transfer"))
    : [];

  const tree = buildCategoryTree(
    data.categories
      .filter((c) => c.kind === CATEGORY_KIND_FOR[kind])
      .map((c, i) => ({ ...c, position: i })),
  );

  async function onSubmit(values: TransactionInput) {
    setFormError(null);
    const result = await saveTransaction(transaction?.id ?? null, form.getValues());
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    rememberAccount(values.accountId);
    toast(isEdit ? "Transaction modifiée." : "Transaction ajoutée.");
    onDone();
  }

  async function onDelete() {
    if (!transaction) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const result = await removeTransaction(transaction.id);
    setDeleting(false);
    if (!result.ok) {
      setFormError(result.error);
      setConfirmDelete(false);
      return;
    }
    toast("Transaction supprimée.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
        <div
          role="radiogroup"
          aria-label="Type de mouvement"
          className="grid grid-cols-4 gap-1 rounded-sm border border-border bg-bg p-1"
        >
          {EDITABLE_TX_KINDS.map((k) => {
            const selected = kind === k;
            const disabled = lockedKinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => {
                  form.setValue("kind", k);
                  form.setValue("categoryId", "");
                }}
                className={cn(
                  "h-7 rounded-[4px] text-sm transition-colors duration-[var(--duration-fast)] pointer-coarse:h-11",
                  selected ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text",
                  disabled && "cursor-not-allowed opacity-40 hover:text-muted",
                )}
              >
                {TX_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Field label="Montant" error={errors.amount?.message}>
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <Input
                  id={id}
                  autoFocus
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className="pr-7 text-right font-mono tabular-nums"
                  {...form.register("amount")}
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">
                  €
                </span>
              </div>
            )}
          </Field>
          <Field label="Date" error={errors.occurredOn?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className="[color-scheme:dark]"
                {...form.register("occurredOn")}
              />
            )}
          </Field>
        </div>

        {!isTransfer && (
          <Field
            label="Magasin ou site"
            error={errors.merchantName?.message}
            hint="Un nouveau nom crée le magasin dans l'annuaire."
          >
            {({ id, describedBy, invalid }) => (
              <>
                <Input
                  id={id}
                  list="mw-merchant-options"
                  autoComplete="off"
                  placeholder="Carrefour, Amazon…"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...form.register("merchantName")}
                />
                <datalist id="mw-merchant-options">
                  {data.merchants.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        )}

        <Field label="Libellé" error={errors.label?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder={
                isTransfer ? "Épargne de novembre" : "Facultatif si le magasin est saisi"
              }
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("label")}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label={isTransfer ? "Compte débité" : "Compte"} error={errors.accountId?.message}>
            {({ id, describedBy, invalid }) => (
              <NativeSelect
                id={id}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("accountId")}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {isTransfer ? (
            <Field label="Compte crédité" error={errors.toAccountId?.message}>
              {({ id, describedBy, invalid }) => (
                <NativeSelect
                  id={id}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...form.register("toAccountId")}
                >
                  <option value="">Choisir…</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ) : (
            <Field label="Catégorie" error={errors.categoryId?.message}>
              {({ id, describedBy, invalid }) => (
                <NativeSelect
                  id={id}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...form.register("categoryId")}
                >
                  <option value="">{kind === "income" ? "Aucune" : "Celle du magasin"}</option>
                  {tree.map((root) =>
                    root.children.length ? (
                      <optgroup key={root.id} label={root.name}>
                        <option value={root.id}>{root.name} (général)</option>
                        {root.children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <option key={root.id} value={root.id}>
                        {root.name}
                      </option>
                    ),
                  )}
                </NativeSelect>
              )}
            </Field>
          )}
        </div>

        <Field label="Note" error={errors.notes?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder="Facultatif"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("notes")}
            />
          )}
        </Field>

        {formError && (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        )}
      </div>

      <DialogFooter className="justify-between">
        {isEdit ? (
          <Button
            type="button"
            variant={confirmDelete ? "danger" : "ghost"}
            size="sm"
            onClick={onDelete}
            disabled={deleting}
          >
            {confirmDelete ? "Confirmer la suppression" : "Supprimer"}
          </Button>
        ) : (
          <span className="text-xs text-muted max-sm:hidden pointer-coarse:hidden">
            Entrée pour valider
          </span>
        )}
        <div className="flex gap-2">
          {isEdit && transaction?.kind === "expense" && kind === "expense" && onShare && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onShare(transaction.id)}
            >
              <Users aria-hidden /> Partager
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Enregistrement…" : isEdit ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
