"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { archiveAccountAction, saveAccount } from "@/lib/actions/settings";
import { formatCents } from "@/lib/domain/money";
import {
  ACCOUNT_TYPE_LABELS,
  accountInputSchema,
  type AccountFormValues,
  type AccountInput,
  type AccountTypeValue,
} from "@/lib/validation/settings";

export type AccountItem = {
  id: string;
  name: string;
  type: AccountTypeValue;
  institution: string | null;
  openingBalanceCents: number;
  balanceCents: number;
  movementCount: number;
};

type Editing = { account: AccountItem | null } | null;

export function AccountsManager({ accounts }: { accounts: AccountItem[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comptes</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setEditing({ account: null })}>
          <Plus aria-hidden /> Ajouter
        </Button>
      </CardHeader>
      <ul className="px-2 pb-2">
        {accounts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setEditing({ account: a })}
              className="flex min-h-12 w-full items-center gap-3 rounded-sm px-2 text-left hover:bg-surface-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base">{a.name}</span>
                <span className="truncate text-xs text-muted">
                  {[ACCOUNT_TYPE_LABELS[a.type], a.institution].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Amount cents={a.balanceCents} />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing?.account ? "Modifier le compte" : "Nouveau compte"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <AccountForm
              key={editing.account?.id ?? "new"}
              account={editing.account}
              canArchive={accounts.length > 1}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AccountForm({
  account,
  canArchive,
  onDone,
}: {
  account: AccountItem | null;
  canArchive: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const form = useForm<AccountFormValues, unknown, AccountInput>({
    resolver: zodResolver(accountInputSchema),
    defaultValues: {
      name: account?.name ?? "",
      type: account?.type ?? "checking",
      institution: account?.institution ?? "",
      openingBalance: account
        ? formatCents(account.openingBalanceCents, { sign: "auto" }).replace(/\s?€$/, "")
        : "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setError(null);
    const r = await saveAccount(account?.id ?? null, form.getValues());
    if (!r.ok) return setError(r.error);
    toast(account ? "Compte modifié." : "Compte ajouté.");
    onDone();
  }

  async function onArchive() {
    if (!account) return;
    if (!confirmArchive) return setConfirmArchive(true);
    const r = await archiveAccountAction(account.id);
    if (!r.ok) return setError(r.error);
    toast("Compte archivé.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
        <Field label="Nom" error={errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoFocus
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("name")}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" error={errors.type?.message}>
            {({ id, describedBy, invalid }) => (
              <NativeSelect
                id={id}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("type")}
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Banque" error={errors.institution?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                placeholder="Facultatif"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("institution")}
              />
            )}
          </Field>
        </div>
        <Field
          label="Solde initial"
          error={errors.openingBalance?.message}
          hint="Solde du compte avant le premier mouvement saisi (négatif accepté)."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              placeholder="0,00"
              className="font-mono tabular-nums"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("openingBalance")}
            />
          )}
        </Field>
        {account && (
          <p className="text-sm text-muted">
            {account.movementCount} mouvement{account.movementCount > 1 ? "s" : ""} · solde actuel{" "}
            <Amount cents={account.balanceCents} className="text-sm" />
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
      <DialogFooter className="justify-between">
        {account && canArchive ? (
          <Button
            type="button"
            size="sm"
            variant={confirmArchive ? "danger" : "ghost"}
            onClick={onArchive}
          >
            {confirmArchive ? "Confirmer l'archivage" : "Archiver"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={isSubmitting}>
            {account ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
