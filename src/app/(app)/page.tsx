import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { OccurrenceDialogProvider } from "@/components/recurring/occurrence-dialog";
import { UpcomingCard } from "@/components/recurring/upcoming-card";
import { PageHeader } from "@/components/shell/app-shell";
import { NewTransactionButton } from "@/components/transactions/transaction-dialog";
import { TransactionRows } from "@/components/transactions/transaction-rows";
import { Amount } from "@/components/ui/amount";
import { Badge, ClaimBadge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import {
  formatMonthFr,
  formatMonthKey,
  monthBounds,
  parseMonthKey,
  shiftMonth,
  toParisDateString,
  type MonthKey,
} from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import { listDeadlines } from "@/lib/server/analytics";
import { budgetAlerts } from "@/lib/server/budgets";
import { getMonthDashboard } from "@/lib/server/dashboard";
import { generateOccurrences, getResteAVivre } from "@/lib/server/recurring";
import { cn } from "@/lib/utils";

export default function DashboardPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

function currentMonth(): MonthKey {
  return parseMonthKey(toParisDateString(new Date()).slice(0, 7))!;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const user = await requireUser();
  const params = await searchParams;
  const raw = Array.isArray(params.mois) ? params.mois[0] : params.mois;
  const now = currentMonth();
  const month = parseMonthKey(raw) ?? now;
  const today = toParisDateString(new Date());
  const isCurrentMonth = month.year === now.year && month.month === now.month;
  // Reste à vivre : seulement sur le mois en cours, avec les soldes déjà calculés.
  if (isCurrentMonth) await generateOccurrences(user.id, monthBounds(now.year, now.month).to);
  const d = await getMonthDashboard(user.id, month);
  const [rav, alerts, deadlines] = isCurrentMonth
    ? await Promise.all([
        getResteAVivre(user.id, today, undefined, { accounts: d.accounts }),
        budgetAlerts(user.id, today),
        listDeadlines(user.id, today),
      ])
    : [null, [], []];
  // Early in the month, the report of the month that just ended (ADR-041).
  const lastMonth = shiftMonth(now.year, now.month, -1);
  const reportReady = isCurrentMonth && Number(today.slice(8, 10)) <= 7;
  const prev = shiftMonth(month.year, month.month, -1);
  const next = shiftMonth(month.year, month.month, 1);
  const isCurrent = month.year === now.year && month.month === now.month;
  const monthLabel = capitalize(formatMonthFr(month.year, month.month));
  const bounds = monthBounds(month.year, month.month);
  const topMax = Math.max(1, ...d.topCategories.map((c) => c.spentCents));

  return (
    <OccurrenceDialogProvider
      accounts={d.accounts.map((a) => ({ id: a.id, name: a.name }))}
      today={today}
    >
      <PageHeader title="Tableau de bord" actions={<NewTransactionButton />} />

      <nav aria-label="Mois affiché" className="mb-4 flex items-center gap-1">
        <MonthLink month={prev} label="Mois précédent">
          <ChevronLeft className="size-4" aria-hidden />
        </MonthLink>
        <h2 className="min-w-36 text-center text-md font-medium">{monthLabel}</h2>
        {isCurrent ? (
          <span className="size-8 pointer-coarse:size-11" aria-hidden />
        ) : (
          <MonthLink month={next} label="Mois suivant">
            <ChevronRight className="size-4" aria-hidden />
          </MonthLink>
        )}
        {!isCurrent && (
          <Link
            href="/"
            className="ml-2 text-sm text-muted underline-offset-4 hover:text-text hover:underline"
          >
            Revenir au mois en cours
          </Link>
        )}
      </nav>

      {alerts.length > 0 && (
        <div
          role="status"
          className={cn(
            "mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-4 py-2.5 text-sm",
            alerts.some((a) => a.status.level === "over")
              ? "border-danger/40"
              : "border-warning/40",
          )}
        >
          <span className="font-medium">Budgets</span>
          {alerts.map((a) => (
            <span key={a.id} className={a.status.level === "over" ? "text-danger" : "text-warning"}>
              {a.name} {a.status.percent} %{a.status.level === "over" ? " (dépassé)" : ""}
            </span>
          ))}
          <Link
            href="/budgets"
            className="ml-auto text-muted underline-offset-4 hover:text-text hover:underline"
          >
            Voir les budgets
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        <Stat label="Solde total" hint="Tous comptes, aujourd'hui">
          <Amount cents={d.totalBalanceCents} />
        </Stat>
        <Stat label="Entrées" hint="Revenus du mois">
          <Amount cents={d.flows.incomeCents} variant={d.flows.incomeCents ? "flow" : "plain"} />
        </Stat>
        <Stat
          label="Dépenses"
          hint={
            d.flows.sharedCents
              ? `Ma part : hors ${formatCents(d.flows.sharedCents)} dus par d'autres`
              : "Achats moins avoirs"
          }
        >
          <Amount cents={-d.flows.spentCents} variant={d.flows.spentCents ? "flow" : "plain"} />
        </Stat>
        <Stat label="Solde du mois" hint="Hors virements internes">
          <Amount cents={d.flows.netCents} variant="flow" />
        </Stat>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          {rav && <UpcomingCard rav={rav} today={today} />}
          {reportReady && (
            <Link
              href={`/analyses/rapport?mois=${formatMonthKey(lastMonth)}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-base hover:bg-surface-2"
            >
              <span>
                Rapport de {formatMonthFr(lastMonth.year, lastMonth.month)}
                <span className="block text-xs text-muted">
                  Faits marquants, budgets, abonnements
                </span>
              </span>
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          )}
          {deadlines.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Retours et garanties</CardTitle>
                <Link href="/analyses" className="text-sm text-muted hover:text-text">
                  Analyses
                </Link>
              </CardHeader>
              <ul className="px-4 pt-1 pb-2">
                {deadlines.slice(0, 3).map((dl) => (
                  <li
                    key={`${dl.id}-${dl.kind}`}
                    className="flex min-h-11 items-center justify-between gap-3 border-b border-border last:border-0"
                  >
                    <Link
                      href={`/tickets/${dl.id}`}
                      className="min-w-0 truncate text-base underline-offset-4 hover:underline"
                    >
                      {dl.kind === "return" ? "Retour" : "Garantie"} · {dl.label}
                    </Link>
                    <Badge tone={dl.kind === "return" ? "warning" : "muted"}>
                      {dl.daysLeft === 0 ? "Aujourd'hui" : `${dl.daysLeft} j`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.receivables.pendingCents > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>À récupérer</CardTitle>
                <Link href="/personnes" className="text-sm text-muted hover:text-text">
                  Personnes
                </Link>
              </CardHeader>
              <div className="flex items-baseline justify-between gap-3 px-4 pt-1">
                <ClaimBadge status="pending" />
                <Amount cents={d.receivables.pendingCents} className="text-lg font-medium" />
              </div>
              <ul className="px-4 pt-1 pb-2">
                {d.receivables.people.map((p) => (
                  <li
                    key={p.id}
                    className="flex h-11 items-center justify-between gap-3 border-b border-border last:border-0"
                  >
                    <Link
                      href={`/personnes/${p.id}`}
                      className="truncate text-base underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <Amount cents={p.pendingCents} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Dépenses par catégorie</CardTitle>
            </CardHeader>
            {d.topCategories.length === 0 ? (
              <p className="px-4 pt-2 pb-4 text-sm text-muted">Aucune dépense ce mois-ci.</p>
            ) : (
              <ul className="flex flex-col gap-3 px-4 pt-2 pb-4">
                {d.topCategories.map((c) => (
                  <li key={c.id ?? "none"} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{c.name}</span>
                      <Amount cents={c.spentCents} className="text-sm" />
                    </div>
                    <div className="h-1 rounded-full bg-surface-2" aria-hidden>
                      <div
                        className={cn(
                          "h-full rounded-full",
                          c.id === d.topCategories[0]?.id ? "bg-accent" : "bg-muted/50",
                        )}
                        style={{ width: `${Math.max(2, (c.spentCents / topMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comptes</CardTitle>
              <Link href="/reglages" className="text-sm text-muted hover:text-text">
                Gérer
              </Link>
            </CardHeader>
            <ul className="px-4 pt-1 pb-2">
              {d.accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex h-11 items-center justify-between gap-3 border-b border-border last:border-0"
                >
                  <Link
                    href={`/transactions?compte=${a.id}`}
                    className="truncate text-base underline-offset-4 hover:underline"
                  >
                    {a.name}
                  </Link>
                  <Amount cents={a.balanceCents} />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Derniers mouvements</CardTitle>
            <Link
              href={`/transactions?du=${bounds.from}&au=${bounds.to}`}
              className="text-sm text-muted hover:text-text"
            >
              Tout voir
            </Link>
          </CardHeader>
          {d.recent.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="Aucun mouvement ce mois-ci."
              description="Ajoutez une dépense ou une entrée : le tableau de bord se met à jour aussitôt."
              action={<NewTransactionButton label="Ajouter un mouvement" />}
            />
          ) : (
            <TransactionRows rows={d.recent} compact />
          )}
        </Card>
      </div>
    </OccurrenceDialogProvider>
  );
}

function MonthLink({
  month,
  label,
  children,
}: {
  month: MonthKey;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/?mois=${formatMonthKey(month)}`}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
    >
      {children}
    </Link>
  );
}

function Stat({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-lg font-medium tracking-[-0.01em] [&_[data-amount]]:text-lg max-sm:[&_[data-amount]]:text-md">
        {children}
      </span>
      <span className="text-xs text-muted max-sm:hidden">{hint}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64 lg:col-span-2" />
      </div>
    </div>
  );
}
