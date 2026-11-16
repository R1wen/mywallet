import { Amount } from "@/components/ui/amount";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFr } from "@/lib/domain/dates";
import type { RecurringKind, RecurringRuleRow } from "@/lib/server/recurring";
import { RecurringLogo } from "./recurring-visuals";
import { RuleButton } from "./rule-dialog";

const GROUPS: { kind: RecurringKind; title: string }[] = [
  { kind: "income", title: "Revenus" },
  { kind: "expense", title: "Charges et abonnements" },
  { kind: "transfer", title: "Épargne" },
];

/** Rules grouped by kind; a row opens the rule for editing. */
export function RuleList({ rules }: { rules: RecurringRuleRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map(({ kind, title }) => {
        const rows = rules.filter((r) => r.kind === kind);
        if (rows.length === 0) return null;
        return (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <span className="text-sm text-muted">
                {rows.length} règle{rows.length > 1 ? "s" : ""}
              </span>
            </CardHeader>
            <ul>
              {rows.map((r) => (
                <li key={r.id} className="border-t border-border">
                  <RuleButton
                    id={r.id}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-surface-2"
                  >
                    <RecurringLogo
                      kind={r.kind}
                      label={r.label}
                      merchantId={r.merchantId}
                      merchantName={r.merchantName}
                      merchantLogo={r.merchantLogo}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-base">{r.label}</span>
                      <span className="truncate text-xs text-muted">
                        {r.schedule}
                        <span className="max-sm:hidden">
                          {" · "}
                          {r.kind === "transfer"
                            ? `${r.accountName} vers ${r.toAccountName ?? "?"}`
                            : r.accountName}
                        </span>
                      </span>
                    </span>
                    <span className="w-32 shrink-0 text-right text-sm text-muted max-md:hidden">
                      {r.nextDueOn ? `Prochaine : ${formatDateFr(r.nextDueOn)}` : "Terminée"}
                    </span>
                    <Amount
                      cents={r.amountCents}
                      variant={r.kind === "transfer" ? "plain" : "flow"}
                      className="w-28 shrink-0 text-right"
                    />
                  </RuleButton>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
