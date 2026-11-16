"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { rejectReceiptAction, validateReceipt } from "@/lib/actions/imports";
import { buildCategoryTree } from "@/lib/domain/categories";
import { formatDateFr } from "@/lib/domain/dates";
import { formatCents, parseAmountToCents } from "@/lib/domain/money";
import type { ReviewField } from "@/lib/domain/receipts/validate";
import type { ReceiptDetail } from "@/lib/server/receipts";
import { cn } from "@/lib/utils";
import {
  receiptReviewSchema,
  type ReceiptReviewInput,
  type ReceiptReviewValues,
} from "@/lib/validation/imports";

export type ReviewChoices = {
  accounts: { id: string; name: string }[];
  categories: { id: string; parentId: string | null; name: string; kind: "expense" }[];
  merchants: string[];
};

const amountText = (cents: number) => formatCents(cents, { sign: "auto" }).replace(/\s?€$/, "");

function defaults(
  receipt: ReceiptDetail,
  choices: ReviewChoices,
  today: string,
): ReceiptReviewValues {
  const e = receipt.extraction;
  const p = e?.parsed;
  const items = (p?.items ?? []).map((i) => ({
    label: i.label,
    quantity: String(i.quantity).replace(".", ","),
    amount: amountText(i.totalCents),
  }));
  if (p?.discountsCents) {
    items.push({ label: "Remises", quantity: "1", amount: amountText(p.discountsCents) });
  }
  const firstMatch = receipt.bankMatches[0];
  return {
    merchantName: e?.merchantName ?? "",
    occurredOn: p?.date && p.date <= today ? p.date : today,
    amount: p?.totalCents ? amountText(p.totalCents) : "",
    accountId: firstMatch?.accountId ?? choices.accounts[0]?.id ?? "",
    categoryId: "",
    notes: "",
    items,
    returnDeadline: p?.returnDeadline ?? "",
    warrantyUntil: p?.warrantyUntil ?? "",
    attachToTransactionId: firstMatch?.id ?? "",
  };
}

/** Warning hint (not an error) under a field the deterministic checks are unsure about. */
function doubtHint(receipt: ReceiptDetail, field: ReviewField) {
  const message = doubt(receipt, field);
  return message ? <span className="text-warning">{message}</span> : undefined;
}

/** "À vérifier" under a field the deterministic checks are not sure about. */
function doubt(receipt: ReceiptDetail, field: ReviewField): string | undefined {
  const score = receipt.confidence?.[field];
  if (score === undefined || score >= 1) return undefined;
  return receipt.extraction?.issues.find((i) => i.field === field)?.message ?? "À vérifier.";
}

export function ReviewForm({
  receipt,
  choices,
  today,
}: {
  receipt: ReceiptDetail;
  choices: ReviewChoices;
  today: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const form = useForm<ReceiptReviewValues, unknown, ReceiptReviewInput>({
    resolver: zodResolver(receiptReviewSchema),
    defaultValues: defaults(receipt, choices, today),
  });
  const { errors, isSubmitting } = form.formState;
  const items = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const total = useWatch({ control: form.control, name: "amount" });
  const attachTo = useWatch({ control: form.control, name: "attachToTransactionId" });
  const attached = receipt.bankMatches.find((m) => m.id === attachTo) ?? null;

  const linesSum = (watchedItems ?? []).reduce(
    (s, i) => s + (parseAmountToCents(i?.amount ?? "") ?? 0),
    0,
  );
  const totalCents = parseAmountToCents(total ?? "");
  const mismatch = watchedItems?.length && totalCents !== null && linesSum !== totalCents;
  const tree = buildCategoryTree(choices.categories.map((c, i) => ({ ...c, position: i })));
  const issues =
    receipt.extraction?.issues.filter((i) => i.field === "items" || i.field === "vat") ?? [];

  async function onSubmit() {
    setFormError(null);
    const r = await validateReceipt(receipt.id, form.getValues());
    if (!r.ok) {
      setFormError(r.error);
      return;
    }
    toast(attached ? "Ticket rattaché au mouvement bancaire." : "Dépense enregistrée.");
    router.push("/tickets");
  }

  async function onReject() {
    setRejecting(true);
    const r = await rejectReceiptAction(receipt.id);
    setRejecting(false);
    if (!r.ok) {
      setFormError(r.error);
      return;
    }
    toast("Ticket rejeté.");
    router.push("/tickets");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {receipt.extraction?.duplicateOfId && (
        <p className="rounded-sm border border-warning/30 px-3 py-2 text-sm text-warning">
          Un ticket du même magasin, du même jour et du même total existe déjà.{" "}
          <a
            href={`/tickets/${receipt.extraction.duplicateOfId}`}
            className="underline underline-offset-4"
          >
            Voir l&apos;autre ticket
          </a>
        </p>
      )}
      {receipt.failureReason && (
        <p className="rounded-sm border border-border px-3 py-2 text-sm text-muted">
          {receipt.failureReason} Saisissez les informations à partir de l&apos;image.
        </p>
      )}

      {receipt.bankMatches.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-muted">Mouvement bancaire</legend>
          {receipt.bankMatches.map((m) => (
            <label
              key={m.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border px-3 py-2 has-checked:border-accent"
            >
              <input
                type="radio"
                value={m.id}
                className="accent-[var(--accent)]"
                {...form.register("attachToTransactionId")}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base">Rattacher à « {m.bankLabel ?? m.label} »</span>
                <span className="text-xs text-muted">
                  {formatDateFr(m.occurredOn)} · {m.accountName}
                </span>
              </span>
              <Amount cents={m.amountCents} variant="flow" />
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border px-3 py-2 has-checked:border-accent">
            <input
              type="radio"
              value=""
              className="accent-[var(--accent)]"
              {...form.register("attachToTransactionId")}
            />
            <span className="text-base">Créer une nouvelle dépense</span>
          </label>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Magasin"
          error={errors.merchantName?.message}
          hint={doubtHint(receipt, "merchant")}
          className="sm:col-span-2"
        >
          {({ id, describedBy, invalid }) => (
            <>
              <Input
                id={id}
                list="mw-review-merchants"
                autoComplete="off"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                {...form.register("merchantName")}
              />
              <datalist id="mw-review-merchants">
                {choices.merchants.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Total payé" error={errors.amount?.message} hint={doubtHint(receipt, "total")}>
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <Input
                id={id}
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
        <Field
          label="Date d'achat"
          error={errors.occurredOn?.message}
          hint={attached ? "La date du relevé est conservée." : doubtHint(receipt, "date")}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              max={today}
              disabled={Boolean(attached)}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="[color-scheme:dark]"
              {...form.register("occurredOn")}
            />
          )}
        </Field>
        <Field
          label="Compte"
          error={errors.accountId?.message}
          hint={attached ? `Mouvement sur ${attached.accountName}.` : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <NativeSelect
              id={id}
              disabled={Boolean(attached)}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("accountId")}
            >
              {choices.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Catégorie" error={errors.categoryId?.message}>
          {({ id, describedBy, invalid }) => (
            <NativeSelect
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("categoryId")}
            >
              <option value="">Celle du magasin</option>
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
      </div>

      <section aria-labelledby="mw-items-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="mw-items-title" className="text-sm font-medium text-muted">
            Articles
          </h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => items.append({ label: "", quantity: "1", amount: "" })}
          >
            <Plus /> Ajouter une ligne
          </Button>
        </div>
        {issues.map((i) => (
          <p key={i.message} className="text-xs text-warning">
            {i.message}
          </p>
        ))}
        {items.fields.length > 0 ? (
          <div className="overflow-hidden rounded-sm border border-border">
            <div className="hidden grid-cols-[minmax(0,1fr)_4rem_6.5rem_2.75rem] gap-2 border-b border-border px-2 py-1.5 text-xs text-muted sm:grid">
              <span>Libellé</span>
              <span className="text-right">Qté</span>
              <span className="text-right">Montant</span>
              <span className="sr-only">Supprimer</span>
            </div>
            <ul role="list" className="divide-y divide-border">
              {items.fields.map((field, index) => {
                const err = errors.items?.[index];
                return (
                  <li
                    key={field.id}
                    className="grid grid-cols-[4rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_4rem_6.5rem_2.75rem] sm:py-1.5"
                  >
                    <Input
                      aria-label={`Libellé de la ligne ${index + 1}`}
                      aria-invalid={Boolean(err?.label)}
                      className="col-span-3 sm:col-span-1"
                      autoComplete="off"
                      {...form.register(`items.${index}.label`)}
                    />
                    <Input
                      aria-label={`Quantité de la ligne ${index + 1}`}
                      aria-invalid={Boolean(err?.quantity)}
                      inputMode="decimal"
                      className="text-right font-mono tabular-nums"
                      {...form.register(`items.${index}.quantity`)}
                    />
                    <Input
                      aria-label={`Montant de la ligne ${index + 1}`}
                      aria-invalid={Boolean(err?.amount)}
                      inputMode="decimal"
                      className="text-right font-mono tabular-nums"
                      {...form.register(`items.${index}.amount`)}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Supprimer la ligne ${index + 1}`}
                      onClick={() => items.remove(index)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm",
                mismatch ? "text-warning" : "text-muted",
              )}
            >
              <span>Somme des lignes</span>
              <span className="flex items-center gap-3">
                <Amount cents={linesSum} className={mismatch ? "text-warning" : "text-muted"} />
                {items.fields.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-muted underline underline-offset-4 hover:text-text"
                    onClick={() => items.replace([])}
                  >
                    Retirer les lignes
                  </button>
                )}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Aucune ligne : seule la dépense totale sera enregistrée.
          </p>
        )}
        {errors.items?.root?.message || errors.items?.message ? (
          <p className="text-xs text-danger">
            {errors.items?.root?.message ?? errors.items?.message}
          </p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Retour possible jusqu'au" error={errors.returnDeadline?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="[color-scheme:dark]"
              {...form.register("returnDeadline")}
            />
          )}
        </Field>
        <Field label="Garantie jusqu'au" error={errors.warrantyUntil?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="[color-scheme:dark]"
              {...form.register("warrantyUntil")}
            />
          )}
        </Field>
        <Field label="Note" error={errors.notes?.message} className="sm:col-span-2">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("notes")}
            />
          )}
        </Field>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={rejecting || isSubmitting}
          onClick={onReject}
        >
          Rejeter
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting
            ? "Enregistrement…"
            : attached
              ? "Valider et rattacher"
              : "Valider la dépense"}
        </Button>
      </div>
    </form>
  );
}
