import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { OccurrenceCalendar } from "@/components/recurring/occurrence-calendar";
import { OccurrenceDialogProvider } from "@/components/recurring/occurrence-dialog";
import { ResteAVivreStrip } from "@/components/recurring/reste-a-vivre";
import { NewRuleButton, RuleDialogProvider } from "@/components/recurring/rule-dialog";
import { RuleList } from "@/components/recurring/rule-list";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
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
import { GENERATION_HORIZON_MONTHS } from "@/lib/domain/recurrence";
import { listAccountsWithBalance } from "@/lib/server/accounts";
import {
  generateOccurrences,
  generationLimit,
  getResteAVivre,
  listOccurrences,
  listRules,
} from "@/lib/server/recurring";
import { cn } from "@/lib/utils";

export default function RecurringPage({ searchParams }: PageProps<"/recurrent">) {
  return (
    <Suspense fallback={<RecurringSkeleton />}>
      <Recurring searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function Recurring({ searchParams }: Pick<PageProps<"/recurrent">, "searchParams">) {
  const user = await requireUser();
  const params = await searchParams;
  const view = first(params.vue) === "regles" ? "regles" : "calendrier";
  const today = toParisDateString(new Date());
  const now = parseMonthKey(today.slice(0, 7))!;
  // Le calendrier ne va pas plus loin que la génération des échéances (ADR-024).
  const last = shiftMonth(now.year, now.month, GENERATION_HORIZON_MONTHS);
  let month = parseMonthKey(first(params.mois)) ?? now;
  if (month.year * 12 + month.month > last.year * 12 + last.month) month = last;
  const bounds = monthBounds(month.year, month.month);
  const currentEnd = monthBounds(now.year, now.month).to;

  // Génération paresseuse et idempotente des échéances jusqu'au mois affiché.
  await generateOccurrences(
    user.id,
    generationLimit(bounds.to > currentEnd ? bounds.to : currentEnd, today),
  );
  const isCurrent = month.year === now.year && month.month === now.month;
  const [occurrences, rules, accounts] = await Promise.all([
    listOccurrences(user.id, bounds),
    listRules(user.id, today),
    listAccountsWithBalance(user.id),
  ]);
  // Comptes et échéances du mois en cours déjà chargés : réutilisés pour le reste à vivre.
  const rav = await getResteAVivre(user.id, today, undefined, {
    accounts,
    monthOccurrences: isCurrent ? occurrences : undefined,
  });

  const prev = shiftMonth(month.year, month.month, -1);
  const next = shiftMonth(month.year, month.month, 1);
  const isLast = month.year === last.year && month.month === last.month;

  return (
    <RuleDialogProvider>
      <OccurrenceDialogProvider
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        today={today}
      >
        <PageHeader
          title="Récurrent"
          description="Revenus, charges fixes, abonnements et épargne : échéances prévues, à valider."
          actions={<NewRuleButton />}
        />

        <section aria-label="Reste à vivre du mois en cours" className="mb-6">
          <ResteAVivreStrip rav={rav} />
        </section>

        <nav aria-label="Vue" className="mb-4 flex gap-1 border-b border-border">
          <ViewLink href="/recurrent" active={view === "calendrier"}>
            Calendrier
          </ViewLink>
          <ViewLink href="/recurrent?vue=regles" active={view === "regles"}>
            Règles ({rules.length})
          </ViewLink>
        </nav>

        {rules.length === 0 ? (
          <Card>
            <EmptyState
              icon={CalendarClock}
              title="Aucune règle récurrente."
              description="Ajoutez votre salaire, votre loyer ou un abonnement : chaque échéance apparaîtra au calendrier et dans le reste à vivre."
              action={<NewRuleButton label="Ajouter une règle" />}
            />
          </Card>
        ) : view === "regles" ? (
          <RuleList rules={rules} />
        ) : (
          <>
            <nav aria-label="Mois affiché" className="mb-3 flex items-center gap-1">
              <MonthLink month={prev} label="Mois précédent">
                <ChevronLeft className="size-4" aria-hidden />
              </MonthLink>
              <h2 className="min-w-36 text-center text-md font-medium">
                {capitalize(formatMonthFr(month.year, month.month))}
              </h2>
              {isLast ? (
                <span className="size-8 pointer-coarse:size-11" aria-hidden />
              ) : (
                <MonthLink month={next} label="Mois suivant">
                  <ChevronRight className="size-4" aria-hidden />
                </MonthLink>
              )}
              {!isCurrent && (
                <Link
                  href="/recurrent"
                  className="ml-2 text-sm text-muted underline-offset-4 hover:text-text hover:underline"
                >
                  Mois en cours
                </Link>
              )}
            </nav>
            <Card className="overflow-hidden">
              {occurrences.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted lg:hidden">
                  Aucune échéance ce mois-ci.
                </p>
              ) : null}
              <OccurrenceCalendar month={month} occurrences={occurrences} today={today} />
            </Card>
          </>
        )}
      </OccurrenceDialogProvider>
    </RuleDialogProvider>
  );
}

function ViewLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px flex h-9 items-center border-b px-3 text-sm pointer-coarse:h-11",
        active
          ? "border-text font-medium text-text"
          : "border-transparent text-muted hover:text-text",
      )}
    >
      {children}
    </Link>
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
      href={`/recurrent?mois=${formatMonthKey(month)}`}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
    >
      {children}
    </Link>
  );
}

function RecurringSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
