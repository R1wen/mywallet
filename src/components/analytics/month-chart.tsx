"use client";

import { useState } from "react";
import { Amount } from "@/components/ui/amount";
import { cn } from "@/lib/utils";

export type ChartPoint = { month: string; label: string; spentCents: number; incomeCents: number };

const short = (label: string) => label.slice(0, 4).replace(/\.$/, "");

/**
 * "Ma dépense réelle" month by month (dataviz: one series, magnitude -> bars from a zero
 * baseline; the accent marks the viewed month, the others stay grey; a dashed line shows
 * the average). Hover or focus a month for its figures; the table is the accessible view.
 */
export function MonthChart({ points, current }: { points: ChartPoint[]; current: string }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...points.map((p) => p.spentCents));
  const filled = points.filter((p) => p.spentCents > 0);
  const average = filled.length
    ? Math.round(filled.reduce((s, p) => s + p.spentCents, 0) / filled.length)
    : 0;
  const shown = points.find((p) => p.month === (active ?? current)) ?? points[points.length - 1]!;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-muted capitalize">{shown.label}</span>
        <span className="flex gap-4">
          <span>
            <span className="text-muted">Dépenses </span>
            <Amount cents={shown.spentCents} />
          </span>
          <span>
            <span className="text-muted">Revenus </span>
            <Amount cents={shown.incomeCents} />
          </span>
        </span>
      </div>
      <div className="relative h-40" aria-hidden>
        {average > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted/60"
            style={{ bottom: `${(average / max) * 100}%` }}
          >
            <span className="absolute -top-4 right-0 bg-surface pl-1 text-xs text-muted">
              moyenne
            </span>
          </div>
        )}
        <div className="flex h-full items-end gap-[2px] border-b border-border">
          {points.map((p) => (
            <div
              key={p.month}
              className="group flex h-full flex-1 cursor-default items-end"
              onMouseEnter={() => setActive(p.month)}
              onMouseLeave={() => setActive(null)}
            >
              <div
                className={cn(
                  "w-full rounded-t-[4px] transition-opacity duration-[var(--duration-fast)]",
                  p.month === current ? "bg-accent" : "bg-muted/45",
                  active && active !== p.month && "opacity-60",
                )}
                style={{
                  height: `${Math.max(p.spentCents > 0 ? 2 : 0, (p.spentCents / max) * 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-[2px] text-xs text-muted" aria-hidden>
        {points.map((p, i) => (
          <span
            key={p.month}
            className={cn(
              "flex-1 truncate text-center capitalize",
              i % 2 === 1 && i !== points.length - 1 && "max-sm:invisible",
            )}
          >
            {short(p.label)}
          </span>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-text pointer-coarse:min-h-11 pointer-coarse:py-3">
          Voir le tableau
        </summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Dépenses et revenus par mois</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 font-normal">Mois</th>
              <th className="py-1 text-right font-normal">Dépenses</th>
              <th className="py-1 text-right font-normal">Revenus</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {points.map((p) => (
              <tr key={p.month}>
                <td className="py-1.5 capitalize">{p.label}</td>
                <td className="py-1.5 text-right">
                  <Amount cents={p.spentCents} />
                </td>
                <td className="py-1.5 text-right">
                  <Amount cents={p.incomeCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
