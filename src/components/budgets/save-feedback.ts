"use client";

import { toast } from "@/components/ui/toast";
import { saveRulesAction } from "@/lib/actions/budgets";
import type { BudgetAlert } from "@/lib/server/budgets";
import type { ProposedRule } from "@/lib/server/rules";

/**
 * After an expense is saved: budget thresholds it crossed (ADR-037), then the rule to
 * learn from a category corrected by hand, saved only if the user confirms (ADR-038).
 */
export function showSaveFeedback({
  alerts,
  proposals,
}: {
  alerts: BudgetAlert[];
  proposals: ProposedRule[];
}) {
  for (const a of alerts) {
    toast.warning(`Budget ${a.name} : ${a.percent} %`, {
      description: a.level === "over" ? "Le budget est dépassé." : "Seuil d'alerte atteint.",
    });
  }
  if (!proposals.length) return;
  const rules = proposals.map(({ text: _text, ...rule }) => rule);
  const title =
    proposals.length === 1
      ? `Toujours classer ${proposals[0]!.text} ?`
      : `Mémoriser ${proposals.length} classements ?`;
  toast(title, {
    description: proposals.length > 1 ? proposals.map((p) => p.text).join(" · ") : undefined,
    duration: 12_000,
    action: {
      label: proposals.length === 1 ? "Toujours" : "Mémoriser",
      onClick: async () => {
        const r = await saveRulesAction(rules);
        toast(r.ok ? (r.data.count > 1 ? "Règles enregistrées." : "Règle enregistrée.") : r.error);
      },
    },
  });
}
