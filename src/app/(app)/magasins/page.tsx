import { Search, Store } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import { merchantLogoProps } from "@/components/ui/merchant-logo-props";
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
import { listMerchants } from "@/lib/server/merchants";
import { cn } from "@/lib/utils";
import { merchantFiltersSchema, type MerchantFilters } from "@/lib/validation/merchant";

export default function MerchantsPage({ searchParams }: PageProps<"/magasins">) {
  return (
    <>
      <PageHeader
        title="Magasins et sites"
        description="Total, nombre d'achats et panier moyen par enseigne."
      />
      <Card className="min-w-0">
        <Suspense fallback={<ListSkeleton />}>
          <MerchantList searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

const SORTS: { value: MerchantFilters["tri"]; label: string }[] = [
  { value: "depense", label: "Dépense" },
  { value: "achats", label: "Achats" },
  { value: "recent", label: "Récents" },
  { value: "nom", label: "Nom" },
];

function href(f: MerchantFilters, patch: Partial<MerchantFilters>) {
  const next = { ...f, ...patch };
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.tri !== "depense") p.set("tri", next.tri);
  if (next.vue !== "actifs") p.set("vue", next.vue);
  const s = p.toString();
  return s ? `/magasins?${s}` : "/magasins";
}

async function MerchantList({ searchParams }: Pick<PageProps<"/magasins">, "searchParams">) {
  const user = await requireUser();
  const filters = merchantFiltersSchema.parse(await searchParams);
  const rows = await listMerchants(user.id, filters);
  const chip = (active: boolean) =>
    cn(
      "flex h-7 items-center rounded-sm px-2 text-sm hover:bg-surface-2 hover:text-text pointer-coarse:h-11",
      active ? "bg-surface-2 text-text" : "text-muted",
    );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <form action="/magasins" className="relative min-w-48 flex-1" role="search">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={filters.q}
            placeholder="Rechercher un magasin ou un site…"
            aria-label="Rechercher un magasin"
            className="pl-8"
          />
          {filters.tri !== "depense" && <input type="hidden" name="tri" value={filters.tri} />}
          {filters.vue !== "actifs" && <input type="hidden" name="vue" value={filters.vue} />}
        </form>
        <div className="flex items-center gap-1" role="group" aria-label="Trier par">
          {SORTS.map((s) => (
            <Link
              key={s.value}
              href={href(filters, { tri: s.value })}
              className={chip(filters.tri === s.value)}
              aria-current={filters.tri === s.value ? "true" : undefined}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <div
          className="ml-1 flex items-center gap-1 border-l border-border pl-3"
          role="group"
          aria-label="Afficher"
        >
          <Link href={href(filters, { vue: "actifs" })} className={chip(filters.vue === "actifs")}>
            Avec achats
          </Link>
          <Link href={href(filters, { vue: "tous" })} className={chip(filters.vue === "tous")}>
            Tous
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Store}
          title={
            filters.q ? "Aucun magasin ne correspond." : "Aucun achat enregistré pour l'instant."
          }
          description={
            filters.q
              ? "Essayez un autre nom, ou affichez tous les magasins."
              : "Les magasins apparaissent ici dès votre première dépense."
          }
          action={
            filters.vue === "actifs" ? (
              <Link
                href={href(filters, { vue: "tous" })}
                className="text-sm text-accent underline-offset-4 hover:underline"
              >
                Voir tout l&apos;annuaire
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Magasin</TableHead>
              <TableHead className="max-md:hidden">Catégorie</TableHead>
              <TableHead className="text-right max-sm:hidden">Achats</TableHead>
              <TableHead className="text-right max-lg:hidden">Panier moyen</TableHead>
              <TableHead className="max-lg:hidden">Dernier achat</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id} className="relative">
                <TableCell className="w-full max-w-0">
                  <Link
                    href={`/magasins/${m.id}`}
                    className="flex min-w-0 items-center gap-3 outline-none after:absolute after:inset-0 focus-visible:after:outline-1 focus-visible:after:-outline-offset-1 focus-visible:after:outline-accent"
                  >
                    <MerchantLogo {...merchantLogoProps(m)} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{m.name}</span>
                      {m.domain && <span className="truncate text-xs text-muted">{m.domain}</span>}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className={cn("max-md:hidden", !m.categoryName && "text-muted")}>
                  {m.categoryName ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums max-sm:hidden">
                  {m.purchaseCount}
                </TableCell>
                <TableCell className="text-right max-lg:hidden">
                  {m.purchaseCount ? (
                    <Amount cents={m.averageCents} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted max-lg:hidden">
                  {m.lastPurchaseOn ? formatDateFr(m.lastPurchaseOn) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Amount cents={m.spentCents} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
