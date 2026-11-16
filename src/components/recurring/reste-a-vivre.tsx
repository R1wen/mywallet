import { Amount } from "@/components/ui/amount";
import type { ResteAVivreSummary } from "@/lib/server/recurring";
import { cn } from "@/lib/utils";

/** Four figures of the current month's "reste à vivre" (ADR-025). */
export function ResteAVivreStrip({ rav }: { rav: ResteAVivreSummary }) {
  const negative = rav.resteCents < 0;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
      <Figure label="Reste à vivre" hint="Jusqu'à la fin du mois">
        <Amount cents={rav.resteCents} className={cn(negative && "text-danger")} />
      </Figure>
      <Figure
        label="Utilisable aujourd'hui"
        hint={`Par jour, ${rav.daysLeft} jour${rav.daysLeft > 1 ? "s" : ""} restant${rav.daysLeft > 1 ? "s" : ""}`}
      >
        <Amount cents={rav.perDayCents} />
      </Figure>
      <Figure label="Charges à venir" hint="Prélèvements et épargne prévus">
        <Amount cents={rav.plannedChargesCents} />
      </Figure>
      <Figure label="Revenus attendus" hint="Encore à recevoir ce mois-ci">
        <Amount
          cents={rav.plannedIncomeCents}
          variant={rav.plannedIncomeCents ? "flow" : "plain"}
        />
      </Figure>
    </div>
  );
}

function Figure({
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
      <span className="text-xs text-muted">{hint}</span>
    </div>
  );
}
