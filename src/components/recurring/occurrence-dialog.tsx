"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  cancelOccurrenceValidation,
  skipOccurrence,
  validateOccurrence,
} from "@/lib/actions/recurring";
import { formatDateFr } from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import type { OccurrenceRow } from "@/lib/server/recurring";
import {
  occurrenceConfirmSchema,
  type OccurrenceConfirmInput,
  type OccurrenceConfirmValues,
} from "@/lib/validation/recurring";
import { OccurrenceBadge, RecurringLogo } from "./recurring-visuals";

type Ctx = { open: (o: OccurrenceRow) => void };
const OccurrenceDialogContext = createContext<Ctx | null>(null);

export function useOccurrenceDialog(): Ctx {
  const ctx = use(OccurrenceDialogContext);
  if (!ctx) throw new Error("useOccurrenceDialog must be used inside OccurrenceDialogProvider");
  return ctx;
}

type AccountOption = { id: string; name: string };

/**
 * Validate / skip / cancel an occurrence. `accounts` are the user's active accounts; the
 * rule's own account is added when it has been archived since.
 */
export function OccurrenceDialogProvider({
  accounts,
  today,
  children,
}: {
  accounts: AccountOption[];
  today: string;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<OccurrenceRow | null>(null);
  const value = useMemo<Ctx>(() => ({ open: setCurrent }), []);
  const close = () => setCurrent(null);

  return (
    <OccurrenceDialogContext value={value}>
      {children}
      <Dialog open={current !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {current && (
            <OccurrencePanel
              key={`${current.id}:${current.status}`}
              occurrence={current}
              accounts={accounts}
              today={today}
              onDone={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </OccurrenceDialogContext>
  );
}

/** Button opening the dialog for one occurrence (rows of the calendar and dashboard). */
export function OccurrenceButton({
  occurrence,
  className,
  children,
}: {
  occurrence: OccurrenceRow;
  className?: string;
  children: ReactNode;
}) {
  const { open } = useOccurrenceDialog();
  return (
    <button type="button" className={className} onClick={() => open(occurrence)}>
      {children}
    </button>
  );
}

const plainAmount = (cents: number) =>
  formatCents(Math.abs(cents), { sign: "never" }).replace(/\s?€$/, "");

function OccurrencePanel({
  occurrence: o,
  accounts,
  today,
  onDone,
}: {
  occurrence: OccurrenceRow;
  accounts: AccountOption[];
  today: string;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { openEdit } = useTransactionDialog();

  const options = accounts.some((a) => a.id === o.accountId)
    ? accounts
    : [...accounts, { id: o.accountId, name: `${o.accountName} (archivé)` }];

  const form = useForm<OccurrenceConfirmValues, unknown, OccurrenceConfirmInput>({
    resolver: zodResolver(occurrenceConfirmSchema),
    defaultValues: {
      amount: plainAmount(o.amountCents),
      // Une échéance future validée en avance est datée d'aujourd'hui.
      occurredOn: o.dueOn <= today ? o.dueOn : today,
      accountId: o.accountId,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const kindLabel =
    o.kind === "transfer"
      ? `Épargne vers ${o.toAccountName ?? "un compte"}`
      : o.kind === "income"
        ? "Revenu"
        : "Charge";

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Action impossible.");
      return;
    }
    toast(done);
    onDone();
  }

  async function onSubmit() {
    setError(null);
    const result = await validateOccurrence(o.id, form.getValues());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("Échéance validée : le mouvement est enregistré.");
    onDone();
  }

  const header = (
    <DialogHeader>
      <div className="flex items-center gap-3 pr-8">
        <RecurringLogo
          kind={o.kind}
          label={o.label}
          merchantId={o.merchantId}
          merchantName={o.merchantName}
          merchantLogo={o.merchantLogo}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle className="truncate">{o.label}</DialogTitle>
          <DialogDescription>
            {kindLabel} · prévue le {formatDateFr(o.dueOn, "long")}
          </DialogDescription>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2">
        <OccurrenceBadge status={o.status} dueOn={o.dueOn} today={today} />
        <span className="flex items-baseline gap-2 text-sm text-muted">
          {o.status === "confirmed" && o.actualCents !== null ? "Montant réel" : "Montant prévu"}
          <Amount
            cents={
              o.status === "confirmed" && o.actualCents !== null ? o.actualCents : o.amountCents
            }
            variant={o.kind === "transfer" ? "plain" : "flow"}
          />
        </span>
      </div>
    </DialogHeader>
  );

  const errorBox = error && (
    <p role="alert" className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );

  if (o.status === "confirmed") {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 px-5 pb-5">
          <p className="text-sm text-muted">
            Le mouvement est enregistré. Annuler la validation le supprime et l&apos;échéance
            redevient prévue.
          </p>
          {errorBox}
        </div>
        <DialogFooter className="justify-between">
          <Button
            type="button"
            size="sm"
            variant={confirmCancel ? "danger" : "ghost"}
            disabled={busy}
            onClick={() =>
              confirmCancel
                ? run(() => cancelOccurrenceValidation(o.id), "Validation annulée.")
                : setConfirmCancel(true)
            }
          >
            {confirmCancel ? "Confirmer l'annulation" : "Annuler la validation"}
          </Button>
          {o.transactionId && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onDone();
                openEdit(o.transactionId!);
              }}
            >
              Voir le mouvement
            </Button>
          )}
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      {header}
      <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
        {o.status === "skipped" && (
          <p className="text-sm text-muted">
            Échéance ignorée : elle ne compte plus dans le reste à vivre.
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Field label="Montant réel" error={errors.amount?.message}>
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <Input
                  id={id}
                  inputMode="decimal"
                  autoComplete="off"
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
        <Field
          label={o.kind === "transfer" ? "Compte débité" : "Compte"}
          error={errors.accountId?.message}
        >
          {({ id, describedBy, invalid }) => (
            <NativeSelect
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("accountId")}
            >
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {errorBox}
      </div>
      <DialogFooter className="justify-between">
        {o.status === "skipped" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => skipOccurrence(o.id, false), "Échéance remise en prévu.")}
          >
            Remettre en prévu
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => skipOccurrence(o.id, true), "Échéance ignorée.")}
          >
            Ignorer cette fois
          </Button>
        )}
        <Button type="submit" size="sm" variant="primary" disabled={isSubmitting || busy}>
          {isSubmitting ? "Validation…" : "Valider"}
        </Button>
      </DialogFooter>
    </form>
  );
}
