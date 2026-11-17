"use client";

import { UserPlus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPersonAction } from "@/lib/actions/sharing";
import {
  ME,
  allocateVat,
  computeItemClaims,
  computeWholeClaims,
  type ClaimShare,
} from "@/lib/domain/claims";
import { formatCents } from "@/lib/domain/money";
import { cn } from "@/lib/utils";
import type { SharesInput } from "@/lib/validation/sharing";

export type PersonOption = { id: string; name: string };

/** Editor state: lines are keyed (form field ids) so adding or removing a line keeps the rest. */
export type ShareDraft = {
  split: boolean;
  /** People taking part, in the order they were chosen. */
  people: string[];
  byLine: Record<string, string[]>;
  whole: string[];
};

export type ShareLine = { key: string; label: string; totalCents: number | null };

export const emptyDraft = (): ShareDraft => ({ split: false, people: [], byLine: {}, whole: [ME] });

const keep = (ids: readonly string[], people: readonly string[]) => {
  const kept = ids.filter((id) => id === ME || people.includes(id));
  return kept.length ? kept : [ME];
};

/** Shares to send for these lines; "all mine" sends empty participants (removes shares). */
export function draftToInput(draft: ShareDraft, lineKeys: readonly string[]): SharesInput {
  if (!draft.split || !draft.people.length) {
    return { lines: lineKeys.map(() => []), whole: [] };
  }
  return {
    lines: lineKeys.map((k) => keep(draft.byLine[k] ?? [ME], draft.people)),
    whole: keep(draft.whole, draft.people),
  };
}

/** Claims the draft would create (null while a line amount is unreadable). */
export function previewClaims(
  draft: ShareDraft,
  lines: readonly ShareLine[],
  totalCents: number | null,
): ClaimShare[] | null {
  if (!draft.split || !draft.people.length) return [];
  const input = draftToInput(
    draft,
    lines.map((l) => l.key),
  );
  if (lines.length) {
    if (lines.some((l) => l.totalCents === null)) return null;
    return computeItemClaims(
      lines.map((l, i) => ({ totalCents: l.totalCents!, participants: input.lines[i] ?? [] })),
    );
  }
  if (totalCents === null || totalCents <= 0) return null;
  return computeWholeClaims(totalCents, input.whole);
}

function Chip({
  pressed,
  onClick,
  children,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 max-w-40 items-center truncate rounded-sm border px-2.5 text-sm transition-colors duration-[var(--duration-fast)] pointer-coarse:h-11",
        pressed
          ? "border-accent bg-accent-subtle text-text"
          : "border-border text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/**
 * "Tout est à moi ?" step: who shares the expense, line by line (receipt) or as a whole.
 * A line shared by several people is split in equal parts; discounts are spread pro rata
 * and I keep the leftover cent (rules in src/lib/domain/claims.ts).
 */
export function ShareEditor({
  draft,
  onChange,
  people: initialPeople,
  lines,
  totalCents,
  vatCents = 0,
  locked = false,
}: {
  draft: ShareDraft;
  onChange: (draft: ShareDraft) => void;
  people: PersonOption[];
  lines: ShareLine[];
  totalCents: number | null;
  vatCents?: number;
  /** Some parts are already reimbursed or gifted (shown as a note). */
  locked?: boolean;
}) {
  const ids = useId();
  const [people, setPeople] = useState(initialPeople);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const setSplit = (split: boolean) => onChange({ ...draft, split });
  const togglePerson = (id: string) => {
    const on = draft.people.includes(id);
    const next = on ? draft.people.filter((p) => p !== id) : [...draft.people, id];
    onChange({ ...draft, people: next });
  };
  const toggleOnLine = (key: string | null, id: string) => {
    const current = keep(key === null ? draft.whole : (draft.byLine[key] ?? [ME]), draft.people);
    const has = current.includes(id);
    const next = has ? current.filter((p) => p !== id) : [...current, id];
    const value = next.length ? next : [ME];
    if (key === null) onChange({ ...draft, whole: value });
    else onChange({ ...draft, byLine: { ...draft.byLine, [key]: value } });
  };
  const assignAll = (participants: string[]) =>
    onChange({
      ...draft,
      whole: participants,
      byLine: Object.fromEntries(lines.map((l) => [l.key, participants])),
    });

  async function addPerson() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    const r = await createPersonAction({ name });
    setAdding(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPeople((list) => (list.some((p) => p.id === r.data.id) ? list : [...list, r.data]));
    if (!draft.people.includes(r.data.id)) {
      onChange({ ...draft, split: true, people: [...draft.people, r.data.id] });
    }
    setNewName("");
  }

  const claims = previewClaims(draft, lines, totalCents);
  const owed = new Map<string, number>();
  for (const c of claims ?? []) owed.set(c.personId, (owed.get(c.personId) ?? 0) + c.amountCents);
  const totalOwed = [...owed.values()].reduce((s, v) => s + v, 0);
  const mine = totalCents !== null ? totalCents - totalOwed : null;
  const vat =
    vatCents > 0 && mine !== null && claims
      ? allocateVat(vatCents, [
          { participant: ME, amountCents: mine },
          ...[...owed].map(([participant, amountCents]) => ({ participant, amountCents })),
        ])
      : [];
  const chosen = draft.people.filter((id) => nameOf.has(id));

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h2 id={`${ids}-title`} className="text-sm font-medium text-muted">
        Tout est à moi ?
      </h2>
      <div role="radiogroup" aria-labelledby={`${ids}-title`} className="grid grid-cols-2 gap-2">
        {[
          { value: false, label: "Oui, tout à moi" },
          { value: true, label: "Non, je partage" },
        ].map((o) => (
          <label
            key={o.label}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-border px-3 py-2 text-base has-checked:border-accent"
          >
            <input
              type="radio"
              name={`${ids}-split`}
              className="accent-[var(--accent)]"
              checked={draft.split === o.value}
              onChange={() => setSplit(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>

      {draft.split && (
        <div className="flex flex-col gap-3 rounded-sm border border-border p-3">
          <div className="flex flex-col gap-2">
            <span id={`${ids}-people`} className="text-xs text-muted">
              Avec qui ?
            </span>
            <div role="group" aria-labelledby={`${ids}-people`} className="flex flex-wrap gap-2">
              {people.map((p) => (
                <Chip
                  key={p.id}
                  pressed={draft.people.includes(p.id)}
                  onClick={() => togglePerson(p.id)}
                >
                  {p.name}
                </Chip>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                aria-label="Nom d'une nouvelle personne"
                placeholder="Nouvelle personne"
                autoComplete="off"
                maxLength={60}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  // Enter adds the person instead of submitting the surrounding form.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addPerson();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8"
                disabled={adding || !newName.trim()}
                onClick={() => void addPerson()}
              >
                <UserPlus aria-hidden /> Ajouter
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>

          {chosen.length === 0 ? (
            <p className="text-sm text-muted">Choisissez au moins une personne.</p>
          ) : lines.length ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Toutes les lignes :</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => assignAll([ME, ...chosen])}
                >
                  À parts égales
                </Button>
                {chosen.map((id) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => assignAll([id])}
                  >
                    À {nameOf.get(id)}
                  </Button>
                ))}
              </div>
              <ul role="list" className="divide-y divide-border rounded-sm border border-border">
                {lines.map((l, index) => {
                  const negative = l.totalCents !== null && l.totalCents < 0;
                  const current = keep(draft.byLine[l.key] ?? [ME], draft.people);
                  return (
                    <li
                      key={l.key}
                      className="flex flex-col gap-2 px-3 py-2 sm:grid sm:min-h-11 sm:grid-cols-[minmax(0,1fr)_auto_5.5rem] sm:items-center sm:gap-3 sm:py-1.5"
                    >
                      <div className="flex items-center justify-between gap-3 sm:contents">
                        <span className="min-w-0 truncate text-base">
                          {l.label || `Ligne ${index + 1}`}
                        </span>
                        {l.totalCents !== null && (
                          <Amount cents={l.totalCents} className="shrink-0 text-muted" />
                        )}
                      </div>
                      {negative ? (
                        <span className="text-xs text-muted">Répartie au prorata des lignes.</span>
                      ) : (
                        <div
                          role="group"
                          aria-label={`Qui partage « ${l.label || `ligne ${index + 1}`} » ?`}
                          className="flex flex-wrap gap-2"
                        >
                          {[ME, ...chosen].map((id) => (
                            <Chip
                              key={id}
                              pressed={current.includes(id)}
                              onClick={() => toggleOnLine(l.key, id)}
                            >
                              {id === ME ? "Moi" : nameOf.get(id)}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">Parts égales entre :</span>
              <div
                role="group"
                aria-label="Qui partage la dépense ?"
                className="flex flex-wrap gap-2"
              >
                {[ME, ...chosen].map((id) => (
                  <Chip
                    key={id}
                    pressed={keep(draft.whole, draft.people).includes(id)}
                    onClick={() => toggleOnLine(null, id)}
                  >
                    {id === ME ? "Moi" : nameOf.get(id)}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {chosen.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              {claims === null ? (
                <p className="text-sm text-warning">
                  Corrigez les montants pour voir la répartition.
                </p>
              ) : (
                <>
                  {chosen.map((id) => (
                    <div key={id} className="flex items-center justify-between gap-3 text-base">
                      <span className="truncate">
                        {nameOf.get(id)} <span className="text-muted">me doit</span>
                      </span>
                      <Amount cents={owed.get(id) ?? 0} />
                    </div>
                  ))}
                  {mine !== null && (
                    <div className="flex items-center justify-between gap-3 text-base text-muted">
                      <span>Ma part</span>
                      <Amount cents={mine} className="text-muted" />
                    </div>
                  )}
                  {vat.length > 0 && (
                    <p className="text-xs text-muted">
                      TVA répartie au prorata :{" "}
                      {vat
                        .map(
                          (v) =>
                            `${v.participant === ME ? "moi" : nameOf.get(v.participant)} ${formatCents(v.vatCents)}`,
                        )
                        .join(", ")}
                      .
                    </p>
                  )}
                </>
              )}
              {locked && (
                <p className="text-xs text-muted">
                  Les parts déjà remboursées ou offertes ne peuvent pas changer.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
