"use client";

import { HandCoins } from "lucide-react";
import { useState } from "react";
import { Amount } from "@/components/ui/amount";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { recordPaymentAction } from "@/lib/actions/sharing";
import { allocatePayment } from "@/lib/domain/claims";
import { formatDateFr } from "@/lib/domain/dates";
import { parseAmountToCents, centsToInput } from "@/lib/domain/money";

export type OpenClaimLine = {
  claimId: string;
  /** Expense label, e.g. the merchant. */
  label: string;
  /** Receipt line, null for a share of the whole expense. */
  detail: string | null;
  date: string;
  remainingCents: number;
};

const typed = centsToInput;

function PaymentForm({
  personId,
  personName,
  claims,
  accounts,
  today,
  onDone,
}: {
  personId: string;
  personName: string;
  claims: OpenClaimLine[];
  accounts: { id: string; name: string }[];
  today: string;
  onDone: () => void;
}) {
  const due = claims.reduce((s, c) => s + c.remainingCents, 0);
  const [total, setTotal] = useState(typed(due));
  const [lines, setLines] = useState<Record<string, string>>(() =>
    Object.fromEntries(claims.map((c) => [c.claimId, typed(c.remainingCents)])),
  );
  const [occurredOn, setOccurredOn] = useState(today);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** A new total is spread over the claims, oldest first (ADR-033). */
  function changeTotal(value: string) {
    setTotal(value);
    const cents = parseAmountToCents(value);
    const clear = () => setLines(Object.fromEntries(claims.map((c) => [c.claimId, ""])));
    if (cents === null || cents <= 0) {
      // Never submit amounts left from an earlier keystroke.
      clear();
      return;
    }
    const r = allocatePayment(
      claims.map((c) => ({ id: c.claimId, remainingCents: c.remainingCents })),
      cents,
    );
    if (!r.ok) {
      clear();
      setError(r.error);
      return;
    }
    setError(null);
    const paid = new Map(r.data.map((a) => [a.id, a.amountCents]));
    setLines(
      Object.fromEntries(
        claims.map((c) => [c.claimId, paid.has(c.claimId) ? typed(paid.get(c.claimId)!) : ""]),
      ),
    );
  }

  function changeLine(id: string, value: string) {
    const next = { ...lines, [id]: value };
    setLines(next);
    const sum = Object.values(next).reduce((s, v) => s + (parseAmountToCents(v) ?? 0), 0);
    setTotal(typed(sum));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const r = await recordPaymentAction({
      personId,
      occurredOn,
      accountId,
      allocations: claims.map((c) => ({ claimId: c.claimId, amount: lines[c.claimId] ?? "" })),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(`Remboursement de ${personName} enregistré.`);
    onDone();
  }

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Montant reçu">
            {({ id }) => (
              <div className="relative">
                <Input
                  id={id}
                  inputMode="decimal"
                  autoComplete="off"
                  className="pr-7 text-right font-mono tabular-nums"
                  value={total}
                  onChange={(e) => changeTotal(e.target.value)}
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">
                  €
                </span>
              </div>
            )}
          </Field>
          <Field label="Date">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                max={today}
                className="[color-scheme:dark]"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            )}
          </Field>
          <Field label="Reçu sur">
            {({ id }) => (
              <NativeSelect
                id={id}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        {claims.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">
              Réparti de la plus ancienne à la plus récente ; modifiable ligne par ligne.
            </span>
            <ul role="list" className="divide-y divide-border rounded-sm border border-border">
              {claims.map((c) => (
                <li
                  key={c.claimId}
                  className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base">
                      {c.label}
                      {c.detail && <span className="text-muted"> · {c.detail}</span>}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDateFr(c.date)} · reste{" "}
                      <Amount cents={c.remainingCents} className="text-muted" />
                    </span>
                  </span>
                  <Input
                    aria-label={`Montant pour ${c.label}${c.detail ? `, ${c.detail}` : ""}`}
                    inputMode="decimal"
                    autoComplete="off"
                    className="text-right font-mono tabular-nums"
                    value={lines[c.claimId] ?? ""}
                    onChange={(e) => changeLine(c.claimId, e.target.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-muted">
          Le montant est crédité sur le compte choisi. Ce n&apos;est pas un revenu.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Annuler
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={saving || !accounts.length}
          onClick={submit}
        >
          {saving ? "Enregistrement…" : "Enregistrer le remboursement"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Records money received from a person, over one claim or all of their open claims. */
export function PaymentButton({
  personId,
  personName,
  claims,
  accounts,
  today,
  label = "Enregistrer un remboursement",
  variant = "primary",
}: {
  personId: string;
  personName: string;
  claims: OpenClaimLine[];
  accounts: { id: string; name: string }[];
  today: string;
  label?: string;
  variant?: ButtonProps["variant"];
}) {
  const [open, setOpen] = useState(false);
  const due = claims.reduce((s, c) => s + c.remainingCents, 0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          {variant === "primary" && <HandCoins aria-hidden />} {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remboursement de {personName}</DialogTitle>
          <DialogDescription>
            Reste dû : <Amount cents={due} className="text-muted" />
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PaymentForm
            personId={personId}
            personName={personName}
            claims={claims}
            accounts={accounts}
            today={today}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
