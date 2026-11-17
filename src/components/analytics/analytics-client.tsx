"use client";

import { Send } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  askAction,
  dismissSubscriptionAction,
  trackSubscriptionAction,
} from "@/lib/actions/analytics";
import { simulate, type Scenario } from "@/lib/domain/analytics";
import { parseAmountToCents } from "@/lib/domain/money";
import type { Answer } from "@/lib/server/ask";

/** "Suivre dans Récurrent" / "Ignorer" on a detected subscription. */
export function SubscriptionActions({ subKey, name }: { subKey: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`Suivre ${name} dans Récurrent`}
        onClick={() =>
          start(async () => {
            const r = await trackSubscriptionAction(subKey);
            toast(r.ok ? `${name} est suivi dans Récurrent.` : r.error);
          })
        }
      >
        Suivre
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Ignorer ${name}`}
        onClick={() =>
          start(async () => {
            const r = await dismissSubscriptionAction(subKey);
            toast(r.ok ? `${name} ne sera plus signalé.` : r.error);
          })
        }
      >
        Ignorer
      </Button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* "Et si"                                                                     */
/* -------------------------------------------------------------------------- */

type Baseline = {
  incomeCents: number;
  categories: { id: string | null; name: string; cents: number }[];
  goals: { id: string; name: string; remainingCents: number }[];
};

const reach = (n: number | null) =>
  n === null ? "pas atteint au rythme actuel" : `atteint dans ${n} mois`;

/** Simulator on an average month of the last three (computed in the browser, pure domain). */
export function Simulator({ baseline }: { baseline: Baseline }) {
  const [cuts, setCuts] = useState<Record<string, number>>({});
  const [added, setAdded] = useState("");
  const [removed, setRemoved] = useState("");
  const [goalId, setGoalId] = useState(baseline.goals[0]?.id ?? "");
  const goal = baseline.goals.find((g) => g.id === goalId);

  const result = useMemo(() => {
    const scenarios: Scenario[] = [
      ...baseline.categories
        .filter((c) => (cuts[c.id ?? ""] ?? 0) > 0)
        .map((c) => ({ kind: "cut" as const, categoryId: c.id, percent: cuts[c.id ?? ""] ?? 0 })),
    ];
    const add = parseAmountToCents(added);
    if (add && add > 0) scenarios.push({ kind: "add", monthlyCents: add });
    const remove = parseAmountToCents(removed);
    if (remove && remove > 0) scenarios.push({ kind: "remove", monthlyCents: remove });
    return simulate(
      {
        incomeCents: baseline.incomeCents,
        spendingByCategory: new Map(baseline.categories.map((c) => [c.id, c.cents])),
      },
      scenarios,
      goal ? { remainingCents: goal.remainingCents } : undefined,
    );
  }, [baseline, cuts, added, removed, goal]);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-3">
        <ul role="list" className="divide-y divide-border rounded-sm border border-border">
          {baseline.categories.slice(0, 6).map((c) => {
            const key = c.id ?? "";
            const value = cuts[key] ?? 0;
            return (
              <li
                key={key}
                className="grid grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-3 px-3 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base">{c.name}</span>
                  <span className="text-xs text-muted">
                    <Amount cents={c.cents} className="text-muted" /> par mois
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={value}
                  aria-label={`Réduire ${c.name} de`}
                  aria-valuetext={`${value} %`}
                  className="accent-[var(--accent)] pointer-coarse:h-11"
                  onChange={(e) => setCuts((s) => ({ ...s, [key]: Number(e.target.value) }))}
                />
                <span className="text-right text-sm text-muted tabular-nums">
                  {value ? `-${value} %` : "0 %"}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Nouvel abonnement par mois
            <Input
              inputMode="decimal"
              placeholder="0,00"
              className="text-right font-mono tabular-nums"
              value={added}
              onChange={(e) => setAdded(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Abonnement résilié par mois
            <Input
              inputMode="decimal"
              placeholder="0,00"
              className="text-right font-mono tabular-nums"
              value={removed}
              onChange={(e) => setRemoved(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-sm border border-border p-4" aria-live="polite">
        <span className="text-sm text-muted">Épargne par mois</span>
        <span className="text-lg font-medium">
          <Amount cents={result.netCents} variant="flow" />
        </span>
        <span className="text-sm text-muted">
          aujourd&apos;hui <Amount cents={result.baselineNetCents} className="text-muted" />
        </span>
        <span className="mt-2 text-sm text-muted">Sur un an</span>
        <span className="text-md">
          <Amount cents={result.yearlyDeltaCents} variant="flow" />
        </span>
        {baseline.goals.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3 text-sm">
            <NativeSelect
              aria-label="Objectif"
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              {baseline.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
            {result.goalMonths && (
              <span className="text-muted">
                <span className="inline-block first-letter:uppercase">
                  {reach(result.goalMonths.after)}
                  {result.goalMonths.after !== result.goalMonths.before &&
                    ` (au lieu de : ${reach(result.goalMonths.before)})`}
                  .
                </span>
              </span>
            )}
          </div>
        )}
        <p className="mt-auto pt-2 text-xs text-muted">
          Calcul sur la moyenne des trois derniers mois complets. Rien n&apos;est modifié.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                   */
/* -------------------------------------------------------------------------- */

export function AskBox({ enabled, modelName }: { enabled: boolean; modelName: string | null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!enabled) {
    return (
      <p className="text-sm text-muted">
        Choisissez Ollama ou Gemini dans Réglages, rubrique « Lecture des tickets », pour poser des
        questions sur vos dépenses.
      </p>
    );
  }
  const value = (v: number) =>
    answer?.measure === "count" ? (
      <span className="font-mono tabular-nums">{v}</span>
    ) : (
      <Amount cents={v} />
    );

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await askAction(question);
            if (!r.ok) {
              setAnswer(null);
              setError(r.error);
              return;
            }
            setAnswer(r.data);
          });
        }}
      >
        <Input
          aria-label="Votre question"
          placeholder="Combien en restaurants le mois dernier ?"
          maxLength={300}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="h-8"
          disabled={pending || question.trim().length < 3}
        >
          <Send aria-hidden /> {pending ? "…" : "Demander"}
        </Button>
      </form>
      <p className="text-xs text-muted">
        {modelName} ne reçoit que la question et les noms de vos catégories et magasins ; le calcul
        est fait ici, sur vos données.
      </p>
      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
      {answer && (
        <div aria-live="polite" className="flex flex-col gap-2 rounded-sm border border-border p-3">
          <span className="text-xs text-muted">Compris comme : {answer.understood}</span>
          <span className="text-lg font-medium">{value(answer.total)}</span>
          {answer.rows.length > 0 && (
            <ul role="list" className="divide-y divide-border text-base">
              {answer.rows.map((r) => (
                <li key={r.label} className="flex min-h-9 items-center justify-between gap-3">
                  <span className="truncate capitalize">{r.label}</span>
                  {value(r.value)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
