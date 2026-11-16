import Link from "next/link";
import { Amount } from "@/components/ui/amount";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { addDaysIso } from "@/lib/domain/recurrence";
import { formatDateFr } from "@/lib/domain/dates";
import type { ResteAVivreSummary } from "@/lib/server/recurring";
import { cn } from "@/lib/utils";
import { OccurrenceButton } from "./occurrence-dialog";
import { OccurrenceBadge, RecurringLogo } from "./recurring-visuals";

const UPCOMING_DAYS = 7;
const MAX_ROWS = 5;

/** Dashboard card: reste à vivre, daily amount, occurrences to validate soon. */
export function UpcomingCard({ rav, today }: { rav: ResteAVivreSummary; today: string }) {
  const limit = addDaysIso(today, UPCOMING_DAYS);
  const soon = rav.pending.filter((o) => o.dueOn <= limit);
  const shown = soon.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reste à vivre</CardTitle>
        <Link href="/recurrent" className="text-sm text-muted hover:text-text">
          Calendrier
        </Link>
      </CardHeader>
      <div className="flex items-end justify-between gap-3 px-4 pt-1 pb-3">
        <Amount
          cents={rav.resteCents}
          className={cn("text-xl", rav.resteCents < 0 && "text-danger")}
        />
        <span className="text-right text-sm text-muted">
          <Amount cents={rav.perDayCents} className="text-sm text-text" /> par jour
          <span className="block text-xs">
            {rav.daysLeft} jour{rav.daysLeft > 1 ? "s" : ""} restant{rav.daysLeft > 1 ? "s" : ""}
          </span>
        </span>
      </div>
      <div className="border-t border-border">
        {shown.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">Aucune échéance à valider cette semaine.</p>
        ) : (
          <ul>
            {shown.map((o) => (
              <li key={o.id} className="border-b border-border last:border-0">
                <OccurrenceButton
                  occurrence={o}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-surface-2"
                >
                  <RecurringLogo
                    size={28}
                    kind={o.kind}
                    label={o.label}
                    merchantId={o.merchantId}
                    merchantName={o.merchantName}
                    merchantLogo={o.merchantLogo}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{o.label}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <OccurrenceBadge status={o.status} dueOn={o.dueOn} today={today} />
                      {formatDateFr(o.dueOn)}
                    </span>
                  </span>
                  <Amount
                    cents={o.amountCents}
                    variant={o.kind === "transfer" ? "plain" : "flow"}
                    className="text-sm"
                  />
                </OccurrenceButton>
              </li>
            ))}
          </ul>
        )}
        {soon.length > shown.length && (
          <Link
            href="/recurrent"
            className="block border-t border-border px-4 py-2 text-sm text-muted hover:text-text"
          >
            {soon.length - shown.length} autre{soon.length - shown.length > 1 ? "s" : ""} à valider
          </Link>
        )}
      </div>
    </Card>
  );
}
