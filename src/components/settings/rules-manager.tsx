"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { deleteRuleAction, setRuleActiveAction } from "@/lib/actions/budgets";
import { cn } from "@/lib/utils";

export type RuleItem = {
  id: string;
  matchType: "contains" | "equals" | "starts_with" | "merchant";
  pattern: string | null;
  merchantName: string | null;
  categoryName: string;
  active: boolean;
};

const MATCH_LABELS = {
  contains: "contient",
  equals: "est",
  starts_with: "commence par",
} as const;

function describe(r: RuleItem) {
  return r.matchType === "merchant"
    ? `Magasin ${r.merchantName ?? "supprimé"}`
    : `Libellé ${MATCH_LABELS[r.matchType]} « ${r.pattern} »`;
}

function RuleRow({ rule }: { rule: RuleItem }) {
  const [pending, start] = useTransition();
  const label = describe(rule);
  return (
    <li className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <span className={cn("flex min-w-0 flex-1 flex-col", !rule.active && "text-muted")}>
        <span className="truncate text-base">{label}</span>
        <span className="truncate text-xs text-muted">vers {rule.categoryName}</span>
      </span>
      <label className="flex items-center gap-2 text-sm text-muted pointer-coarse:min-h-11">
        <input
          type="checkbox"
          className="accent-[var(--accent)]"
          checked={rule.active}
          disabled={pending}
          aria-label={`Activer la règle : ${label}`}
          onChange={(e) =>
            start(async () => {
              const r = await setRuleActiveAction(rule.id, e.target.checked);
              if (!r.ok) toast(r.error);
            })
          }
        />
        Active
      </label>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Supprimer la règle : ${label}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteRuleAction(rule.id);
            toast(r.ok ? "Règle supprimée." : r.error);
          })
        }
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/** Rules learned from my corrections (ADR-038): applied to entries, imports and receipts. */
export function RulesManager({ rules }: { rules: RuleItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Règles de classement</CardTitle>
      </CardHeader>
      {rules.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">
          Corrigez la catégorie d&apos;une dépense : on vous proposera de toujours la classer ainsi.
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border border-t border-border">
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} />
          ))}
        </ul>
      )}
    </Card>
  );
}
