"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { commitBankImportAction, previewBankImportAction } from "@/lib/actions/imports";
import { decodeCsv, type ColumnMapping } from "@/lib/domain/bank-csv";
import { formatDateFr } from "@/lib/domain/dates";
import type { BankPreview, PreviewLine } from "@/lib/server/bank-import";
import { MAX_CSV_CHARS, type ImportAction } from "@/lib/validation/imports";

const STATUS: Record<
  PreviewLine["status"],
  { label: string; tone: "neutral" | "muted" | "accent" }
> = {
  new: { label: "Nouveau", tone: "neutral" },
  match: { label: "Déjà saisi", tone: "accent" },
  duplicate: { label: "Déjà importé", tone: "muted" },
};

const ACTION_LABELS: Record<ImportAction, string> = {
  create: "Créer",
  link: "Pointer",
  skip: "Ignorer",
};

const defaultAction = (l: PreviewLine): ImportAction =>
  l.status === "duplicate" ? "skip" : l.status === "match" ? "link" : "create";

type ColumnKey = keyof ColumnMapping;
const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: "Date",
  label: "Libellé",
  amount: "Montant",
  debit: "Débit",
  credit: "Crédit",
};

export function BankImport({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [actions, setActions] = useState<Record<number, ImportAction>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(csv: string, account: string, map: ColumnMapping | null) {
    // Only the latest request may update the preview (a slow older one is ignored).
    const ticket = ++latest.current;
    setBusy(true);
    setError(null);
    const r = await previewBankImportAction({ accountId: account, csv, mapping: map });
    if (ticket !== latest.current) return;
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPreview(r.data);
    setMapping(r.data.mapping);
    setActions(Object.fromEntries(r.data.lines.map((l) => [l.row, defaultAction(l)])));
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const csv = decodeCsv(new Uint8Array(await f.arrayBuffer()));
    if (csv.length > MAX_CSV_CHARS) {
      setError("Fichier trop volumineux (2 Mo maximum).");
      return;
    }
    setFile({ name: f.name, csv });
    await load(csv, accountId, null);
  }

  function changeColumn(key: ColumnKey, value: string) {
    if (!file) return;
    // Unrecognised columns: start from an empty mapping the user fills in.
    const base: ColumnMapping = mapping ?? {
      date: 0,
      label: 0,
      amount: null,
      debit: null,
      credit: null,
    };
    const next = { ...base, [key]: value === "" ? null : Number(value) };
    if (key === "amount" && value !== "") Object.assign(next, { debit: null, credit: null });
    if ((key === "debit" || key === "credit") && value !== "") next.amount = null;
    setMapping(next);
    const usable = next.amount !== null || (next.debit !== null && next.credit !== null);
    if (usable) void load(file.csv, accountId, next);
  }

  async function commit() {
    if (!file || !mapping || !preview) return;
    setBusy(true);
    setError(null);
    const r = await commitBankImportAction({
      accountId,
      csv: file.csv,
      mapping,
      decisions: preview.lines.map((l) => ({
        row: l.row,
        action: actions[l.row] ?? defaultAction(l),
      })),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const { created, linked, skipped } = r.data;
    toast(
      `${created} créé${created > 1 ? "s" : ""}, ${linked} pointé${linked > 1 ? "s" : ""}, ${skipped} ignoré${skipped > 1 ? "s" : ""}.`,
    );
    router.push("/transactions");
  }

  const counts = useMemo(() => {
    const c = { create: 0, link: 0, skip: 0 };
    for (const l of preview?.lines ?? []) c[actions[l.row] ?? defaultAction(l)]++;
    return c;
  }, [preview, actions]);

  if (!accounts.length) {
    return (
      <Card>
        <EmptyState icon={FileSpreadsheet} title="Créez d'abord un compte dans les réglages." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Compte du relevé">
            {({ id }) => (
              <NativeSelect
                id={id}
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  if (file) void load(file.csv, e.target.value, mapping);
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              aria-label="Fichier CSV du relevé"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button
              variant={file ? "outline" : "primary"}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload /> {file ? "Changer de fichier" : "Choisir un fichier CSV"}
            </Button>
          </div>
        </div>
        <p className="border-t border-border px-4 py-3 text-sm text-muted">
          Exportez le relevé au format CSV depuis votre banque. Les lignes déjà saisies (même
          montant, à 3 jours près) sont pointées au lieu d&apos;être créées une seconde fois.
        </p>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {preview && file && (
        <Card>
          <CardHeader>
            <CardTitle className="truncate">{file.name}</CardTitle>
            {preview.fromPreset && <span className="text-xs text-muted">Colonnes mémorisées</span>}
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 px-4 pt-2 pb-4 sm:grid-cols-5">
            {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
              <Field key={key} label={COLUMN_LABELS[key]}>
                {({ id }) => (
                  <NativeSelect
                    id={id}
                    value={mapping?.[key] ?? ""}
                    onChange={(e) => changeColumn(key, e.target.value)}
                    disabled={busy}
                  >
                    {(key === "amount" || key === "debit" || key === "credit") && (
                      <option value="">Aucune</option>
                    )}
                    {preview.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Colonne ${i + 1}`}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ))}
          </div>
          {!mapping && (
            <p className="px-4 pb-4 text-sm text-warning">
              Colonnes non reconnues : choisissez la date, le libellé et le montant.
            </p>
          )}
          {preview.errors.length > 0 && (
            <p className="px-4 pb-3 text-sm text-warning">
              {preview.errors.length} ligne{preview.errors.length > 1 ? "s" : ""} illisible
              {preview.errors.length > 1 ? "s" : ""} ignorée{preview.errors.length > 1 ? "s" : ""}{" "}
              (ligne
              {preview.errors.length > 1 ? "s" : ""}{" "}
              {preview.errors
                .slice(0, 5)
                .map((e) => e.row)
                .join(", ")}
              {preview.errors.length > 5 ? "…" : ""}).
            </p>
          )}
          {preview.truncated && (
            <p className="px-4 pb-3 text-sm text-warning">
              Seules les 5 000 premières lignes sont importées.
            </p>
          )}
          {preview.lines.length > 0 && (
            <ul role="list" className="divide-y divide-border border-t border-border">
              {preview.lines.map((l) => (
                <li
                  key={l.row}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:min-h-11 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto_7rem_7rem] sm:py-1"
                >
                  <span className="hidden text-sm text-muted tabular-nums sm:block">
                    {formatDateFr(l.date)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-base break-words sm:truncate">
                      {l.label}
                    </span>
                    {l.match && (
                      <span className="truncate text-xs text-muted">
                        Correspond à « {l.match.label} » du {formatDateFr(l.match.occurredOn)}
                      </span>
                    )}
                  </span>
                  <Badge tone={STATUS[l.status].tone} className="hidden sm:inline-flex">
                    {STATUS[l.status].label}
                  </Badge>
                  <Amount cents={l.amountCents} variant="flow" className="text-right text-base" />
                  <span className="flex items-center gap-2 text-sm text-muted sm:hidden">
                    <span className="tabular-nums">{formatDateFr(l.date)}</span>
                    <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                  </span>
                  <NativeSelect
                    aria-label={`Action pour la ligne du ${formatDateFr(l.date)} : ${l.label}`}
                    value={actions[l.row] ?? defaultAction(l)}
                    disabled={l.status === "duplicate"}
                    onChange={(e) =>
                      setActions((a) => ({ ...a, [l.row]: e.target.value as ImportAction }))
                    }
                    className="w-28 justify-self-end sm:w-full"
                  >
                    {(l.match
                      ? (["link", "create", "skip"] as const)
                      : (["create", "skip"] as const)
                    ).map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          )}
          {preview.lines.length > 0 && (
            <CardFooter className="flex-wrap justify-between">
              <span className="text-sm text-muted">
                {counts.create} à créer · {counts.link} à pointer · {counts.skip} ignorée
                {counts.skip > 1 ? "s" : ""}
              </span>
              <Button
                variant="primary"
                disabled={busy || counts.create + counts.link === 0}
                onClick={commit}
              >
                {busy ? "Import…" : "Importer"}
              </Button>
            </CardFooter>
          )}
        </Card>
      )}
    </div>
  );
}
