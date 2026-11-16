import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  MerchantDetailsForm,
  MerchantLogoForm,
  MerchantMergeForm,
} from "@/components/merchants/merchant-editor";
import { TransactionRows } from "@/components/transactions/transaction-rows";
import { Amount } from "@/components/ui/amount";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MerchantLogo } from "@/components/ui/merchant-logo";
import { merchantLogoProps } from "@/components/ui/merchant-logo-props";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { formatDateFr } from "@/lib/domain/dates";
import { listCategories } from "@/lib/server/categories";
import { getMerchant, listMerchantNames } from "@/lib/server/merchants";
import { listTransactions } from "@/lib/server/transactions";
import { idSchema } from "@/lib/validation/settings";
import { parseTransactionFilters } from "@/lib/validation/transaction";

export default function MerchantPage({ params }: PageProps<"/magasins/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <MerchantDetail params={params} />
    </Suspense>
  );
}

async function MerchantDetail({ params }: Pick<PageProps<"/magasins/[id]">, "params">) {
  const user = await requireUser();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const [merchant, categories, names, recent] = await Promise.all([
    getMerchant(user.id, id.data),
    listCategories(user.id),
    listMerchantNames(user.id),
    listTransactions(user.id, parseTransactionFilters({ marchand: id.data })),
  ]);
  if (!merchant) notFound();

  return (
    <>
      <Link
        href="/magasins"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text pointer-coarse:min-h-11"
      >
        <ChevronLeft className="size-4" aria-hidden /> Magasins
      </Link>
      <div className="mb-6 flex items-center gap-4">
        <MerchantLogo {...merchantLogoProps(merchant)} size={48} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">{merchant.name}</h1>
          <p className="truncate text-base text-muted">
            {[merchant.categoryName, merchant.domain].filter(Boolean).join(" · ") ||
              "Sans catégorie"}
          </p>
        </div>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        <Stat label="Total dépensé">
          <Amount cents={merchant.spentCents} />
        </Stat>
        <Stat label="Achats">
          <span className="font-mono tabular-nums">{merchant.purchaseCount}</span>
        </Stat>
        <Stat label="Panier moyen">
          {merchant.purchaseCount ? (
            <Amount cents={merchant.averageCents} />
          ) : (
            <span className="text-muted">—</span>
          )}
        </Stat>
        <Stat label="Dernier achat">
          {merchant.lastPurchaseOn ? (
            formatDateFr(merchant.lastPurchaseOn)
          ) : (
            <span className="text-muted">—</span>
          )}
        </Stat>
      </dl>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Mouvements</CardTitle>
            {recent.total > recent.rows.length && (
              <Link
                href={`/transactions?marchand=${merchant.id}`}
                className="text-sm text-muted hover:text-text"
              >
                Tout voir ({recent.total})
              </Link>
            )}
          </CardHeader>
          {recent.rows.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="Aucun mouvement chez ce magasin pour l'instant."
            />
          ) : (
            <TransactionRows rows={recent.rows.slice(0, 20)} compact />
          )}
        </Card>
        <div className="flex flex-col gap-4">
          <MerchantDetailsForm
            key={merchant.logoVersion}
            merchant={merchant}
            categories={categories.filter((c) => c.kind === "expense")}
          />
          <MerchantLogoForm merchantId={merchant.id} logoSource={merchant.logoSource} />
          <MerchantMergeForm
            merchantId={merchant.id}
            merchantName={merchant.name}
            others={names.filter((n) => n.id !== merchant.id)}
          />
        </div>
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-md font-medium">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
