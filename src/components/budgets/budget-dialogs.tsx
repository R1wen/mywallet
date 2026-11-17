"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  archiveGoalAction,
  contributeAction,
  deleteBudgetAction,
  saveBudgetAction,
  saveGoalAction,
} from "@/lib/actions/budgets";
import { buildCategoryTree } from "@/lib/domain/categories";
import { centsToInput } from "@/lib/domain/money";
import {
  budgetInputSchema,
  goalInputSchema,
  type BudgetFormValues,
  type BudgetInput,
  type GoalFormValues,
  type GoalInput,
} from "@/lib/validation/budgets";

export type CategoryOption = { id: string; parentId: string | null; name: string };
type Option = { id: string; name: string };

const typed = centsToInput;

function AmountInput(props: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        className="pr-7 text-right font-mono tabular-nums"
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">
        €
      </span>
    </div>
  );
}

function FormDialog({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open && children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}

function Footer({
  onCancel,
  saving,
  label,
}: {
  onCancel: () => void;
  saving: boolean;
  label: string;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Annuler
      </Button>
      <Button type="submit" variant="primary" size="sm" disabled={saving}>
        {saving ? "Enregistrement…" : label}
      </Button>
    </DialogFooter>
  );
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

export type EditableBudget = {
  id: string;
  categoryId: string | null;
  period: "monthly" | "yearly";
  amountCents: number;
  alertPercent: number;
};

function BudgetForm({
  budget,
  categories,
  onDone,
}: {
  budget: EditableBudget | null;
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<BudgetFormValues, unknown, BudgetInput>({
    resolver: zodResolver(budgetInputSchema),
    defaultValues: {
      categoryId: budget?.categoryId ?? "",
      period: budget?.period ?? "monthly",
      amount: budget ? typed(budget.amountCents) : "",
      alertPercent: budget?.alertPercent ?? 80,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const tree = buildCategoryTree(
    categories.map((c, i) => ({ ...c, kind: "expense" as const, position: i })),
  );

  async function onSubmit() {
    setError(null);
    const r = await saveBudgetAction(budget?.id ?? null, form.getValues());
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(budget ? "Budget modifié." : "Budget créé.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogBody className="grid gap-3 sm:grid-cols-2">
        <Field label="Catégorie" error={errors.categoryId?.message} className="sm:col-span-2">
          {({ id, describedBy, invalid }) => (
            <NativeSelect
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("categoryId")}
            >
              <option value="">Toutes les dépenses</option>
              {tree.map((root) =>
                root.children.length ? (
                  <optgroup key={root.id} label={root.name}>
                    <option value={root.id}>{root.name} (avec ses sous-catégories)</option>
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
        <Field label="Montant" error={errors.amount?.message}>
          {({ id, describedBy, invalid }) => (
            <AmountInput
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("amount")}
            />
          )}
        </Field>
        <Field label="Période" error={errors.period?.message}>
          {({ id }) => (
            <NativeSelect id={id} {...form.register("period")}>
              <option value="monthly">Par mois</option>
              <option value="yearly">Par an</option>
            </NativeSelect>
          )}
        </Field>
        <Field
          label="Alerte à partir de"
          error={errors.alertPercent?.message}
          hint="Pourcentage du budget déjà dépensé."
          className="sm:col-span-2"
        >
          {({ id, describedBy, invalid }) => (
            <div className="relative max-w-32">
              <Input
                id={id}
                inputMode="numeric"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className="pr-7 text-right font-mono tabular-nums"
                {...form.register("alertPercent")}
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">
                %
              </span>
            </div>
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </DialogBody>
      <Footer onCancel={onDone} saving={isSubmitting} label={budget ? "Enregistrer" : "Créer"} />
    </form>
  );
}

export function BudgetDialog({
  budget = null,
  categories,
  name,
}: {
  budget?: EditableBudget | null;
  categories: CategoryOption[];
  /** Budget name, for the edit button's accessible label. */
  name?: string;
}) {
  return (
    <FormDialog
      title={budget ? "Modifier le budget" : "Nouveau budget"}
      trigger={
        budget ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Modifier le budget ${name ?? ""}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="primary" size="sm">
            <Plus aria-hidden /> Nouveau budget
          </Button>
        )
      }
    >
      {(close) => <BudgetForm budget={budget} categories={categories} onDone={close} />}
    </FormDialog>
  );
}

export function DeleteBudgetButton({ id, name }: { id: string; name: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Button
      variant={confirm ? "danger" : "ghost"}
      size={confirm ? "sm" : "icon-sm"}
      aria-label={
        confirm ? `Confirmer la suppression du budget ${name}` : `Supprimer le budget ${name}`
      }
      disabled={pending}
      onBlur={() => setConfirm(false)}
      onClick={() => {
        if (!confirm) {
          setConfirm(true);
          return;
        }
        start(async () => {
          const r = await deleteBudgetAction(id);
          toast(r.ok ? "Budget supprimé." : r.error);
        });
      }}
    >
      {confirm ? "Supprimer" : <Trash2 />}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                       */
/* -------------------------------------------------------------------------- */

export type EditableGoal = {
  id: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
  accountId: string | null;
};

function GoalForm({
  goal,
  accounts,
  onDone,
}: {
  goal: EditableGoal | null;
  accounts: Option[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<GoalFormValues, unknown, GoalInput>({
    resolver: zodResolver(goalInputSchema),
    defaultValues: {
      name: goal?.name ?? "",
      target: goal ? typed(goal.targetCents) : "",
      targetDate: goal?.targetDate ?? "",
      accountId: goal?.accountId ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit() {
    setError(null);
    const r = await saveGoalAction(goal?.id ?? null, form.getValues());
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(goal ? "Objectif modifié." : "Objectif créé.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogBody className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" error={errors.name?.message} className="sm:col-span-2">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              maxLength={60}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("name")}
            />
          )}
        </Field>
        <Field label="Objectif" error={errors.target?.message}>
          {({ id, describedBy, invalid }) => (
            <AmountInput
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("target")}
            />
          )}
        </Field>
        <Field label="Pour le" error={errors.targetDate?.message} hint="Facultatif.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="[color-scheme:dark]"
              {...form.register("targetDate")}
            />
          )}
        </Field>
        <Field
          label="Suivi"
          error={errors.accountId?.message}
          hint="Avec un compte, la progression suit son solde."
          className="sm:col-span-2"
        >
          {({ id, describedBy }) => (
            <NativeSelect id={id} aria-describedby={describedBy} {...form.register("accountId")}>
              <option value="">À la main (versements saisis)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Solde de {a.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </DialogBody>
      <Footer onCancel={onDone} saving={isSubmitting} label={goal ? "Enregistrer" : "Créer"} />
    </form>
  );
}

export function GoalDialog({
  goal = null,
  accounts,
}: {
  goal?: EditableGoal | null;
  accounts: Option[];
}) {
  return (
    <FormDialog
      title={goal ? "Modifier l'objectif" : "Nouvel objectif"}
      trigger={
        goal ? (
          <Button variant="ghost" size="sm" aria-label={`Modifier l'objectif ${goal.name}`}>
            <Pencil aria-hidden /> Modifier
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus aria-hidden /> Nouvel objectif
          </Button>
        )
      }
    >
      {(close) => <GoalForm goal={goal} accounts={accounts} onDone={close} />}
    </FormDialog>
  );
}

function ContributionForm({
  goal,
  onDone,
}: {
  goal: { id: string; name: string };
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [withdraw, setWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await contributeAction({
            goalId: goal.id,
            amount: withdraw ? `-${amount.trim()}` : amount,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          toast(withdraw ? "Montant retiré de l'objectif." : "Montant ajouté à l'objectif.");
          onDone();
        });
      }}
    >
      <DialogBody className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Sens" className="grid grid-cols-2 gap-2">
          {[
            { value: false, label: "Mettre de côté" },
            { value: true, label: "Reprendre" },
          ].map((o) => (
            <label
              key={o.label}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border px-3 text-base has-checked:border-accent"
            >
              <input
                type="radio"
                name="sens"
                className="accent-[var(--accent)]"
                checked={withdraw === o.value}
                onChange={() => setWithdraw(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
        <Field label="Montant">
          {({ id }) => (
            <AmountInput
              id={id}
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <p className="text-sm text-muted">
          Un simple suivi : aucun mouvement n&apos;est créé sur vos comptes.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </DialogBody>
      <Footer onCancel={onDone} saving={pending} label="Enregistrer" />
    </form>
  );
}

export function ContributionDialog({ goal }: { goal: { id: string; name: string } }) {
  return (
    <FormDialog
      title={`Objectif ${goal.name}`}
      trigger={
        <Button variant="secondary" size="sm" aria-label={`Ajouter un montant à ${goal.name}`}>
          <Plus aria-hidden /> Ajouter
        </Button>
      }
    >
      {(close) => <ContributionForm goal={goal} onDone={close} />}
    </FormDialog>
  );
}

export function ArchiveGoalButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Archiver l'objectif ${name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await archiveGoalAction(id);
          toast(r.ok ? "Objectif archivé." : r.error);
        })
      }
    >
      <Archive aria-hidden /> Archiver
    </Button>
  );
}
