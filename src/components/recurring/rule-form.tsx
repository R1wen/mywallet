"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  removeRule,
  saveRule,
  type RecurringFormData,
  type RuleDetail,
} from "@/lib/actions/recurring";
import { buildCategoryTree } from "@/lib/domain/categories";
import { toParisDateString } from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import { describeRecurrence, RECURRENCE_FREQUENCIES } from "@/lib/domain/recurrence";
import { cn } from "@/lib/utils";
import {
  FREQUENCY_LABELS,
  RECURRING_KIND_LABELS,
  RECURRING_RULE_KINDS,
  recurringRuleInputSchema,
  type RecurringRuleFormValues,
  type RecurringRuleInput,
  type RecurringRuleKind,
} from "@/lib/validation/recurring";

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

function defaultValues(data: RecurringFormData, rule: RuleDetail | null): RecurringRuleFormValues {
  if (rule) {
    return {
      kind: rule.kind,
      label: rule.label === rule.merchantName ? "" : rule.label,
      amount: formatCents(rule.amountCents, { sign: "never" }).replace(/\s?€$/, ""),
      merchantName: rule.merchantName,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId ?? "",
      categoryId: rule.categoryId ?? "",
      frequency: rule.frequency,
      interval: String(rule.interval),
      dayOfMonth: String(rule.dayOfMonth ?? Number(rule.startOn.slice(8, 10))),
      startOn: rule.startOn,
      endOn: rule.endOn ?? "",
    };
  }
  const today = toParisDateString(new Date());
  const checking = data.accounts.find((a) => a.type === "checking") ?? data.accounts[0];
  return {
    kind: "expense",
    label: "",
    amount: "",
    merchantName: "",
    accountId: checking?.id ?? "",
    toAccountId: "",
    categoryId: "",
    frequency: "monthly",
    interval: "1",
    dayOfMonth: String(Number(today.slice(8, 10))),
    startOn: today,
    endOn: "",
  };
}

export function RuleForm({
  data,
  rule,
  onDone,
}: {
  data: RecurringFormData;
  rule: RuleDetail | null;
  onDone: () => void;
}) {
  const isEdit = rule !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<RecurringRuleFormValues, unknown, RecurringRuleInput>({
    resolver: zodResolver(recurringRuleInputSchema),
    defaultValues: defaultValues(data, rule),
  });
  const { errors, isSubmitting } = form.formState;
  const [kind, frequency, interval, dayOfMonth, startOn] = useWatch({
    control: form.control,
    name: ["kind", "frequency", "interval", "dayOfMonth", "startOn"],
  }) as [RecurringRuleKind, (typeof RECURRENCE_FREQUENCIES)[number], string, string, string];
  const isTransfer = kind === "transfer";
  const lockedKinds = isEdit
    ? RECURRING_RULE_KINDS.filter((k) => (k === "transfer") !== (rule.kind === "transfer"))
    : [];

  const tree = buildCategoryTree(
    data.categories.filter((c) => c.kind === kind).map((c, i) => ({ ...c, position: i })),
  );

  const n = Number(interval);
  const day = Number(dayOfMonth);
  const preview =
    /^\d{4}-\d{2}-\d{2}$/.test(startOn ?? "") && n >= 1 && n <= 52 && day >= 1 && day <= 31
      ? describeRecurrence({
          frequency,
          interval: n,
          dayOfMonth: frequency === "weekly" ? null : day,
          startOn,
          endOn: null,
        })
      : null;

  async function onSubmit() {
    setFormError(null);
    const result = await saveRule(rule?.id ?? null, form.getValues());
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    toast(isEdit ? "Règle modifiée." : "Règle ajoutée.");
    onDone();
  }

  async function onDelete() {
    if (!rule) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const result = await removeRule(rule.id);
    setDeleting(false);
    if (!result.ok) {
      setFormError(result.error);
      setConfirmDelete(false);
      return;
    }
    toast("Règle supprimée. Les mouvements déjà validés sont conservés.");
    onDone();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
        <div
          role="radiogroup"
          aria-label="Type de règle"
          className="grid grid-cols-3 gap-1 rounded-sm border border-border bg-bg p-1"
        >
          {RECURRING_RULE_KINDS.map((k) => {
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
                {RECURRING_KIND_LABELS[k]}
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
          {isTransfer ? (
            <Field label="Libellé" error={errors.label?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  autoComplete="off"
                  placeholder="Épargne mensuelle"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...form.register("label")}
                />
              )}
            </Field>
          ) : (
            <Field label="Magasin ou organisme" error={errors.merchantName?.message}>
              {({ id, describedBy, invalid }) => (
                <>
                  <Input
                    id={id}
                    list="mw-rule-merchant-options"
                    autoComplete="off"
                    placeholder={kind === "income" ? "Employeur" : "EDF, Netflix…"}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    {...form.register("merchantName")}
                  />
                  <datalist id="mw-rule-merchant-options">
                    {data.merchants.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          )}
        </div>

        {!isTransfer && (
          <Field label="Libellé" error={errors.label?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="off"
                placeholder={kind === "income" ? "Salaire" : "Facultatif si le magasin est saisi"}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("label")}
              />
            )}
          </Field>
        )}

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
            <Field label="Compte d'épargne" error={errors.toAccountId?.message}>
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

        <fieldset className="flex flex-col gap-3 rounded-sm border border-border p-3">
          <legend className="px-1 text-sm text-muted">Échéances</legend>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Fréquence" error={errors.frequency?.message}>
              {({ id, describedBy, invalid }) => (
                <NativeSelect
                  id={id}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...form.register("frequency")}
                >
                  {RECURRENCE_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Tous les" error={errors.interval?.message}>
              {({ id, describedBy, invalid }) => (
                <div className="relative">
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    className="pr-16 text-right font-mono tabular-nums"
                    {...form.register("interval")}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted">
                    {frequency === "weekly" ? "sem." : frequency === "yearly" ? "an(s)" : "mois"}
                  </span>
                </div>
              )}
            </Field>
            {frequency === "weekly" ? (
              <div aria-hidden />
            ) : (
              <Field label="Le jour" error={errors.dayOfMonth?.message}>
                {({ id, describedBy, invalid }) => (
                  <NativeSelect
                    id={id}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    {...form.register("dayOfMonth")}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <Field label="À partir du" error={errors.startOn?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className="[color-scheme:dark]"
                  {...form.register("startOn")}
                />
              )}
            </Field>
            <Field label="Jusqu'au" error={errors.endOn?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className="[color-scheme:dark]"
                  {...form.register("endOn")}
                />
              )}
            </Field>
          </div>
          <p className="text-sm text-muted" aria-live="polite">
            {preview ?? "Complétez la fréquence et la date de début."}
            {preview && frequency === "yearly" ? " (mois de la date de début)" : ""}
            {preview && frequency === "weekly" ? " (jour de la date de début)" : ""}
          </p>
        </fieldset>

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
            Première échéance à partir d&apos;aujourd&apos;hui.
          </span>
        )}
        <div className="flex gap-2">
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
