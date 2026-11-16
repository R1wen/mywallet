import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { NewTransactionButton } from "@/components/transactions/transaction-dialog";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionRows } from "@/components/transactions/transaction-rows";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { listAccounts } from "@/lib/server/accounts";
import { listCategories } from "@/lib/server/categories";
import { listTransactions } from "@/lib/server/transactions";
import { cn } from "@/lib/utils";
import {
  parseTransactionFilters,
  TX_SORTS,
  type TransactionFilters as Filters,
} from "@/lib/validation/transaction";

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <>
      <PageHeader title="Transactions" actions={<NewTransactionButton />} />
      <Card className="min-w-0">
        <Suspense fallback={<ListSkeleton />}>
          <TransactionsList searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

const SORT_LABELS: Record<(typeof TX_SORTS)[number], string> = {
  date: "Date",
  montant: "Montant",
  libelle: "Libellé",
};

function hrefWith(
  params: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null>,
) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) next.set(k, value);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  const s = next.toString();
  return s ? `/transactions?${s}` : "/transactions";
}

async function TransactionsList({
  searchParams,
}: Pick<PageProps<"/transactions">, "searchParams">) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = parseTransactionFilters(params);
  const [result, accounts, categories] = await Promise.all([
    listTransactions(user.id, filters),
    listAccounts(user.id),
    listCategories(user.id),
  ]);
  const filtered = Object.keys(params).some((k) => k !== "page" && k !== "tri" && k !== "ordre");

  return (
    <>
      <TransactionFilters
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm text-muted">
        <span aria-live="polite">
          {result.total} mouvement{result.total > 1 ? "s" : ""}
        </span>
        <SortLinks params={params} filters={filters} />
      </div>
      {result.rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={
            filtered
              ? "Aucun mouvement ne correspond à ces filtres."
              : "Aucun mouvement pour l'instant."
          }
          description={
            filtered
              ? "Élargissez la période ou effacez les filtres."
              : "Ajoutez votre première dépense : montant, magasin, Entrée."
          }
          action={filtered ? undefined : <NewTransactionButton label="Ajouter un mouvement" />}
        />
      ) : (
        <TransactionRows rows={result.rows} />
      )}
      {result.pageCount > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm"
        >
          <PageLink
            href={hrefWith(params, { page: String(result.page - 1) })}
            disabled={result.page <= 1}
          >
            Précédent
          </PageLink>
          <span className="text-muted">
            Page {result.page} sur {result.pageCount}
          </span>
          <PageLink
            href={hrefWith(params, { page: String(result.page + 1) })}
            disabled={result.page >= result.pageCount}
          >
            Suivant
          </PageLink>
        </nav>
      )}
    </>
  );
}

function SortLinks({
  params,
  filters,
}: {
  params: Record<string, string | string[] | undefined>;
  filters: Filters;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Trier par">
      <span className="mr-1">Trier par</span>
      {TX_SORTS.map((sort) => {
        const activeSort = filters.tri === sort;
        const nextOrder = activeSort && filters.ordre === "desc" ? "asc" : "desc";
        const Icon = filters.ordre === "asc" ? ArrowUp : ArrowDown;
        return (
          <Link
            key={sort}
            href={hrefWith(params, {
              tri: sort === "date" ? null : sort,
              ordre: nextOrder === "desc" ? null : nextOrder,
              page: null,
            })}
            aria-current={activeSort ? "true" : undefined}
            className={cn(
              "flex h-7 items-center gap-1 rounded-sm px-2 hover:bg-surface-2 hover:text-text pointer-coarse:h-11",
              activeSort && "text-text",
            )}
          >
            {SORT_LABELS[sort]}
            {activeSort && (
              <Icon
                className="size-3.5"
                aria-label={filters.ordre === "asc" ? "croissant" : "décroissant"}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls = "flex h-8 items-center rounded-sm px-3 pointer-coarse:h-11";
  return disabled ? (
    <span className={cn(cls, "text-subtle")} aria-disabled="true">
      {children}
    </span>
  ) : (
    <Link href={href} className={cn(cls, "text-muted hover:bg-surface-2 hover:text-text")}>
      {children}
    </Link>
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
