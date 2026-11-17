import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MonthChart } from "@/components/analytics/month-chart";
import { AskBox, Simulator, SubscriptionActions } from "@/components/analytics/analytics-client";
import { PageHeader } from "@/components/shell/app-shell";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import {
  formatDateFr,
  formatMonthFr,
  formatMonthKey,
  parseMonthKey,
  shiftMonth,
  toParisDateString,
  type MonthKey,
} from "@/lib/domain/dates";
import {
  categoryComparison,
  getForecast,
  listAnomalies,
  listDeadlines,
  listSubscriptions,
  monthlySeries,
  simulationBaseline,
} from "@/lib/server/analytics";
import { questionModel } from "@/lib/server/ask";

export default function AnalysesPage({ searchParams }: PageProps<"/analyses">) {
  return (
    <>
      <PageHeader
        title="Analyses"
        description="Tendances, abonnements, prévision et simulations sur ma dépense réelle."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Analyses searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const MODEL_NAMES = { ollama: "Ollama", gemini: "Gemini" } as const;

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-4 text-sm text-muted">{children}</p>;
}

async function Analyses({ searchParams }: Pick<PageProps<"/analyses">, "searchParams">) {
  const user = await requireUser();
  const today = toParisDateString(new Date());
  const now: MonthKey = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const params = await searchParams;
  const raw = Array.isArray(params.mois) ? params.mois[0] : params.mois;
  const month = parseMonthKey(raw) ?? now;
  const isCurrent = formatMonthKey(month) === formatMonthKey(now);

  const [series, comparison, subs, anomalies, deadlines, forecast, baseline, model] =
    await Promise.all([
      monthlySeries(user.id, month, 12),
      categoryComparison(user.id, month),
      listSubscriptions(user.id, today),
      listAnomalies(user.id, month),
      listDeadlines(user.id, today),
      isCurrent ? getForecast(user.id, today) : Promise.resolve(null),
      simulationBaseline(user.id, today),
      questionModel(user.id),
    ]);
  const prev = shiftMonth(month.year, month.month, -1);
  const next = shiftMonth(month.year, month.month, 1);
  const navLink =
    "flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11";
  const changes = comparison.filter((c) => c.currentCents > 0 || c.previousCents > 0).slice(0, 8);
  const untracked = subs.filter((s) => !s.tracked);
  const rising = subs.filter((s) => s.increase);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Mois" className="flex items-center gap-1">
          <Link
            href={`/analyses?mois=${formatMonthKey(prev)}`}
            aria-label="Mois précédent"
            className={navLink}
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-36 text-center text-md font-medium capitalize">
            {formatMonthFr(month.year, month.month)}
          </span>
          <Link
            href={`/analyses?mois=${formatMonthKey(next)}`}
            aria-label="Mois suivant"
            className={navLink}
          >
            <ChevronRight className="size-4" />
          </Link>
        </nav>
        <Link
          href={`/analyses/rapport?mois=${formatMonthKey(month)}`}
          className="inline-flex h-8 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-surface-2 pointer-coarse:h-11"
        >
          <FileText className="size-4" aria-hidden /> Rapport du mois
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Ma dépense, 12 derniers mois</CardTitle>
          </CardHeader>
          <div className="px-4 pt-2 pb-4">
            <MonthChart points={series} current={formatMonthKey(month)} />
          </div>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Fin de mois prévue</CardTitle>
          </CardHeader>
          {forecast ? (
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Amount cents={forecast.projectedCents} className="text-xl font-medium" />
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Solde disponible aujourd&apos;hui</dt>
                <dd className="text-right">
                  <Amount cents={forecast.balanceCents} />
                </dd>
                <dt className="text-muted">Échéances prévues</dt>
                <dd className="text-right">
                  <Amount cents={forecast.plannedNetCents} variant="flow" />
                </dd>
                <dt className="text-muted">
                  Dépenses courantes ({forecast.daysLeft} j ×{" "}
                  <Amount cents={forecast.dailyCents} className="text-muted" />)
                </dt>
                <dd className="text-right">
                  <Amount cents={-forecast.dailyCents * forecast.daysLeft} variant="flow" />
                </dd>
              </dl>
              <p className="text-xs text-muted">
                Comptes courants et espèces ; rythme habituel des trois derniers mois.
              </p>
            </div>
          ) : (
            <Empty>La prévision porte sur le mois en cours.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Par catégorie</CardTitle>
            <span className="text-xs text-muted">écart avec le mois précédent</span>
          </CardHeader>
          {changes.length === 0 ? (
            <Empty>Aucune dépense ce mois-ci ni le précédent.</Empty>
          ) : (
            <table className="w-full text-base">
              <caption className="sr-only">
                Dépenses par catégorie et écart avec le mois précédent
              </caption>
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-1.5 text-left font-normal">Catégorie</th>
                  <th className="px-2 py-1.5 text-right font-normal">Ce mois</th>
                  <th className="px-4 py-1.5 text-right font-normal">Écart</th>
                  <th className="px-4 py-1.5 text-right font-normal max-sm:hidden">
                    Moyenne 3 mois
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {changes.map((c) => (
                  <tr key={c.categoryId ?? "none"} className="h-11">
                    <td className="max-w-0 truncate px-4">{c.name}</td>
                    <td className="px-2 text-right">
                      <Amount cents={c.currentCents} />
                    </td>
                    <td className="px-4 text-right whitespace-nowrap text-muted">
                      <Amount cents={c.deltaCents} className="text-muted" />
                      {c.deltaPercent !== null && c.deltaCents !== 0 && (
                        <span className="ml-1 text-xs">
                          ({c.deltaPercent > 0 ? "+" : ""}
                          {c.deltaPercent} %)
                        </span>
                      )}
                    </td>
                    <td className="px-4 text-right max-sm:hidden">
                      <Amount cents={c.averageCents} className="text-muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Abonnements détectés</CardTitle>
            <span className="text-xs text-muted">{subs.length} au total</span>
          </CardHeader>
          {untracked.length === 0 && rising.length === 0 ? (
            <Empty>Aucun prélèvement régulier non suivi, aucune hausse de prix.</Empty>
          ) : (
            <ul role="list" className="divide-y divide-border">
              {[...untracked, ...rising.filter((s) => s.tracked)].map((s) => (
                <li
                  key={s.key}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:min-h-11"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-base">{s.name}</span>
                      {!s.tracked && <Badge tone="warning">Non suivi</Badge>}
                      {s.increase && <Badge tone="muted">En hausse</Badge>}
                    </span>
                    <span className="text-xs text-muted">
                      {s.increase ? (
                        <>
                          <Amount cents={s.increase.fromCents} className="text-muted" /> →{" "}
                          <Amount cents={s.increase.toCents} className="text-muted" /> depuis le{" "}
                          {formatDateFr(s.increase.sinceDate)}
                        </>
                      ) : (
                        <>
                          {s.count} prélèvements · prochain vers le {formatDateFr(s.nextDate)}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="text-base whitespace-nowrap">
                    <Amount cents={s.lastAmountCents} />{" "}
                    <span className="text-xs text-muted">/ mois</span>
                  </span>
                  {!s.tracked && <SubscriptionActions subKey={s.key} name={s.name} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Dépenses inhabituelles</CardTitle>
          </CardHeader>
          {anomalies.length === 0 ? (
            <Empty>Rien d&apos;inhabituel ce mois-ci.</Empty>
          ) : (
            <ul role="list" className="divide-y divide-border">
              {anomalies.map((a) => (
                <li key={a.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base">{a.label}</span>
                    <span className="text-xs text-muted">
                      {formatDateFr(a.date)} · {String(a.ratio).replace(".", ",")} fois une dépense
                      habituelle (<Amount cents={a.usualCents} className="text-muted" />)
                    </span>
                  </span>
                  <Amount cents={-a.amountCents} variant="flow" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Retours et garanties</CardTitle>
          </CardHeader>
          {deadlines.length === 0 ? (
            <Empty>Aucun retour ni garantie n&apos;arrive à échéance prochainement.</Empty>
          ) : (
            <ul role="list" className="divide-y divide-border">
              {deadlines.map((d) => (
                <li
                  key={`${d.id}-${d.kind}`}
                  className="flex min-h-11 items-center gap-3 px-4 py-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={`/tickets/${d.id}`}
                      className="truncate text-base underline-offset-4 hover:underline"
                    >
                      {d.label}
                    </Link>
                    <span className="text-xs text-muted">
                      {d.kind === "return" ? "Retour possible jusqu'au" : "Garantie jusqu'au"}{" "}
                      {formatDateFr(d.date)}
                    </span>
                  </span>
                  <Badge tone={d.kind === "return" ? "warning" : "muted"}>
                    {d.daysLeft === 0 ? "Aujourd'hui" : `${d.daysLeft} j`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Et si…</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {baseline.categories.length === 0 ? (
            <p className="text-sm text-muted">
              Il faut au moins un mois complet de dépenses pour simuler.
            </p>
          ) : (
            <Simulator baseline={baseline} />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Poser une question</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          <AskBox enabled={model !== null} modelName={model ? MODEL_NAMES[model] : null} />
        </div>
      </Card>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
