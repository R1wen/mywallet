"use client";

import { Inbox, Plus, ReceiptText, Trash2, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { Amount } from "@/components/ui/amount";
import { Badge, ClaimBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useCommandPalette } from "@/components/shell/command-palette";
import { formatDateFr } from "@/lib/domain/dates";

const TOKENS = [
  ["--bg", "#0C0D0F"],
  ["--surface", "#131518"],
  ["--surface-2", "#1A1C20"],
  ["--border", "#24272C"],
  ["--border-strong", "#2F333A"],
  ["--text", "#E8E9EB"],
  ["--text-muted", "#8A8F98"],
  ["--text-subtle", "#5B606A"],
  ["--accent", "#3FB68B"],
  ["--danger", "#E5484D"],
  ["--warning", "#F5A524"],
] as const;

const TYPE_SCALE = [
  [40, "text-2xl", "Solde 12 480,00 €"],
  [28, "text-xl", "Titre de page"],
  [20, "text-lg", "Titre de section"],
  [16, "text-md", "Texte d'accent"],
  [14, "text-base", "Texte d'interface, base de l'application"],
  [13, "text-sm", "Texte secondaire et descriptions"],
  [12, "text-xs", "Légendes, en-têtes de colonnes"],
] as const;

const ROWS = [
  {
    merchant: "Carrefour",
    category: "Courses",
    date: "2026-11-14",
    cents: -8040,
    claim: "pending" as const,
  },
  { merchant: "Salaire Acme", category: "Revenus", date: "2026-11-01", cents: 285000, claim: null },
  {
    merchant: "SNCF Connect",
    category: "Transports",
    date: "2026-10-30",
    cents: -6400,
    claim: "reimbursed" as const,
  },
  {
    merchant: "Picard",
    category: "Courses",
    date: "2026-10-28",
    cents: -2315,
    claim: "gifted" as const,
  },
  { merchant: "Free Mobile", category: "Télécoms", date: "2026-10-27", cents: -1999, claim: null },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function DesignShowcase() {
  const palette = useCommandPalette();
  return (
    <div className="flex flex-col gap-10">
      <Section title="Tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {TOKENS.map(([name, hex]) => (
            <div
              key={name}
              className="flex items-center gap-2.5 rounded-sm border border-border bg-surface p-2"
            >
              <span
                className="size-8 shrink-0 rounded-sm border border-border-strong"
                style={{ background: `var(${name})` }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-text">{name}</span>
                <span className="num text-xs text-muted">{hex}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typographie — Geist Sans 400/500/600, montants en Geist Mono tabulaire">
        <div className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {TYPE_SCALE.map(([px, cls, sample]) => (
            <div key={px} className="flex items-baseline gap-6 px-4 py-3">
              <span className="num w-10 shrink-0 text-xs text-subtle">{px}</span>
              <span className={`${cls} truncate font-medium`}>{sample}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-6 px-4 py-3">
            <span className="num w-10 shrink-0 text-xs text-subtle">mono</span>
            <span className="flex flex-col gap-0.5 text-right">
              <Amount cents={123456} className="text-md" />
              <Amount cents={-8040} className="text-md" />
              <Amount cents={285000} variant="flow" className="text-md" />
            </span>
          </div>
        </div>
      </Section>

      <Section title="Boutons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">
            <Plus /> Ajouter une transaction
          </Button>
          <Button>Secondaire</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="ghost">Discret</Button>
          <Button variant="danger">
            <Trash2 /> Supprimer
          </Button>
          <Button variant="link">Lien</Button>
          <Button disabled>Désactivé</Button>
          <Button size="sm">Petit</Button>
          <Button size="icon" aria-label="Importer">
            <Upload />
          </Button>
        </div>
      </Section>

      <Section title="Champs">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Libellé" hint="Tel qu'il apparaît sur le ticket.">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} placeholder="Carrefour Market" />
            )}
          </Field>
          <Field label="Montant" error="Le montant doit être supérieur à 0.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                inputMode="decimal"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                defaultValue="0,00"
                className="num text-right"
              />
            )}
          </Field>
          <Field label="Compte">
            {({ id }) => (
              <Select defaultValue="courant">
                <SelectTrigger id={id}>
                  <SelectValue placeholder="Choisir un compte" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="courant">Compte courant</SelectItem>
                  <SelectItem value="livret">Livret A</SelectItem>
                  <SelectItem value="especes">Espèces</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Badges et statuts de créance">
        <div className="flex flex-wrap items-center gap-2">
          <ClaimBadge status="pending" />
          <ClaimBadge status="reimbursed" />
          <ClaimBadge status="gifted" />
          <Badge>Courses</Badge>
          <Badge tone="accent">Revenu</Badge>
          <Badge tone="danger">Budget dépassé</Badge>
        </div>
      </Section>

      <Section title="Cartes KPI">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Solde", 1248000, "plain"],
            ["Entrées du mois", 285000, "flow"],
            ["Dépenses du mois", -164233, "plain"],
            ["À récupérer", 4020, "plain"],
          ].map(([label, cents, variant]) => (
            <Card key={label as string}>
              <CardHeader>
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <Amount
                  cents={cents as number}
                  variant={variant as "plain" | "flow"}
                  className="text-xl font-medium"
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Tableau — lignes de 44 px, logos marchands, montants alignés à droite">
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="h-9 hover:bg-transparent">
                <TableHead>Magasin</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Partage</TableHead>
                <TableHead data-align="right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r.merchant}>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <MerchantLogo name={r.merchant} size={28} />
                      <span className="font-medium">{r.merchant}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted">{r.category}</TableCell>
                  <TableCell className="text-muted">{formatDateFr(r.date)}</TableCell>
                  <TableCell>{r.claim ? <ClaimBadge status={r.claim} /> : null}</TableCell>
                  <TableCell data-align="right">
                    <Amount cents={r.cents} variant="flow" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="Onglets">
        <Tabs defaultValue="articles">
          <TabsList>
            <TabsTrigger value="articles">Articles</TabsTrigger>
            <TabsTrigger value="partage">Partage</TabsTrigger>
            <TabsTrigger value="fichier">Fichier</TabsTrigger>
          </TabsList>
          <TabsContent value="articles" className="text-muted">
            12 articles extraits du ticket.
          </TabsContent>
          <TabsContent value="partage" className="text-muted">
            Aucun article attribué à une autre personne.
          </TabsContent>
          <TabsContent value="fichier" className="text-muted">
            ticket-carrefour.jpg, 1,2 Mo.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Dialogue, toast, palette de commandes">
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button>Ouvrir un dialogue</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Marquer comme remboursé</DialogTitle>
                <DialogDescription>
                  Léa vous doit 30,00 € pour le ticket Carrefour du 14 nov.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field label="Montant reçu">
                  {({ id }) => <Input id={id} defaultValue="30,00" className="num text-right" />}
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Annuler</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button
                    variant="primary"
                    onClick={() => toast.success("Remboursement enregistré.")}
                  >
                    Enregistrer
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            onClick={() => toast("Transaction ajoutée.", { description: "Carrefour, -80,40 €" })}
          >
            Afficher un toast
          </Button>
          <Button variant="ghost" onClick={palette.open}>
            Palette <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </Button>
        </div>
      </Section>

      <Section title="Chargement et état vide">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
          <Card>
            <EmptyState
              icon={Inbox}
              title="Aucun ticket à vérifier."
              description="Les tickets importés apparaissent ici avant validation."
              action={
                <Button size="sm">
                  <ReceiptText /> Importer un ticket
                </Button>
              }
            />
          </Card>
        </div>
      </Section>
    </div>
  );
}
