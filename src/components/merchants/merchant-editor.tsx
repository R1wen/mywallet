"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  mergeMerchantAction,
  resetMerchantLogo,
  saveMerchant,
  uploadMerchantLogo,
} from "@/lib/actions/merchants";
import {
  merchantInputSchema,
  type MerchantFormValues,
  type MerchantInput,
} from "@/lib/validation/merchant";

type Option = { id: string; name: string };

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

export function MerchantDetailsForm({
  merchant,
  categories,
}: {
  merchant: {
    id: string;
    name: string;
    domain: string | null;
    defaultCategoryId: string | null;
    aliases: string[];
  };
  categories: { id: string; name: string; parentId: string | null }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<MerchantFormValues, unknown, MerchantInput>({
    resolver: zodResolver(merchantInputSchema),
    defaultValues: {
      name: merchant.name,
      domain: merchant.domain ?? "",
      defaultCategoryId: merchant.defaultCategoryId ?? "",
      aliases: merchant.aliases.join("\n"),
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const roots = categories.filter((c) => !c.parentId);

  async function onSubmit() {
    setError(null);
    const values = form.getValues();
    const r = await saveMerchant(merchant.id, values);
    if (!r.ok) return setError(r.error);
    form.reset(values);
    toast("Magasin enregistré.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations</CardTitle>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4 p-4">
        <Field label="Nom" error={errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("name")}
            />
          )}
        </Field>
        <Field
          label="Site web"
          error={errors.domain?.message}
          hint="Sert à trouver le logo (favicon du site)."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              placeholder="exemple.fr"
              inputMode="url"
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("domain")}
            />
          )}
        </Field>
        <Field label="Catégorie par défaut" error={errors.defaultCategoryId?.message}>
          {({ id, describedBy, invalid }) => (
            <NativeSelect
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("defaultCategoryId")}
            >
              <option value="">Aucune</option>
              {roots.map((root) => {
                const children = categories.filter((c) => c.parentId === root.id);
                return children.length ? (
                  <optgroup key={root.id} label={root.name}>
                    <option value={root.id}>{root.name} (général)</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={root.id} value={root.id}>
                    {root.name}
                  </option>
                );
              })}
            </NativeSelect>
          )}
        </Field>
        <Field
          label="Alias"
          error={errors.aliases?.message}
          hint="Un par ligne, tel qu'imprimé sur un ticket ou un relevé (ex. CRF EXPRESS)."
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={3}
              className="resize-y"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...form.register("aliases")}
            />
          )}
        </Field>
        <ErrorLine message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function MerchantLogoForm({
  merchantId,
  logoSource,
}: {
  merchantId: string;
  logoSource: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Échec.");
      else toast(done);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Automatique : icône de la marque, favicon du site ou initiales.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Choisir une image de logo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const data = new FormData();
            data.set("merchantId", merchantId);
            data.set("logo", file);
            e.target.value = "";
            run(() => uploadMerchantLogo(data), "Logo importé.");
          }}
        />
        <div
          role="radiogroup"
          aria-label="Logo affiché"
          className="grid grid-cols-3 gap-1 rounded-sm border border-border bg-bg p-1"
        >
          {(
            [
              { value: null, label: "Automatique" },
              { value: "none", label: "Initiales" },
              { value: "upload", label: "Image" },
            ] as const
          ).map((o) => {
            const selected = logoSource === o.value;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={pending}
                onClick={() => {
                  if (o.value === "upload") return fileRef.current?.click();
                  if (selected) return;
                  run(
                    () => resetMerchantLogo(merchantId, o.value === "none" ? "none" : "auto"),
                    o.value === "none" ? "Initiales affichées." : "Logo automatique rétabli.",
                  );
                }}
                className={cn(
                  "h-7 rounded-[4px] text-sm transition-colors duration-[var(--duration-fast)] pointer-coarse:h-11",
                  selected ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {logoSource === "upload" && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
          >
            Remplacer l&apos;image
          </Button>
        )}
        <p className="text-xs text-muted">Image : PNG, JPEG ou WebP, 256 Ko maximum.</p>
        <ErrorLine message={error} />
      </div>
    </Card>
  );
}

export function MerchantMergeForm({
  merchantId,
  merchantName,
  others,
}: {
  merchantId: string;
  merchantName: string;
  others: Option[];
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const source = others.find((o) => o.id === sourceId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fusionner un doublon</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Les achats du doublon passent sur {merchantName}, son nom devient un alias, puis il est
          supprimé de l&apos;annuaire.
        </p>
        <NativeSelect
          aria-label="Magasin à fusionner"
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setConfirming(false);
          }}
        >
          <option value="">Choisir le doublon…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
        <ErrorLine message={error} />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant={confirming ? "danger" : "secondary"}
            disabled={!source || pending}
            onClick={() => {
              if (!confirming) return setConfirming(true);
              setError(null);
              startTransition(async () => {
                const r = await mergeMerchantAction({ targetId: merchantId, sourceId });
                if (!r.ok) return setError(r.error);
                toast(`${source?.name} fusionné dans ${merchantName}.`);
                setSourceId("");
                setConfirming(false);
                router.refresh();
              });
            }}
          >
            {confirming ? `Confirmer : fusionner ${source?.name}` : "Fusionner"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
