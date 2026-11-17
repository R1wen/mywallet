"use client";

import { strToU8, zipSync, type Zippable } from "fflate";
import { Download, FileSpreadsheet, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { requestDeletionAction } from "@/lib/actions/account";
import { toParisDateString } from "@/lib/domain/dates";
import { UPLOAD_EXTENSIONS, type UploadType } from "@/lib/domain/files";

/** Parts of the full export, in the order they are fetched (see /api/export/data). */
const PARTS = [
  "profil",
  "comptes",
  "categories",
  "magasins",
  "transactions",
  "lignes_tickets",
  "personnes",
  "creances",
  "remboursements",
  "regles_recurrentes",
  "echeances",
  "tickets",
  "budgets",
  "objectifs",
  "regles_classement",
  "preglages_import",
  "reglages_import",
  "abonnements_ignores",
] as const;

function download(data: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Full export (ADR-042): every table as JSON plus the receipt files, zipped in the
 * browser so no single server response grows with the archive.
 */
async function buildArchive(onProgress: (text: string) => void): Promise<Uint8Array> {
  const files: Zippable = {};
  const tickets: { id: string; mimeType: string | null }[] = [];
  for (const part of PARTS) {
    onProgress(`Export : ${part.replace(/_/g, " ")}…`);
    const rows: unknown[] = [];
    for (let page = 0; ; page++) {
      const res = await fetch(`/api/export/data?part=${part}&page=${page}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`export ${part}`);
      const body = (await res.json()) as { rows: unknown[]; hasMore: boolean };
      rows.push(...body.rows);
      if (!body.hasMore) break;
    }
    if (part === "tickets") tickets.push(...(rows as { id: string; mimeType: string | null }[]));
    files[`donnees/${part}.json`] = new Uint8Array(strToU8(JSON.stringify(rows, null, 2)));
  }
  for (const [i, t] of tickets.entries()) {
    onProgress(`Fichiers de tickets : ${i + 1} / ${tickets.length}…`);
    const res = await fetch(`/api/receipts/${t.id}/original`);
    if (!res.ok) continue;
    const ext = UPLOAD_EXTENSIONS[t.mimeType as UploadType] ?? "bin";
    // Photos and PDF are already compressed: stored as is, without deflate.
    files[`tickets/${t.id}.${ext}`] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
  }
  files["LISEZMOI.txt"] = new Uint8Array(
    strToU8(
      "Export complet de vos données myWallet.\n" +
        "donnees/*.json : une table par fichier (montants en centimes, dates AAAA-MM-JJ).\n" +
        "tickets/ : les fichiers originaux de vos tickets, nommés par identifiant.\n",
    ),
  );
  return zipSync(files, { level: 6 });
}

function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const r = await requestDeletionAction({ password, confirmation });
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // Signed out everywhere: close the dialog, then leave the app area.
    setOpen(false);
    router.replace(`/connexion?suppression=${toParisDateString(r.data.purgeOn)}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          <Trash2 aria-hidden /> Supprimer mon compte
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer mon compte</DialogTitle>
          <DialogDescription>
            Vous serez déconnecté partout. Le compte et toutes ses données (mouvements, tickets,
            budgets…) seront effacés définitivement dans 7 jours. Vous reconnecter avant annule la
            suppression.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Pensez à exporter vos données avant : l&apos;effacement est irréversible.
            </p>
            <Field label="Mot de passe">
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label="Tapez SUPPRIMER pour confirmer">
              {({ id }) => (
                <Input
                  id={id}
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              )}
            </Field>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={pending || confirmation !== "SUPPRIMER" || !password}
            >
              {pending ? "Suppression…" : "Supprimer dans 7 jours"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Données et compte": exports (GDPR access and portability) and account deletion. */
export function DataAndAccount() {
  const [progress, setProgress] = useState<string | null>(null);

  async function exportAll() {
    try {
      setProgress("Préparation de l'export…");
      const zip = await buildArchive(setProgress);
      download(
        zip,
        `mywallet-export-${new Date().toISOString().slice(0, 10)}.zip`,
        "application/zip",
      );
      toast("Export téléchargé.");
    } catch {
      toast("Export impossible. Réessayez.");
    } finally {
      setProgress(null);
    }
  }

  const link =
    "inline-flex h-8 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-surface-2 pointer-coarse:h-11 [&_svg]:size-4";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Données et compte</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            Toutes vos données (tables et fichiers de tickets) dans une archive ZIP.
          </p>
          <div className="grid gap-2 sm:grid-cols-[auto_auto_auto] sm:justify-start">
            <Button variant="secondary" size="sm" disabled={progress !== null} onClick={exportAll}>
              <Download aria-hidden /> Exporter toutes mes données
            </Button>
            <a className={link} href="/api/export/transactions?format=csv">
              <FileSpreadsheet aria-hidden /> Transactions CSV
            </a>
            <a className={link} href="/api/export/transactions?format=xlsx">
              <FileSpreadsheet aria-hidden /> Transactions Excel
            </a>
          </div>
          {progress && (
            <p role="status" className="text-xs text-muted">
              {progress}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-muted">
            Suppression définitive après un délai de 7 jours, annulée si vous vous reconnectez.
          </p>
          <div>
            <DeleteAccount />
          </div>
        </div>
      </div>
    </Card>
  );
}
