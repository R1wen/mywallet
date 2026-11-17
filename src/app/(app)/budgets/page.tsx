import { ChevronLeft, ChevronRight, PiggyBank, Target } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArchiveGoalButton,
  BudgetDialog,
  ContributionDialog,
  DeleteBudgetButton,
  GoalDialog,
  type CategoryOption,
} from "@/components/budgets/budget-dialogs";
import { PageHeader } from "@/components/shell/app-shell";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { type BudgetLevel } from "@/lib/domain/budgets";
import {
  formatDateFr,
  formatMonthFr,
  formatMonthKey,
  parseMonthKey,
  shiftMonth,
  toParisDateString,
  type MonthKey,
} from "@/lib/domain/dates";
import { listAccounts } from "@/lib/server/accounts";
import { listBudgets, listGoals, type BudgetView, type GoalView } from "@/lib/server/budgets";
import { listCategories } from "@/lib/server/categories";
import { cn } from "@/lib/utils";

export default function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  return (
    <>
      <PageHeader
        title="Budgets et objectifs"
        description="Enveloppes sur ma dépense réelle, sans report d'un mois à l'autre."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Budgets searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const BAR: Record<BudgetLevel, string> = {
  ok: "bg-muted",
  warning: "bg-warning",
  over: "bg-danger",
};

function BudgetRow({ b, categories }: { b: BudgetView; categories: CategoryOption[] }) {
  const fill = Math.min(100, Math.max(0, (b.spentCents / b.amountCents) * 100));
  const pace =
    b.expectedCents !== null ? Math.min(100, (b.expectedCents / b.amountCents) * 100) : null;
  const ahead = b.expectedCents !== null && b.spentCents > b.expectedCents;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-base font-medium">{b.name}</span>
          {b.period === "yearly" && <Badge tone="muted">Annuel</Badge>}
          {b.status.level === "warning" && <Badge tone="warning">Seuil atteint</Badge>}
          {b.status.level === "over" && <Badge tone="muted">Dépassé</Badge>}
        </span>
        <span className="order-last basis-full text-base whitespace-nowrap sm:order-none sm:basis-auto">
          <Amount cents={b.spentCents} /> <span className="text-muted">sur</span>{" "}
          <Amount cents={b.amountCents} className="text-muted" />
        </span>
        <span className="flex shrink-0">
          <BudgetDialog
            budget={{
              id: b.id,
              categoryId: b.categoryId,
              period: b.period,
              amountCents: b.amountCents,
              alertPercent: b.alertPercent,
            }}
            categories={categories}
            name={b.name}
          />
          <DeleteBudgetButton id={b.id} name={b.name} />
        </span>
      </div>
      <div
        className="relative h-1.5 rounded-full bg-surface-2"
        role="meter"
        aria-label={`Budget ${b.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(b.status.percent, 100)}
        aria-valuetext={`${b.status.percent} % dépensé`}
      >
        <div
          className={cn("h-full rounded-full", BAR[b.status.level])}
          style={{ width: `${fill}%` }}
        />
        {pace !== null && (
          <span
            aria-hidden
            title="Dépense attendue à ce jour"
            className="absolute -top-1 h-3.5 w-px bg-text"
            style={{ left: `${pace}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted">
        <span>
          {b.status.percent} % · alerte à {b.alertPercent} %
          {pace !== null && (ahead ? " · plus vite que prévu" : " · dans le rythme")}
        </span>
        <span className={b.status.remainingCents < 0 ? "text-danger" : undefined}>
          {b.status.remainingCents < 0 ? "Dépassé de " : "Reste "}
          <Amount
            cents={Math.abs(b.status.remainingCents)}
            className={b.status.remainingCents < 0 ? "text-danger" : "text-muted"}
          />
        </span>
      </div>
    </li>
  );
}

function GoalCard({ g, accounts }: { g: GoalView; accounts: { id: string; name: string }[] }) {
  const p = g.progress;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-medium">{g.name}</span>
          {p.achieved && <Badge tone="accent">Atteint</Badge>}
          {p.late && <Badge tone="warning">En retard</Badge>}
        </span>
        <span className="text-base whitespace-nowrap">
          <Amount cents={g.savedCents} /> <span className="text-muted">sur</span>{" "}
          <Amount cents={g.targetCents} className="text-muted" />
        </span>
      </div>
      <div
        className="h-1.5 rounded-full bg-surface-2"
        role="meter"
        aria-label={`Objectif ${g.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.percent}
        aria-valuetext={`${p.percent} %`}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${p.percent}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {p.percent} %{g.targetDate && ` · pour le ${formatDateFr(g.targetDate)}`}
          {g.accountName ? ` · solde de ${g.accountName}` : " · suivi à la main"}
        </span>
        {p.monthlyNeededCents !== null && (
          <span>
            <Amount cents={p.monthlyNeededCents} className="text-muted" />
            {p.late ? " restant" : " par mois"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {!g.accountId && <ContributionDialog goal={{ id: g.id, name: g.name }} />}
        <GoalDialog
          goal={{
            id: g.id,
            name: g.name,
            targetCents: g.targetCents,
            targetDate: g.targetDate,
            accountId: g.accountId,
          }}
          accounts={accounts}
        />
        <ArchiveGoalButton id={g.id} name={g.name} />
      </div>
    </li>
  );
}

function currentMonth(today: string): MonthKey {
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

async function Budgets({ searchParams }: Pick<PageProps<"/budgets">, "searchParams">) {
  const user = await requireUser();
  const today = toParisDateString(new Date());
  const params = await searchParams;
  const raw = Array.isArray(params.mois) ? params.mois[0] : params.mois;
  const month = parseMonthKey(raw) ?? currentMonth(today);
  const isCurrent = formatMonthKey(month) === formatMonthKey(currentMonth(today));
  const day = isCurrent ? today : `${formatMonthKey(month)}-01`;

  const [budgets, goals, categories, accounts] = await Promise.all([
    listBudgets(user.id, day, today),
    listGoals(user.id, today),
    listCategories(user.id),
    listAccounts(user.id),
  ]);
  const categoryOptions = categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({ id: c.id, parentId: c.parentId, name: c.name }));
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const prev = shiftMonth(month.year, month.month, -1);
  const next = shiftMonth(month.year, month.month, 1);
  const navLink =
    "flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader className="flex-wrap">
          <div className="flex items-center gap-1">
            <Link
              href={`/budgets?mois=${formatMonthKey(prev)}`}
              aria-label="Mois précédent"
              className={navLink}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <CardTitle className="min-w-32 text-center capitalize">
              {formatMonthFr(month.year, month.month)}
            </CardTitle>
            <Link
              href={`/budgets?mois=${formatMonthKey(next)}`}
              aria-label="Mois suivant"
              className={navLink}
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <BudgetDialog categories={categoryOptions} />
        </CardHeader>
        {budgets.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Aucun budget sur cette période."
            description="Fixez une enveloppe par catégorie : vous êtes prévenu au seuil choisi."
            action={<BudgetDialog categories={categoryOptions} />}
          />
        ) : (
          <ul role="list" className="divide-y divide-border">
            {budgets.map((b) => (
              <BudgetRow key={b.id} b={b} categories={categoryOptions} />
            ))}
          </ul>
        )}
        {!isCurrent && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            <Link href="/budgets" className="underline-offset-4 hover:underline">
              Revenir au mois en cours
            </Link>
          </p>
        )}
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader className="flex-wrap">
          <CardTitle>Objectifs d&apos;épargne</CardTitle>
          <GoalDialog accounts={accountOptions} />
        </CardHeader>
        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Aucun objectif pour l'instant."
            description="Un montant et une date : l'effort mensuel est calculé pour vous."
          />
        ) : (
          <ul role="list" className="divide-y divide-border">
            {goals.map((g) => (
              <GoalCard key={g.id} g={g} accounts={accountOptions} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
