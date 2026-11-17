"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { loadShareDialog, saveSharesAction } from "@/lib/actions/sharing";
import { ME, isShareLocked, netLineAmounts } from "@/lib/domain/claims";
import { formatDateFr } from "@/lib/domain/dates";
import type { ShareState } from "@/lib/server/sharing";
import { ShareEditor, draftToInput, type PersonOption, type ShareDraft } from "./share-editor";

type Ctx = { openShare: (transactionId: string) => void };
const ShareDialogContext = createContext<Ctx | null>(null);

export function useShareDialog(): Ctx {
  const ctx = use(ShareDialogContext);
  if (!ctx) throw new Error("useShareDialog must be used inside ShareDialogProvider");
  return ctx;
}

type State =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "ready"; state: ShareState; people: PersonOption[] }
  | { status: "error"; message: string };

/** Current shares as an editor draft: who takes part in each line (me when a part is left). */
export function draftFromState(state: ShareState): ShareDraft {
  const active = state.claims.filter((c) => c.status !== "cancelled");
  const people = [...new Set(active.map((c) => c.personId))];
  const participantsOf = (itemId: string | null, amount: number) => {
    const own = active.filter((c) => c.itemId === itemId);
    const owed = own.reduce((s, c) => s + c.amountCents, 0);
    const ids = own.map((c) => c.personId);
    return owed < amount || !ids.length ? [ME, ...ids] : ids;
  };
  const net = netLineAmounts(state.items.map((i) => i.totalCents));
  return {
    split: people.length > 0,
    people,
    byLine: Object.fromEntries(
      state.items.map((it, i) => [it.id, participantsOf(it.id, net[i] ?? 0)]),
    ),
    whole: participantsOf(null, state.transaction.totalCents),
  };
}

function ShareForm({
  state,
  people,
  onDone,
}: {
  state: ShareState;
  people: PersonOption[];
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFromState(state));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = state.claims.some(isShareLocked);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await saveSharesAction({
      transactionId: state.transaction.id,
      ...draftToInput(
        draft,
        state.items.map((i) => i.id),
      ),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(
      r.data.claims
        ? `Partage enregistré : ${r.data.claims} part${r.data.claims > 1 ? "s" : ""}.`
        : "Dépense entièrement à moi.",
    );
    onDone();
  }

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <ShareEditor
          draft={draft}
          onChange={setDraft}
          people={people}
          lines={state.items.map((i) => ({ key: i.id, label: i.label, totalCents: i.totalCents }))}
          totalCents={state.transaction.totalCents}
          locked={locked}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Annuler
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "Enregistrement…" : "Enregistrer le partage"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** "Partager" dialog of an existing expense, opened from its edit dialog or a person page. */
export function ShareDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "closed" });
  const request = useRef(0);

  const open = useCallback(async (transactionId: string) => {
    const current = ++request.current;
    setState({ status: "loading" });
    try {
      const data = await loadShareDialog(transactionId);
      if (current !== request.current) return;
      setState(
        data
          ? { status: "ready", state: data.state, people: data.people }
          : { status: "error", message: "Seule une dépense peut être partagée." },
      );
    } catch {
      if (current === request.current) {
        setState({ status: "error", message: "Chargement impossible. Réessayez." });
      }
    }
  }, []);

  const value = useMemo<Ctx>(() => ({ openShare: (id) => void open(id) }), [open]);
  const close = () => {
    request.current++;
    setState({ status: "closed" });
  };

  return (
    <ShareDialogContext value={value}>
      {children}
      <Dialog open={state.status !== "closed"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Partager la dépense</DialogTitle>
            <DialogDescription>
              {state.status === "ready" ? (
                <>
                  {state.state.transaction.label} ·{" "}
                  {formatDateFr(state.state.transaction.occurredOn)} ·{" "}
                  <Amount cents={state.state.transaction.totalCents} className="text-muted" />
                </>
              ) : (
                "Chargement de la dépense."
              )}
            </DialogDescription>
          </DialogHeader>
          {state.status === "loading" && (
            <div className="flex flex-col gap-3 px-5 pb-5" aria-busy="true">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {state.status === "error" && (
            <p role="alert" className="px-5 pb-5 text-sm text-danger">
              {state.message}
            </p>
          )}
          {state.status === "ready" && (
            <ShareForm
              key={state.state.transaction.id}
              state={state.state}
              people={state.people}
              onDone={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </ShareDialogContext>
  );
}
