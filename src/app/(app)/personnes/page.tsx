import { Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PersonDialog } from "@/components/people/person-dialog";
import { PageHeader } from "@/components/shell/app-shell";
import { Amount } from "@/components/ui/amount";
import { Badge, ClaimBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { formatDateFr } from "@/lib/domain/dates";
import { listPeople } from "@/lib/server/sharing";
import { cn } from "@/lib/utils";

export default function PeoplePage() {
  return (
    <>
      <PageHeader
        title="Personnes"
        description="Ce que l'on vous doit sur les dépenses partagées."
        actions={<PersonDialog />}
      />
      <Suspense fallback={<ListSkeleton />}>
        <PeopleList />
      </Suspense>
    </>
  );
}

function Totals({
  pending,
  reimbursed,
  gifted,
}: {
  pending: number;
  reimbursed: number;
  gifted: number;
}) {
  const tiles = [
    { status: "pending" as const, label: "À récupérer", cents: pending },
    { status: "reimbursed" as const, label: "Déjà remboursé", cents: reimbursed },
    { status: "gifted" as const, label: "Offert", cents: gifted },
  ];
  return (
    <Card className="mb-6 grid grid-cols-1 divide-border max-sm:divide-y sm:grid-cols-3 sm:divide-x">
      {tiles.map((t) => (
        <div key={t.status} className="flex flex-col gap-1.5 px-4 py-3">
          <ClaimBadge status={t.status} className="self-start" />
          <span className="sr-only">{t.label}</span>
          <Amount cents={t.cents} className="text-lg font-medium" />
        </div>
      ))}
    </Card>
  );
}

async function PeopleList() {
  const user = await requireUser();
  const people = await listPeople(user.id);
  const sum = (key: "pendingCents" | "reimbursedCents" | "giftedCents") =>
    people.reduce((s, p) => s + p[key], 0);
  const sorted = [...people].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      b.pendingCents - a.pendingCents ||
      a.name.localeCompare(b.name, "fr"),
  );

  if (!people.length) {
    return (
      <Card>
        <EmptyState
          icon={Users}
          title="Aucune personne pour l'instant."
          description="Ajoutez les personnes avec qui vous partagez des dépenses, ou créez-les en validant un ticket."
          action={<PersonDialog />}
        />
      </Card>
    );
  }

  return (
    <>
      <Totals
        pending={sum("pendingCents")}
        reimbursed={sum("reimbursedCents")}
        gifted={sum("giftedCents")}
      />
      <Card className="min-w-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Personne</TableHead>
              <TableHead className="text-right max-sm:hidden">Créances ouvertes</TableHead>
              <TableHead className="max-md:hidden">Dernière dépense</TableHead>
              <TableHead className="text-right max-md:hidden">Remboursé</TableHead>
              <TableHead className="text-right">À récupérer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((p) => (
              <TableRow key={p.id} className="relative">
                <TableCell className="w-full max-w-0">
                  <Link
                    href={`/personnes/${p.id}`}
                    className="flex min-w-0 items-center gap-3 outline-none after:absolute after:inset-0 focus-visible:after:outline-1 focus-visible:after:-outline-offset-1 focus-visible:after:outline-accent"
                  >
                    <MerchantLogo name={p.name} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span className={cn("truncate", p.archived && "text-muted")}>{p.name}</span>
                        {p.archived && <Badge tone="muted">Archivée</Badge>}
                      </span>
                      {p.notes && <span className="truncate text-xs text-muted">{p.notes}</span>}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums max-sm:hidden">
                  {p.openClaims || <span className="text-muted">—</span>}
                </TableCell>
                <TableCell className="text-muted max-md:hidden">
                  {p.lastExpenseOn ? formatDateFr(p.lastExpenseOn) : "—"}
                </TableCell>
                <TableCell className="text-right max-md:hidden">
                  <Amount cents={p.reimbursedCents} className="text-muted" />
                </TableCell>
                <TableCell className="text-right">
                  <Amount
                    cents={p.pendingCents}
                    className={p.pendingCents > 0 ? "text-warning" : "text-muted"}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-20 w-full" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}
