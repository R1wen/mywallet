import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PrintButton } from "@/components/analytics/print-button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { formatMonthKey, parseMonthKey, shiftMonth, toParisDateString } from "@/lib/domain/dates";
import { getMonthlyReport } from "@/lib/server/analytics";

export default function ReportPage({ searchParams }: PageProps<"/analyses/rapport">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Report searchParams={searchParams} />
    </Suspense>
  );
}

/** Monthly report (ADR-041): the past month by default, every sentence computed. */
async function Report({ searchParams }: Pick<PageProps<"/analyses/rapport">, "searchParams">) {
  const user = await requireUser();
  const today = toParisDateString(new Date());
  const params = await searchParams;
  const raw = Array.isArray(params.mois) ? params.mois[0] : params.mois;
  const month =
    parseMonthKey(raw) ?? shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1);
  const report = await getMonthlyReport(user.id, month, today);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/analyses?mois=${formatMonthKey(month)}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-text pointer-coarse:min-h-11"
        >
          <ChevronLeft className="size-4" aria-hidden /> Analyses
        </Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold tracking-[-0.01em]">
          Rapport {/^[aeiouyéè]/i.test(report.monthLabel) ? "d'" : "de "}
          {report.monthLabel}
        </h1>
        <p className="mb-6 text-base text-muted">
          Calculé à partir de vos mouvements, sur ma dépense réelle.
        </p>
        <Card className="divide-y divide-border">
          {report.sections.map((s) => (
            <section key={s.title} className="px-5 py-4">
              <h2 className="mb-2 text-sm font-medium text-muted">{s.title}</h2>
              <ul className="flex flex-col gap-1.5 text-base">
                {s.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      </article>
    </>
  );
}
