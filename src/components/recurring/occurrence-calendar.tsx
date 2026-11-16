import { Check } from "lucide-react";
import { Amount } from "@/components/ui/amount";
import { daysInMonth, formatDateFr, type MonthKey } from "@/lib/domain/dates";
import type { OccurrenceRow } from "@/lib/server/recurring";
import { cn } from "@/lib/utils";
import { OccurrenceButton } from "./occurrence-dialog";
import { OccurrenceBadge, RecurringLogo } from "./recurring-visuals";

const WEEKDAYS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];

const pad = (n: number) => String(n).padStart(2, "0");

function displayed(o: OccurrenceRow) {
  return o.status === "confirmed" && o.actualCents !== null ? o.actualCents : o.amountCents;
}

/** Month grid (large screens) and agenda list (small screens) of a month's occurrences. */
export function OccurrenceCalendar({
  month,
  occurrences,
  today,
}: {
  month: MonthKey;
  occurrences: OccurrenceRow[];
  today: string;
}) {
  const byDay = new Map<string, OccurrenceRow[]>();
  for (const o of occurrences) byDay.set(o.dueOn, [...(byDay.get(o.dueOn) ?? []), o]);

  const length = daysInMonth(month.year, month.month);
  const offset = (new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length }, (_, i) => `${month.year}-${pad(month.month)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <>
      <div className="max-lg:hidden">
        <div className="grid grid-cols-7 border-b border-border text-xs text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {cells.map((day, i) =>
            day === null ? (
              <div key={`blank-${i}`} className="min-h-28 bg-bg" aria-hidden />
            ) : (
              <div
                key={day}
                className={cn(
                  "flex min-h-28 flex-col gap-1 bg-surface p-1.5",
                  day === today && "bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "px-1 text-xs tabular-nums",
                    day === today ? "font-semibold text-text" : "text-muted",
                  )}
                >
                  {Number(day.slice(8, 10))}
                  {day === today && <span className="sr-only"> (aujourd&apos;hui)</span>}
                </span>
                {(byDay.get(day) ?? []).map((o) => (
                  <OccurrenceButton
                    key={o.id}
                    occurrence={o}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-sm border px-1.5 py-1 text-left text-xs transition-colors duration-[var(--duration-fast)] hover:bg-surface-2",
                      o.status === "planned" && o.dueOn < today
                        ? "border-warning/40"
                        : "border-border",
                      o.status !== "planned" && "text-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex w-full items-center gap-1 truncate",
                        o.status === "skipped" && "line-through",
                      )}
                    >
                      {o.status === "confirmed" && (
                        <Check className="size-3 shrink-0" aria-label="Validée" />
                      )}
                      <span className="truncate">{o.label}</span>
                    </span>
                    <Amount
                      cents={displayed(o)}
                      variant={o.kind === "transfer" || o.status !== "planned" ? "plain" : "flow"}
                      className="text-xs"
                    />
                  </OccurrenceButton>
                ))}
              </div>
            ),
          )}
        </div>
      </div>

      <div className="lg:hidden">
        {occurrences.length === 0 ? null : (
          <ul>
            {[...byDay.entries()].map(([day, rows]) => (
              <li key={day} className="border-b border-border last:border-0">
                <p
                  className={cn(
                    "px-4 pt-3 pb-1 text-xs",
                    day === today ? "font-medium text-text" : "text-muted",
                  )}
                >
                  {day === today ? "Aujourd'hui · " : ""}
                  {formatDateFr(day, "long")}
                </p>
                <ul>
                  {rows.map((o) => (
                    <li key={o.id}>
                      <OccurrenceButton
                        occurrence={o}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2"
                      >
                        <RecurringLogo
                          kind={o.kind}
                          label={o.label}
                          merchantId={o.merchantId}
                          merchantName={o.merchantName}
                          merchantLogo={o.merchantLogo}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              "truncate text-base",
                              o.status === "skipped" && "text-muted line-through",
                            )}
                          >
                            {o.label}
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted">
                            <OccurrenceBadge status={o.status} dueOn={o.dueOn} today={today} />
                            <span className="truncate">{o.accountName}</span>
                          </span>
                        </span>
                        <Amount
                          cents={displayed(o)}
                          variant={o.kind === "transfer" ? "plain" : "flow"}
                        />
                      </OccurrenceButton>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
